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

// Which fields of a ```portabledoc fence does a renderer turn into an address? Ask the
// renderers, not the field names: put a URL in one field at a time, splice the fence
// with fromMarkdown, render it as HTML, Markdown and plain text, parse what comes out,
// and look for the URL among the addresses the parse finds.

const goldens = new URL('../../goldens/blocks/', import.meta.url);
const MARK = 'https://marker.example/p';
const SCRIPT = 'javascript:alert(1)';
// The first 13 rows are copied from packages/editor/src/canvas/__safe_url_paint.test.mjs, which
// matches safe_url/1 row for row; the rest are data: and http:// forms. Under a LINKED_BY_RULE
// entry only a value its rule allows may link.
const URL_CASES = [
  'https://example.com/a', 'mailto:a@b.c', '/media/files/x.png', '#anchor', './rel', 'javascript:alert(1)', ' JaVaScRiPt:alert(1)',
  'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', '//evil.example/x', '/\\evil.example/x',
  '/\t/evil.example/x', 'data:text/html,x', ' data:text/html,x', 'http://example.com/a', '\thttp://example.com/a', ' https://example.com/a',
  'HTTPS://example.com/a', 'https:example.com/a',
];
const allowed = (value, rule) => (rule.trimmed ? value.trim() : value).startsWith(rule.prefix);

// ── what each output holds as an address ────────────────────────────────

const URL_ATTRS = new Set(['href', 'src', 'poster', 'action', 'formaction', 'xlink:href', 'cite', 'background', 'ping', 'longdesc', 'manifest', 'icon']);
const SRCSET_ATTRS = new Set(['srcset', 'imagesrcset']);
const cssUnescape = (css) => css.replace(/\\([0-9a-f]{1,6}\s?|[^0-9a-f\n])/gi, (_, e) => (/^[0-9a-f]/i.test(e) ? String.fromCodePoint(parseInt(e, 16)) : e));
const cssUrls = (css) => [...cssUnescape(css).matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)].map((m) => (m[1] ?? m[2] ?? m[3]).trim());

/** Every address in an HTML string: URL attributes, each srcset candidate, and each CSS url() in a style attribute or element, entities decoded by the parse. */
export function htmlUrls(html) {
  const urls = [];
  for (const el of JSDOM.fragment(html).querySelectorAll('*')) {
    for (const { name, value } of el.attributes) {
      if (URL_ATTRS.has(name) || /^data-[\w-]*(?:src|href|url)$/.test(name) || (name === 'data' && el.localName === 'object')) urls.push(value);
      else if (SRCSET_ATTRS.has(name)) urls.push(...value.split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean));
      else if (name === 'style') urls.push(...cssUrls(value));
    }
    if (el.localName === 'style') urls.push(...cssUrls(el.textContent));
  }
  return urls;
}

// The repo's markdown-it, keeping every destination as written: no scheme check, no
// normalising, and no linkify (a bare URL in text is text the renderer wrote, not a link).
const markdown = new MarkdownIt('default', { html: true, linkify: false });
markdown.validateLink = () => true;
markdown.normalizeLink = (url) => url;

/** Every address in a Markdown string: link and image destinations, autolinks, reference definitions, and addresses in raw HTML. */
export function markdownUrls(src) {
  const env = {};
  const urls = [];
  const walk = (tokens) => {
    for (const t of tokens) {
      if (t.type === 'link_open') urls.push(t.attrGet('href'));
      else if (t.type === 'image') urls.push(t.attrGet('src'));
      else if (t.type === 'html_inline' || t.type === 'html_block') urls.push(...htmlUrls(t.content));
      if (t.children) walk(t.children);
    }
  };
  walk(markdown.parse(src, env));
  for (const ref of Object.values(env.references ?? {})) urls.push(ref.href);
  return urls;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const decoded = (url) => {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
};
/** Is `value` (trimmed, as a renderer may trim it) an address in this output? Plain text writes a link as "label (url)". */
const HAS = {
  html: (out, v) => htmlUrls(out).some((u) => u.includes(v) || decoded(u).includes(v)),
  markdown: (out, v) => markdownUrls(out).some((u) => u.includes(v) || decoded(u).includes(v)),
  text: (out, v) => new RegExp(`\\(\\s*${escape(v)}`).test(out),
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

/** Probe every field of `blocks` through `render`: which come out as an address, and how many probes rendered. */
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
      const probe = (value) => {
        const copy = withValue(block, path, value);
        const doc = copy && spliced(copy);
        if (!doc) return [];
        if (value === MARK) rendered++, types.add(block.type);
        return Object.keys(render).filter((where) => HAS[where](render[where](doc), value.trim()));
      };
      const where = probe(MARK);
      if (where.length) linked.set(field, { key: path.at(-1), where, probe });
      const leak = probe(SCRIPT);
      if (leak.length) leaks.push(`javascript: shown as an address: ${field} (${leak.join(', ')})`);
    }
  }
  return { linked, leaks, types, rendered };
}

