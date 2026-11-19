import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { renderPortableDocument } from '@portable-doc/react';
import { blockSchema } from '@portable-doc/validate';
// jsdom is the repo's HTML parser (packages/code tests use it too), at the same version.
import { JSDOM } from 'jsdom';
import MarkdownIt from 'markdown-it';
import { FENCE_TYPES } from './from-markdown.js';
import { fromMarkdown, toMarkdown, toPlainText } from './index.js';
import { ADDRESS_KEYS, LINKED_BY_RULE, safeUrl } from './util.js';

// Which fields of a ```portabledoc fence does a renderer put where text is live? Ask the
// renderers, not the field names: put a probe in one field at a time, splice the fence with
// fromMarkdown, render it as HTML, Markdown and plain text, parse what comes out, and find the
// probe. Each probe ends in a unique token (`…//pdprobe000001`) that survives URL normalising,
// so a renderer that rewrites a value through new URL() is still seen.
//
// The search is inside out: it lists the few places where text is INERT, and every other place
// counts as live, so a form of address no one has named is caught too.

const goldens = new URL('../../goldens/blocks/', import.meta.url);
const MARK = 'https://marker.example/p';
// The first 13 rows are copied from packages/editor/src/canvas/__safe_url_paint.test.mjs, which
// matches safe_url/1 row for row (a test below fails if they differ); the rest are more data:,
// http:// and javascript: forms. Under a LINKED_BY_RULE entry only a value its rule allows may be live.
const SAFE_URL_ROWS = 13;
const URL_CASES = [
  'https://example.com/a', 'mailto:a@b.c', '/media/files/x.png', '#anchor', './rel', 'javascript:alert(1)', ' JaVaScRiPt:alert(1)',
  'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', '//evil.example/x', '/\\evil.example/x',
  '/\t/evil.example/x', 'data:text/html,x', ' data:text/html,x', 'data:image/svg+xml,<svg onload=alert(1)>', ' JAVASCRIPT:alert(1)',
  'http://example.com/a', '\thttp://example.com/a', ' https://example.com/a', 'HTTPS://example.com/a', 'https:example.com/a',
];
const allowed = (value, rule) => (rule.trimmed ? value.trim() : value).startsWith(rule.prefix);

// ── where text is inert ─────────────────────────────────────────────────

// HTML: a text node outside the raw-text elements, and the value of these attributes.
const INERT_ATTRS = new Set([
  'alt', // replacement text, shown as text
  'title', // a tooltip, shown as text
  'aria-label', // read out as text
  'class', // names a style rule; no browser fetches or runs a class
  'id', // names a fragment (a heading's anchor slug); never fetched or run
]);
// Elements whose text a browser does not show as text: it runs, styles or parses it.
const RAW_TEXT = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext', 'template']);

/** Is `token` anywhere live in this HTML: in an attribute not on INERT_ATTRS, in raw text (style, script, …), in a comment, or in a name? */
export function liveInHtml(html, token) {
  if (!mayHold(html, token)) return false;
  const stack = [...JSDOM.fragment(html).childNodes];
  while (stack.length) {
    const node = stack.pop();
    if (node.nodeType === 3) {
      if (node.data.includes(token) && RAW_TEXT.has(node.parentNode?.localName)) return true;
      continue;
    }
    if (node.nodeType !== 1) {
      if (node.nodeType === 8 && node.data.includes(token)) return true;
      continue;
    }
    if (node.localName.includes(token)) return true;
    for (const { name, value } of node.attributes) if (name.includes(token) || (value.includes(token) && !INERT_ATTRS.has(name))) return true;
    stack.push(...node.childNodes, ...(node.content ? node.content.childNodes : []));
  }
  return false;
}

// Markdown has no inert list of its own: it is rendered to HTML and judged by the HTML rule
// (code becomes text in `code`, a link title `title`, an image's alt `alt`). It is read twice.
// The strict reader (raw HTML on, bare URLs left as text) shows what the renderer itself
// linked; the permissive one (bare URLs linked too) shows what any reader could make live.
// Both keep every destination as written, with no scheme check.
const reader = (linkify) => {
  const md = new MarkdownIt('default', { html: true, linkify });
  md.validateLink = () => true;
  md.normalizeLink = (url) => url;
  return md;
};
const STRICT = reader(false);
const PERMISSIVE = reader(true);
const mayHold = (out, token) => out.includes(token) || out.includes('&#');

