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
import { ADDRESS_KEYS, LINKED_BY_RULE } from './util.js';

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
const SCRIPT = 'javascript:alert(1)';
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
  if (!html.includes(token) && !html.includes('&')) return false;
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

// Markdown has no inert list of its own: it is rendered with the most permissive reader this
// test can build (raw HTML on, bare URLs linked, every destination kept as written, no scheme
// check) and that HTML is judged by the HTML rule. Code becomes text in `code`, a link title
// becomes `title`, an image's alt becomes `alt`.
const markdown = new MarkdownIt('default', { html: true, linkify: true });
markdown.validateLink = () => true;
markdown.normalizeLink = (url) => url;

/** Is `token` live in this Markdown, read by the permissive reader? */
export const liveInMarkdown = (src, token) => (src.includes(token) || src.includes('&')) && liveInHtml(markdown.render(src), token);

/** Is `token` live in this output? Plain text has no inert place: the token anywhere counts. */
const LIVE = {
  html: liveInHtml,
  markdown: liveInMarkdown,
  text: (out, token) => out.includes(token),
};
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

/** Probe every field of `blocks` through `render`: which are live somewhere, and how many probes rendered. */
function survey(blocks, render = REAL) {
  const linked = new Map();
  const leaks = [];
  const types = new Set();
  let rendered = 0;
  for (const block of blocks) {
    const seen = new Set();
    const paths = [...strings(block), ...readsMissing(block, render)].filter((p) => p.at(-1) !== 'type' && !seen.has(JSON.stringify(p)) && seen.add(JSON.stringify(p)));
    for (const path of paths) {
      const field = name(block.type, path);
      // Where a probe for `base` is live: a list of outputs, [] when nowhere or the fence stays code.
      const probe = (base) => {
        const { value, token } = tokened(base);
        const copy = withValue(block, path, value);
        const doc = copy && spliced(copy);
        if (!doc) return [];
        if (base === MARK) rendered++, types.add(block.type);
        return Object.keys(render).filter((where) => LIVE[where](render[where](doc), token));
      };
      const where = probe(MARK);
      if (where.length) linked.set(field, { key: path.at(-1), where, probe });
      const leak = probe(SCRIPT);
      if (leak.length) leaks.push(`javascript: live: ${field} (${leak.join(', ')})`);
    }
  }
  return { linked, leaks, types, rendered };
}

/** What breaks the rules: a script probe live anywhere, a live field on neither list, a ruled field live for a value its rule does not allow, a rule that links nothing. */
function problems({ linked, leaks }, rules = LINKED_BY_RULE) {
  const out = [...leaks];
  for (const [field, { key, where, probe }] of linked) {
    if (ADDRESS_KEYS.includes(key)) continue;
    if (!Object.hasOwn(rules, key)) {
      out.push(`live but on neither list: ${field} (${where.join(', ')})`);
      continue;
    }
    for (const value of [MARK, ...URL_CASES]) {
      const at = probe(value);
      if (at.length && !allowed(value, rules[key])) out.push(`live against its rule: ${field} = ${JSON.stringify(value)} (${at.join(', ')})`);
    }
  }
  for (const key of Object.keys(rules)) if (![...linked.values()].some((l) => l.key === key)) out.push(`on LINKED_BY_RULE but linked nowhere: ${key}`);
  return out;
}

// ── tests ───────────────────────────────────────────────────────────────

test('the search: a probe is live everywhere but text, alt, title, aria-label, class, id and code', () => {
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
  // Markdown is read as HTML by a reader that links bare URLs too.
  for (const md of [`[a](${U})`, `![a](${U})`, `<${U}>`, `[a][1]\n\n[1]: ${U}`, `<a href="${U}">a</a>`, `<i style="background:url(${U})">x</i>`, U, `\\[a\\](${U})`,
    `x <style>@import url(${U});</style>`, `x <script>location='${U}'</script>`])
    assert.ok(liveInMarkdown(md, T), md);
  for (const md of [`\`${U}\``, `    ${U}`, `\`\`\`\n${U}\n\`\`\``, `\`\`\`${T}\nx\n\`\`\``, `[a](/b "${U}")`, `![${U}](/a.png)`, `x ${T} y`])
    assert.ok(!liveInMarkdown(md, T), md);
  assert.ok(LIVE.text(`site (${U})`, T));
  assert.ok(!LIVE.text(`Source: ${U}`, T));
});

test('every field a renderer puts where text is live is on ADDRESS_KEYS, or on LINKED_BY_RULE and kept to its rule', () => {
  const blocks = goldenBlocks();
  const found = survey(blocks);
  // The search is live: every fence type the goldens hold rendered (a spliced code block too),
  // 228 marker probes rendered today, and a link's href is live in all three outputs.
  assert.deepEqual([...found.types].sort(), [...new Set(blocks.map((b) => b.type))].sort());
  assert.ok(found.rendered >= 200, `${found.rendered} probes rendered`);
  assert.deepEqual(found.linked.get('paragraph.content[].marks[].href')?.where, ['html', 'markdown', 'text']);
  assert.deepEqual(problems(found), []);
});