/** What breaks the rules: a script address anywhere, a field shown as an address on neither list, a ruled field linking a value its rule does not allow, a rule that links nothing. */
function problems({ linked, leaks }, rules = LINKED_BY_RULE) {
  const out = [...leaks];
  for (const [field, { key, where, probe }] of linked) {
    if (ADDRESS_KEYS.includes(key)) continue;
    if (!Object.hasOwn(rules, key)) {
      out.push(`shown as an address but on neither list: ${field} (${where.join(', ')})`);
      continue;
    }
    for (const value of [MARK, ...URL_CASES]) {
      const at = probe(value);
      if (at.length && !allowed(value, rules[key])) out.push(`linked against its rule: ${field} = ${JSON.stringify(value)} (${at.join(', ')})`);
    }
  }
  for (const key of Object.keys(rules)) if (![...linked.values()].some((l) => l.key === key)) out.push(`on LINKED_BY_RULE but linked nowhere: ${key}`);
  return out;
}

// ── tests ───────────────────────────────────────────────────────────────

test('the address collectors find a URL in each place an address goes, and not in text', () => {
  const inHtml = (html) => htmlUrls(html).includes(MARK);
  const inMd = (md) => markdownUrls(md).includes(MARK);
  for (const html of [
    `<a href="${MARK}">`, `<img src='${MARK}'>`, `<img srcset="/a.png 1x, ${MARK} 2x">`, `<img srcset="${MARK} 1x">`, `<i style="background:url(${MARK})">`,
    `<i style="background:url('${MARK}')">`, `<i style="background-image:url(&quot;${MARK}&quot;)">`, `<i style="background:url(&#39;${MARK}&#39;)">`,
    `<style>.a{background:url("${MARK}")}</style>`, `<form action="${MARK}">`, `<button formaction="${MARK}">`, `<object data="${MARK}">`,
    `<svg><image xlink:href="${MARK}"/></svg>`, `<p data-cast-src="${MARK}">`, `<video poster="${MARK}">`,
  ]) assert.ok(inHtml(html), html);
  for (const html of [`<p>${MARK}</p>`, `<img alt="${MARK}">`, `<p title="${MARK}">`, `<p data="${MARK}">`]) assert.ok(!inHtml(html), html);
  for (const md of [`[a](${MARK})`, `![a](${MARK})`, `[a](<${MARK}>)`, `<${MARK}>`, `[a][1]\n\n[1]: ${MARK}`, `x\n\n   [ref]: <${MARK}>`, `<a href="${MARK}">a</a>`]) assert.ok(inMd(md), md);
  for (const md of [MARK, `\`${MARK}\``, `    [1]: ${MARK}`, `\\[a\\](${MARK})`]) assert.ok(!inMd(md), md);
  assert.ok(HAS.text(`site (${MARK})`, MARK));
  assert.ok(!HAS.text(`Source: ${MARK}`, MARK));
});

test('every field a renderer shows as an address is on ADDRESS_KEYS, or on LINKED_BY_RULE and kept to its rule', () => {
  const blocks = goldenBlocks();
  const found = survey(blocks);
  // The search is live: every fence type the goldens hold rendered (a spliced code block too),
  // 228 marker probes rendered today, and a link's href is found in all three outputs.
  assert.deepEqual([...found.types].sort(), [...new Set(blocks.map((b) => b.type))].sort());
  assert.ok(found.rendered >= 200, `${found.rendered} probes rendered`);
  assert.deepEqual(found.linked.get('paragraph.content[].marks[].href')?.where, ['html', 'markdown', 'text']);
  assert.deepEqual(problems(found), []);
});

// Each plant below is a renderer change the search must catch. The real renderers cannot
// be changed inside a test, so each wraps them in a stub that adds the planted output.
const only = (type) => goldenBlocks().filter((b) => b.type === type);
const attr = (s) => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const https = (v) => typeof v === 'string' && v.startsWith('https://');
const plant = (where, add) => ({ ...REAL, [where]: (doc) => REAL[where](doc) + doc.map(add).join('') });

test('plants: a renderer that links a field is caught however it writes the link', () => {
  const cases = [
    ['code.lang as a Markdown link', 'code', plant('markdown', (b) => (https(b.lang) ? `\n\n[lang](${b.lang})\n` : '')), 'code.lang (markdown)'],
    ['stat.unit in a CSS url() quoted with &quot;', 'stat', plant('html', (b) => (https(b.unit) ? `<i style="background:url(&quot;${attr(b.unit)}&quot;)"></i>` : '')), 'stat.unit (html)'],
    ['stat.unit as a second srcset candidate', 'stat', plant('html', (b) => (https(b.unit) ? `<img srcset="/a.png 1x, ${attr(b.unit)} 2x" alt="">` : '')), 'stat.unit (html)'],
    ['stat.label as a Markdown reference link', 'stat', plant('markdown', (b) => (https(b.label) ? `\n\n[site][1]\n\n[1]: ${b.label}\n` : '')), 'stat.label (markdown)'],
  ];
  for (const [what, type, render, field] of cases) assert.ok(problems(survey(only(type), render)).includes(`shown as an address but on neither list: ${field}`), what);
});

test('plants: a LINKED_BY_RULE entry whose renderer links more than its prefix is caught', () => {
  const render = plant('markdown', (b) => (/^\s*(?:https:\/\/|data:)/.test(b.label ?? '') ? `\n\n[site](${b.label.trim()})\n` : ''));
  const rules = { ...LINKED_BY_RULE, label: { prefix: 'https://', trimmed: true } };
  const found = problems(survey(only('stat'), render), rules);
  assert.ok(found.includes('linked against its rule: stat.label = "data:text/html,x" (markdown)'), found.join('\n'));
  assert.ok(!found.some((p) => p.includes('stat.label = "https://')), 'an https:// label is allowed');
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