/** Is `token` live in this Markdown, read by the strict reader, or with `permissive` by one that links bare URLs too? */
export const liveInMarkdown = (src, token, permissive = false) => mayHold(src, token) && liveInHtml((permissive ? PERMISSIVE : STRICT).render(src), token);

let probes = 0;
/** A probe value: `base` with a token found nowhere else at the end of its path, and in its host when it has one
 * (so a renderer that keeps only the hostname is seen too). */
const tokened = (base) => {
  const token = `pdprobe${(++probes).toString(36).padStart(6, '0')}`;
  let host = '';
  try {
    host = new URL(base).hostname;
  } catch {
    try {
      const url = new URL(base, 'https://base.invalid');
      if (url.hostname !== 'base.invalid') host = url.hostname;
    } catch {}
  }
  const at = host ? base.toLowerCase().indexOf(host) : -1;
  const value = at < 0 ? base : `${base.slice(0, at)}${token}.${base.slice(at)}`;
  return { value: `${value}//${token}`, token };
};

// ── probing ─────────────────────────────────────────────────────────────

const REAL = { html: (doc) => renderPortableDocument(doc, {}), markdown: toMarkdown, text: toPlainText };
const fence = (blocks) => '```portabledoc\n' + JSON.stringify(blocks) + '\n```';
const strings = (v, path = []) => (typeof v === 'string' ? [path] : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => strings(x, [...path, Array.isArray(v) ? Number(k) : k])) : []);
const name = (type, path) => [type, ...path].map((k) => (typeof k === 'number' ? '[]' : k)).join('.').replaceAll('.[]', '[]');

/** The block with `value` at `path`, or null when the path's parent is not there. */
function withValue(block, path, value) {
  const copy = structuredClone(block);
  let at = copy;
  for (const key of path.slice(0, -1)) {
    at = at[key];
    if (at === null || typeof at !== 'object') return null;
  }
  at[path.at(-1)] = value;
  return copy;
}

/** The doc a fence holding `block` imports as, or null when the fence stays code: only its own fallback, the fence's JSON as a code block, means that. */
function spliced(block) {
  const blocks = [block];
  const doc = fromMarkdown(fence(blocks));
  return doc.length === 1 && doc[0].type === 'code' && doc[0].value === JSON.stringify(blocks) ? null : doc;
}

// Keys a renderer asks for that the block does not have, by path: what it would read if a doc filled them.
const NOT_FIELDS = new Set(['then', 'toJSON', 'constructor', '$$typeof', 'length', '__proto__', 'valueOf', 'toString', 'nodeType', 'props', 'key', 'ref', '_owner', '_store']);
function readsMissing(block, render) {
  const reads = new Map();
  const wrap = (v, path) =>
    new Proxy(v, {
      get(t, k, r) {
        if (typeof k === 'string' && !NOT_FIELDS.has(k) && !Array.isArray(t) && !(k in t)) reads.set(JSON.stringify([...path, k]), [...path, k]);
        const x = Reflect.get(t, k, r);
        return typeof k === 'string' && x && typeof x === 'object' ? wrap(x, [...path, Array.isArray(t) ? Number(k) : k]) : x;
      },
    });
  for (const out of Object.values(render)) out([wrap(block, [])]);
  return [...reads.values()];
}

/** Every fence-type golden block as it is, and again with each string field the schema declares and the golden leaves out added
 * (a renderer may read a field only while another is empty: `language` when there is no `lang`). */
function goldenBlocks() {
  const out = [];
  for (const file of fs.readdirSync(goldens).filter((f) => f.endsWith('.golden.json')).sort()) {
    const { input } = JSON.parse(fs.readFileSync(new URL(file, goldens), 'utf8'));
    for (const block of Array.isArray(input) ? input : (input?.blocks ?? [input])) {
      if (!block || !FENCE_TYPES.has(block.type)) continue;
      const declared = blockSchema.definitions.blocks[block.type]?.properties ?? {};
      const extra = Object.entries(declared).filter(([k, p]) => !Object.hasOwn(block, k) && [p.type].flat().includes('string'));
      out.push(block);
      if (extra.length) out.push({ ...block, ...Object.fromEntries(extra.map(([k]) => [k, 'x'])) });
    }
  }
  return out;
}