// Each plant below is a renderer change the search must catch, or must let through. The real
// renderers cannot be changed inside a test, so each stub wraps them and adds its own output.
const only = (type) => goldenBlocks().filter((b) => b.type === type);
const attr = (s) => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const https = (v) => typeof v === 'string' && v.startsWith('https://');
const plant = (where, add) => ({ ...REAL, [where]: (doc) => REAL[where](doc) + doc.map(add).join('') });
const html = (add) => plant('html', (b) => (b.type === 'stat' && https(b.unit) ? add(attr(b.unit)) : ''));

test('plants: a renderer that puts a field in any live place is caught, a form no one named included', () => {
  const cases = [
    ['code.lang as a Markdown link', 'code', plant('markdown', (b) => (https(b.lang) ? `\n\n[lang](${b.lang})\n` : '')), 'code.lang (markdown)'],
    ['stat.label as a Markdown reference link', 'stat', plant('markdown', (b) => (https(b.label) ? `\n\n[site][1]\n\n[1]: ${b.label}\n` : '')), 'stat.label (markdown)'],
    ['a CSS url() quoted with &quot;', 'stat', html((u) => `<i style="background:url(&quot;${u}&quot;)"></i>`), 'stat.unit (html)'],
    ['a second srcset candidate', 'stat', html((u) => `<img srcset="/a.png 1x, ${u} 2x" alt="">`), 'stat.unit (html)'],
    ['@import "…" in a style element', 'stat', html((u) => `<style>@import "${u}";</style>`), 'stat.unit (html)'],
    ['image-set("…" 1x)', 'stat', html((u) => `<i style="background-image:image-set(&quot;${u}&quot; 1x)"></i>`), 'stat.unit (html)'],
    ['a meta refresh', 'stat', html((u) => `<meta http-equiv="refresh" content="0;url=${u}">`), 'stat.unit (html)'],
    ['an iframe srcdoc', 'stat', html((u) => `<iframe srcdoc="&lt;a href=&quot;${u}&quot;&gt;x&lt;/a&gt;"></iframe>`), 'stat.unit (html)'],
    ['an SVG <set> of href', 'stat', html((u) => `<svg><a><set attributeName="href" to="${u}"/></a></svg>`), 'stat.unit (html)'],
    ['a made-up element and attribute', 'stat', html((u) => `<pd-portal destination="${u}"></pd-portal>`), 'stat.unit (html)'],
    ['only the hostname, as an icon query', 'stat', plant('html', (b) => (b.type === 'stat' && https(b.unit) ? `<img alt="" src="https://icons.example/?d=${new URL(b.unit.trim()).hostname}">` : '')), 'stat.unit (html)'],
    ['an inline <style> mid-paragraph in Markdown', 'stat', plant('markdown', (b) => (https(b.unit) ? `\n\nx <style>@import url(${b.unit});</style>\n` : '')), 'stat.unit (markdown)'],
    ['an inline <script> mid-paragraph in Markdown', 'stat', plant('markdown', (b) => (https(b.unit) ? `\n\nx <script>location='${b.unit}'</script>\n` : '')), 'stat.unit (markdown)'],
  ];
  for (const [what, type, render, field] of cases) assert.ok(problems(survey(only(type), render)).includes(`live but on neither list: ${field}`), what);
});

test('plants: a field written where text is inert (alt, title, aria-label, text, a code span, a link title) is let through', () => {
  const inert = [
    plant('html', (b) => (b.type === 'stat' ? `<img alt="${attr(b.unit)}" title="${attr(b.label)}"><b aria-label="${attr(b.body)}">${attr(b.unit)}</b>` : '')),
    plant('markdown', (b) => (b.type === 'stat' ? `\n\n\`${b.unit}\` and [x](/a "${String(b.label).replaceAll('"', '')}") and ![${b.body}](/a.png)\n` : '')),
  ];
  for (const render of inert) assert.deepEqual(problems(survey(only('stat'), render)).filter((p) => !p.startsWith('on LINKED_BY_RULE but linked nowhere: sourceDefault')), []);
});

test('plants: a LINKED_BY_RULE entry whose renderer lets through more than its prefix is caught, through new URL() too', () => {
  const rules = { ...LINKED_BY_RULE, label: { prefix: 'https://', trimmed: true } };
  const label = (b) => (b.type === 'stat' && typeof b.label === 'string' ? b.label : '');
  // Links https:// and data: only.
  const data = plant('markdown', (b) => (/^\s*(?:https:\/\/|data:)/.test(label(b)) ? `\n\n[site](${label(b).trim()})\n` : ''));
  const dataFound = problems(survey(only('stat'), data), rules);
  assert.ok(dataFound.some((p) => p.startsWith('live against its rule: stat.label = "data:text/html,x"')), dataFound.join('\n'));
  assert.ok(!dataFound.some((p) => p.startsWith('live against its rule: stat.label = "https://')), 'an https:// label is allowed');
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
  const normalized = problems(survey(only('stat'), normalizing), rules);
  assert.ok(normalized.some((p) => p.startsWith('live against its rule: stat.label = "java\\tscript:alert(1)"')), normalized.join('\n'));
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