// A probe is looked for in three readings: the HTML, the Markdown by the strict reader, and the
// Markdown by the permissive one. Plain text has no live place: it is read only for whether the
// token is there at all.
const LINKED = 'linked markdown';
const OWN = ['html', 'markdown']; // what the renderer itself linked
const REFUSED = URL_CASES.filter((v) => safeUrl(v) === null);

/** Probe every field of `blocks` through `render`: for each field, where a probe for a value is live and whether plain text holds it. */
function survey(blocks, render = REAL) {
  const fields = [];
  const types = new Set();
  let rendered = 0;
  for (const block of blocks) {
    const seen = new Set();
    const paths = [...strings(block), ...readsMissing(block, render)].filter((p) => p.at(-1) !== 'type' && !seen.has(JSON.stringify(p)) && seen.add(JSON.stringify(p)));
    for (const path of paths) {
      const memo = new Map();
      // Where a probe for `base` is live, and whether the plain text holds it; nowhere when the fence stays code.
      const probe = (base) => {
        if (memo.has(base)) return memo.get(base);
        const { value, token } = tokened(base);
        const copy = withValue(block, path, value);
        const doc = copy && spliced(copy);
        let result = { live: [], text: false };
        if (doc) {
          if (base === MARK) rendered++, types.add(block.type);
          const md = render.markdown(doc);
          const strict = liveInMarkdown(md, token);
          // The permissive reader links all the strict one does.
          const linked = strict || liveInMarkdown(md, token, true);
          const live = [liveInHtml(render.html(doc), token) && 'html', strict && 'markdown', linked && LINKED].filter(Boolean);
          result = { live, text: render.text(doc).includes(token) };
        }
        memo.set(base, result);
        return result;
      };
      probe(MARK);
      fields.push({ field: name(block.type, path), key: path.at(-1), probe });
    }
  }
  return { fields, types, rendered };
}

/** Is `field` an address field: on ADDRESS_KEYS by name (the name net below holds every address-like name to it), or on LINKED_BY_RULE? */
const isAddress = (field, key, rules) => ADDRESS_KEYS.includes(key) || Object.hasOwn(rules, field);
/** Would `field`'s own rule refuse `value`: its LINKED_BY_RULE entry, else the safe-URL rule? */
const refusedFor = (field, value, rules) => (Object.hasOwn(rules, field) ? !allowed(value, rules[field]) : safeUrl(value) === null);

/** Where `field` is live with an https:// address in what the renderer itself wrote. */
const linkedWhere = (f) => f.probe(MARK).live.filter((w) => OWN.includes(w));

/** What breaks the rules, one line each:
 * 1. a value the safe-URL rule refuses is live anywhere, in any reading of any output;
 * 2. an address field's refused value is in the plain text at all;
 * 3. a field the renderer links is on neither list;
 * 4. a LINKED_BY_RULE field the renderer links with a value its rule does not allow;
 * and a rule whose field is linked nowhere. */
function problems({ fields }, rules = LINKED_BY_RULE) {
  const out = new Set();
  for (const f of fields) {
    const { field, key, probe } = f;
    const address = isAddress(field, key, rules);
    for (const base of REFUSED) {
      const { live, text } = probe(base);
      if (live.length) out.add(`refused value live: ${field} = ${JSON.stringify(base)} (${live.join(', ')})`);
      if (address && text) out.add(`refused value in plain text: ${field} = ${JSON.stringify(base)} (text)`);
    }
    const where = linkedWhere(f);
    if (!where.length || ADDRESS_KEYS.includes(key)) continue;
    if (!Object.hasOwn(rules, field)) {
      out.add(`live but on neither list: ${field} (${where.join(', ')})`);
      continue;
    }
    for (const base of [MARK, ...URL_CASES].filter((v) => !REFUSED.includes(v) && refusedFor(field, v, rules))) {
      const { live, text } = probe(base);
      const own = live.filter((w) => OWN.includes(w));
      if (own.length) out.add(`live against its rule: ${field} = ${JSON.stringify(base)} (${own.join(', ')})`);
      if (text) out.add(`refused value in plain text: ${field} = ${JSON.stringify(base)} (text)`);
    }
  }
  for (const field of Object.keys(rules)) if (!fields.some((f) => f.field === field && linkedWhere(f).length)) out.add(`on LINKED_BY_RULE but linked nowhere: ${field}`);
  return [...out];
}

// ── tests ───────────────────────────────────────────────────────────────

test('the search: a probe is live everywhere but text, alt, title, aria-label, class, id and code; a bare URL only to a reader that links them', () => {
  const T = 'pdprobe000zzz';
  const U = `https://x.example/${T}`;
  for (const html of [
    `<a href="${U}">`, `<img srcset="/a.png 1x, ${U} 2x">`, `<i style="background:url(&quot;${U}&quot;)">`, `<style>@import "${U}";</style>`,
    `<style>@import '${U}' screen;</style>`, `<i style="background-image:image-set(&quot;${U}&quot; 1x)">`, `<i style="background:-webkit-image-set('${U}' 1x)">`,
    `<meta http-equiv="refresh" content="0;url=${U}">`, `<iframe srcdoc="&lt;a href=&quot;${U}&quot;&gt;x&lt;/a&gt;"></iframe>`,
    `<svg><a><set attributeName="href" to="${U}"/></a></svg>`, `<svg><a><animate attributeName="xlink:href" values="/a;${U}"/></a></svg>`,
    `<script>location = "${U}"</script>`, `<object data="${U}">`, `<pd-portal destination="${U}"></pd-portal>`, `<p data-x="${T}">`, `<!-- ${T} -->`,
    `<p>&#112;dprobe000zzz</p><a href="&#104;ttps://x.example/&#112;dprobe000zzz">`,
  ]) assert.ok(liveInHtml(html, T), html);
  for (const html of [`<p>${U}</p>`, `<img alt="${U}">`, `<p title="${U}">`, `<b aria-label="${U}">`, `<p class="k-${T}">`, `<h2 id="${T}">`, `<pre><code>${U}</code></pre>`])
    assert.ok(!liveInHtml(html, T), html);
  // Markdown is read as HTML: by the strict reader, and by the permissive one, which links bare URLs too.
  for (const md of [`[a](${U})`, `![a](${U})`, `<${U}>`, `[a][1]\n\n[1]: ${U}`, `<a href="${U}">a</a>`, `<i style="background:url(${U})">x</i>`,
    `x <style>@import url(${U});</style>`, `x <script>location='${U}'</script>`])
    assert.ok(liveInMarkdown(md, T) && liveInMarkdown(md, T, true), md);
  for (const md of [U, `\\[a\\](${U})`, `x //${T}.evil.example/x`]) assert.ok(!liveInMarkdown(md, T) && liveInMarkdown(md, T, true), md);
  for (const md of [`\`${U}\``, `    ${U}`, `\`\`\`\n${U}\n\`\`\``, `\`\`\`${T}\nx\n\`\`\``, `[a](/b "${U}")`, `![${U}](/a.png)`, `x ${T} y`, `javascript:alert(1)//${T}`])
    assert.ok(!liveInMarkdown(md, T, true), md);
});

test('no refused value is live anywhere, and every field a renderer links is on ADDRESS_KEYS, or on LINKED_BY_RULE and kept to its rule', () => {
  const blocks = goldenBlocks();
  const found = survey(blocks);
  // The search is live: every fence type the goldens hold rendered (a spliced code block too),
  // 228 marker probes rendered today, and a link's href is live in every reading and in the plain text.
  assert.deepEqual([...found.types].sort(), [...new Set(blocks.map((b) => b.type))].sort());
  assert.ok(found.rendered >= 200, `${found.rendered} probes rendered`);
  assert.deepEqual(found.fields.find((f) => f.field === 'paragraph.content[].marks[].href').probe(MARK), { live: ['html', 'markdown', LINKED], text: true });
  assert.deepEqual(problems(found), []);
});

// Each plant below is a renderer change the search must catch, or must let through. The real
// renderers cannot be changed inside a test, so each stub wraps them and adds its own output.
const GOLDEN = goldenBlocks();
const only = (type) => GOLDEN.filter((b) => b.type === type);
const attr = (s) => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const https = (v) => typeof v === 'string' && v.startsWith('https://');
const plant = (where, add) => ({ ...REAL, [where]: (doc) => REAL[where](doc) + doc.map(add).join('') });
const html = (add) => plant('html', (b) => (b.type === 'stat' && https(b.unit) ? add(attr(b.unit)) : ''));
const unplanted = new Map();
/** The real renderers' survey of one type, made once: probes are memoised, so later checks reuse them. */
const real = (type) => (unplanted.has(type) ? unplanted : unplanted.set(type, survey(only(type)))).get(type);
const baseline = (type, rules = LINKED_BY_RULE) => problems(real(type), rules);
/** What breaks the rules for one field only: a plant check needs no other field's probes. */
const problemsOf = (found, field, rules) => problems({ ...found, fields: found.fields.filter((f) => f.field === field) }, rules);
/** Does a report on `field` starting with `prefix` name output `where` with the plant, and not without it? */
function caught(type, render, [field, prefix], where, rules = LINKED_BY_RULE) {
  const has = (lines) => lines.some((l) => l.startsWith(prefix) && l.slice(l.lastIndexOf('(') + 1, -1).split(', ').includes(where));
  return !has(problemsOf(real(type), field, rules)) && has(problemsOf(survey(only(type), render), field, rules));
}
const neither = (field) => [field, `live but on neither list: ${field} (`];
const refusedLive = (field, value) => [field, `refused value live: ${field} = ${JSON.stringify(value)} (`];

test('plants: a renderer that puts a field in any live place is caught, a form no one named included', () => {
  const unit = (add) => plant('markdown', (b) => (b.type === 'stat' && https(b.unit) ? add(b.unit) : ''));
  const cases = [
    ['diagram.source linked: a field named like a ruled one is not under its rule', 'diagram', plant('markdown', (b) => (https(b.source) ? `\n\n[source](${b.source})\n` : '')), 'diagram.source', 'markdown'],
    ['code.lang as a Markdown link', 'code', plant('markdown', (b) => (https(b.lang) ? `\n\n[lang](${b.lang})\n` : '')), 'code.lang', 'markdown'],
    ['stat.label as a Markdown reference link', 'stat', plant('markdown', (b) => (b.type === 'stat' && https(b.label) ? `\n\n[site][1]\n\n[1]: ${b.label}\n` : '')), 'stat.label', 'markdown'],
    ['a CSS url() quoted with &quot;', 'stat', html((u) => `<i style="background:url(&quot;${u}&quot;)"></i>`), 'stat.unit', 'html'],
    ['a second srcset candidate', 'stat', html((u) => `<img srcset="/a.png 1x, ${u} 2x" alt="">`), 'stat.unit', 'html'],
    ['@import "…" in a style element', 'stat', html((u) => `<style>@import "${u}";</style>`), 'stat.unit', 'html'],
    ['image-set("…" 1x)', 'stat', html((u) => `<i style="background-image:image-set(&quot;${u}&quot; 1x)"></i>`), 'stat.unit', 'html'],
    ['a meta refresh', 'stat', html((u) => `<meta http-equiv="refresh" content="0;url=${u}">`), 'stat.unit', 'html'],
    ['an iframe srcdoc', 'stat', html((u) => `<iframe srcdoc="&lt;a href=&quot;${u}&quot;&gt;x&lt;/a&gt;"></iframe>`), 'stat.unit', 'html'],
    ['an SVG <set> of href', 'stat', html((u) => `<svg><a><set attributeName="href" to="${u}"/></a></svg>`), 'stat.unit', 'html'],
    ['a made-up element and attribute', 'stat', html((u) => `<pd-portal destination="${u}"></pd-portal>`), 'stat.unit', 'html'],
    ['only the hostname, as an icon query', 'stat', plant('html', (b) => (b.type === 'stat' && https(b.unit) ? `<img alt="" src="https://icons.example/?d=${new URL(b.unit).hostname}">` : '')), 'stat.unit', 'html'],
    ['an inline <style> mid-paragraph in Markdown', 'stat', unit((u) => `\n\nx <style>@import url(${u});</style>\n`), 'stat.unit', 'markdown'],
    ['an inline <script> mid-paragraph in Markdown', 'stat', unit((u) => `\n\nx <script>location='${u}'</script>\n`), 'stat.unit', 'markdown'],
  ];
  for (const [what, type, render, field, where] of cases) assert.ok(caught(type, render, neither(field), where), what);
});

test('plants: a refused value is caught live in any reading, and in an address field\'s plain text at all', () => {
  // An address field: plain text writes a refused source as "site (…)".
  const text = plant('text', (b) => (b.type === 'stat' && typeof b.source === 'string' ? `\nsite (${b.source})\n` : ''));
  assert.ok(caught('stat', text, ['stat.source', `refused value in plain text: stat.source = ${JSON.stringify('javascript:alert(1)')} (`], 'text'), 'site (javascript:…) in plain text');
  // A words field written as bare Markdown text, which a reader that links bare URLs links.
  const bare = plant('markdown', (b) => (b.type === 'stat' && typeof b.denom === 'string' && b.denom.startsWith('//') ? `\n\nsee ${b.denom}\n` : ''));
  assert.ok(caught('stat', bare, refusedLive('stat.denom', '//evil.example/x'), LINKED), 'a refused value the permissive reader links');
});

test('plants: a field written where text is inert (alt, title, aria-label, text, a code span, a link title) is let through', () => {
  const inert = [
    plant('html', (b) => (b.type === 'stat' ? `<img alt="${attr(b.unit)}" title="${attr(b.label)}"><b aria-label="${attr(b.body)}">${attr(b.unit)}</b>` : '')),
    plant('markdown', (b) => (b.type === 'stat' ? `\n\n\`${b.unit}\` and [x](/a "${String(b.label).replaceAll('"', '')}") and ![${b.body}](/a.png)\n` : '')),
  ];
  const before = baseline('stat');
  for (const render of inert) assert.deepEqual(problems(survey(only('stat'), render)), before);
});

test('plants: a LINKED_BY_RULE field linked with a value its rule does not allow is caught, through new URL() too', () => {
  const rules = { ...LINKED_BY_RULE, 'stat.label': { prefix: 'https://', trimmed: true } };
  const label = (b) => (b.type === 'stat' && typeof b.label === 'string' ? b.label : '');
  const against = (value) => ['stat.label', `live against its rule: stat.label = ${JSON.stringify(value)} (`];
  // Links https:// and paths.
  const paths = plant('markdown', (b) => (/^\s*(?:https:\/\/|\/)/.test(label(b)) ? `\n\n[site](${label(b).trim()})\n` : ''));
  assert.ok(caught('stat', paths, against('/media/files/x.png'), 'markdown', rules), 'a path, which safe_url allows and the rule does not');
  assert.ok(caught('stat', paths, refusedLive('stat.label', '//evil.example/x'), 'markdown', rules), 'a protocol-relative path, which safe_url refuses');
  assert.ok(!problemsOf(survey(only('stat'), paths), 'stat.label', rules).some((p) => p.startsWith(against('https://example.com/a')[1])), 'an https:// label is allowed');
  // Refuses javascript:, data:, vbscript:, http: and //, then links what new URL() makes of the rest.
  const normalizing = plant('markdown', (b) => {
    const v = label(b);
    if (v === '' || /^(?:javascript|data|vbscript|http):/i.test(v) || v.startsWith('//')) return '';
    try {
      return `\n\n[site](${new URL(v).href})\n`;
    } catch {
      return '';
    }
  });
  assert.ok(caught('stat', normalizing, refusedLive('stat.label', 'java\tscript:alert(1)'), 'markdown', rules), 'java\\tscript: written as javascript:');
  assert.ok(caught('stat', normalizing, against('mailto:a@b.c'), 'markdown', rules), 'mailto:, which the rule does not allow');
});

test('the safe_url/1 rows here are the editor test\'s rows, as copied', () => {
  const editor = fs.readFileSync(new URL('../editor/src/canvas/__safe_url_paint.test.mjs', import.meta.url), 'utf8');
  const rows = [...editor.matchAll(/^\s*\[("(?:[^"\\]|\\.)*"),/gm)].map((m) => JSON.parse(m[1]));
  assert.deepEqual(rows, URL_CASES.slice(0, SAFE_URL_ROWS));
});

test('a second net, by name: every schema property named like an address is on ADDRESS_KEYS', () => {
  // Other apps render these docs too, so a field only their renderer links is caught here.
  const names = new Set();
  const stack = [blockSchema];
  while (stack.length) {
    const node = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    if (node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)) for (const key of Object.keys(node.properties)) names.add(key);
    stack.push(...Object.values(node));
  }
  const addressLike = [...names].filter((name) => /href|src|poster|url|uri/i.test(name)).sort();
  assert.deepEqual(addressLike, ['href', 'poster', 'src']);
  for (const name of addressLike) assert.ok(ADDRESS_KEYS.includes(name), name);
});
