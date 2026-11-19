import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { renderPortableDocument } from '@portable-doc/react';
import { blockSchema } from '@portable-doc/validate';
import { FENCE_TYPES } from './from-markdown.js';
import { fromMarkdown, toMarkdown, toPlainText } from './index.js';
import { ADDRESS_KEYS, LINKED_BY_RULE } from './util.js';

// Which fields of a ```portabledoc fence does a renderer turn into an address? Ask the
// renderers, not the field names: put a URL in one field at a time, splice the fence
// with fromMarkdown, render it as HTML, Markdown and plain text, and look for the URL
// where an address goes.

const goldens = new URL('../../goldens/blocks/', import.meta.url);
const MARK = 'https://marker.example/p';
// Values the `source` rule must never link: only a value that starts with https:// once
// trimmed is linked (` https://…` is linked as `https://…`, which the rule allows).
const NOT_HTTPS = ['http://marker.example/p', 'data:text/html,x', '//marker.example/p', 'mailto:m@marker.example', 'vbscript:x', ' data:text/html,x', '\thttp://marker.example/p', 'HTTPS://marker.example/p', 'https:marker.example/p'];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** Where an address goes, per output: `url` in that place, or not. A value is looked for trimmed, as a renderer may trim it. */
const FIND = {
  // A URL attribute, any srcset candidate, or a CSS url() with any quote, escaped or not.
  html: (u) => new RegExp(`\\s(?:href|src|poster|action|formaction|cite|data|background|ping|xlink:href|data-[\\w-]*(?:src|href|url))\\s*=\\s*["']?${u}|\\ssrcset\\s*=\\s*["']?(?:[^"']*,\\s*)?${u}|url\\(\\s*(?:["']|&quot;|&#0*39;|&#x0*27;|&apos;)?\\s*${u}`, 'i'),
  // An inline link or image, an autolink, or a reference definition.
  markdown: (u) => new RegExp(`\\]\\(\\s*<?${u}|<${u}>|^ {0,3}\\[[^\\]]+\\]:\\s*<?${u}`, 'm'),
  // Plain text writes a link as "label (url)".
  text: (u) => new RegExp(`\\(\\s*${u}`),
};
const found = (where, output, value) => FIND[where](escape(value.trim())).test(output);

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

/** Where `block` shows `value` as an address after a round trip through a fence: a list of outputs, or null when the fence stays code. */
function addressedIn(block) {
  const blocks = [block];
  const doc = fromMarkdown(fence(blocks));
  // The fence's own fallback, not a spliced code block, means it was refused.
  if (doc.length === 1 && doc[0].type === 'code' && doc[0].value === JSON.stringify(blocks)) return null;
  const out = { html: renderPortableDocument(doc, {}), markdown: toMarkdown(doc), text: toPlainText(doc) };
  return (value) => Object.keys(out).filter((where) => found(where, out[where], value));
}

// Keys a renderer asks for that the block does not have, by path: what it would read if a doc filled them.
const NOT_FIELDS = new Set(['then', 'toJSON', 'constructor', '$$typeof', 'length', '__proto__', 'valueOf', 'toString', 'nodeType', 'props', 'key', 'ref', '_owner', '_store']);
function readsMissing(block) {
  const reads = new Map();
  const wrap = (v, path) =>
    new Proxy(v, {
      get(t, k, r) {
        if (typeof k === 'string' && !NOT_FIELDS.has(k) && !Array.isArray(t) && !(k in t)) reads.set(JSON.stringify([...path, k]), [...path, k]);
        const x = Reflect.get(t, k, r);
        return typeof k === 'string' && x && typeof x === 'object' ? wrap(x, [...path, Array.isArray(t) ? Number(k) : k]) : x;
      },
    });
  const watched = wrap(block, []);
  for (const render of [() => renderPortableDocument([watched], {}), () => toMarkdown([watched]), () => toPlainText([watched])]) render();
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

test('the address search finds a URL in each place an address goes, and not in text', () => {
  const at = (where, output) => found(where, output, MARK);
  for (const html of [`<a href="${MARK}">`, `<img src='${MARK}'>`, `<img srcset="/a.png 1x, ${MARK} 2x">`, `<img srcset="${MARK} 1x">`, `<i style="background:url(${MARK})">`, `<i style="background:url('${MARK}')">`, `<i style="background-image:url(&quot;${MARK}&quot;)">`, `<i style="background:url(&#39;${MARK}&#39;)">`, `<form action="${MARK}">`, `<p data-cast-src="${MARK}">`]) assert.ok(at('html', html), html);
  for (const html of [`<p>${MARK}</p>`, `<img alt="${MARK}">`, `<p title="${MARK}">`]) assert.ok(!at('html', html), html);
  for (const md of [`[a](${MARK})`, `![a](${MARK})`, `[a](<${MARK}>)`, `<${MARK}>`, `[a][1]\n\n[1]: ${MARK}`, `x\n   [ref]: <${MARK}>`]) assert.ok(at('markdown', md), md);
  for (const md of [MARK, `\`${MARK}\``, `    [1]: ${MARK}`]) assert.ok(!at('markdown', md), md);
  assert.ok(at('text', `site (${MARK})`));
  assert.ok(!at('text', `Source: ${MARK}`));
});

test('every field a renderer shows as an address is on ADDRESS_KEYS, or on LINKED_BY_RULE and kept to its rule', () => {
  const linked = new Map();
  const renderedTypes = new Set();
  let rendered = 0;
  const blocks = goldenBlocks();
  for (const block of blocks) {
    const seen = new Set();
    const paths = [...strings(block), ...readsMissing(block)].filter((p) => p.at(-1) !== 'type' && !seen.has(JSON.stringify(p)) && seen.add(JSON.stringify(p)));
    for (const path of paths) {
      const field = name(block.type, path);
      const probe = (value) => {
        const copy = withValue(block, path, value);
        const where = copy && addressedIn(copy);
        if (where && value === MARK) rendered++, renderedTypes.add(block.type);
        return where ? where(value) : [];
      };
      const where = probe(MARK);
      if (where.length) linked.set(field, { key: path.at(-1), where, probe });
      // No field, wherever it sits, carries a script address into any output.
      assert.deepEqual(probe('javascript:alert(1)'), [], field);
    }
  }
  // The search is live: it rendered every fence type the goldens hold, and found a link's href in all three outputs.
  assert.deepEqual([...renderedTypes].sort(), [...new Set(blocks.map((b) => b.type))].sort());
  // 228 today: a marker probe counts only when its fence was spliced and rendered.
  assert.ok(rendered >= 200, `${rendered} probes rendered`);
  assert.deepEqual(linked.get('paragraph.content[].marks[].href')?.where, ['html', 'markdown', 'text']);
  const off = [...linked].filter(([, { key }]) => !ADDRESS_KEYS.includes(key) && !Object.hasOwn(LINKED_BY_RULE, key));
  assert.deepEqual(off.map(([field, { where }]) => `${field} (${where.join(', ')})`), [], 'shown as an address but on neither list');
  // The rule list names only fields a renderer links today, and their rule holds: nothing but https:// is linked.
  const ruled = [...linked].filter(([, { key }]) => Object.hasOwn(LINKED_BY_RULE, key));
  assert.deepEqual([...new Set(ruled.map(([, { key }]) => key))].sort(), Object.keys(LINKED_BY_RULE).sort());
  assert.deepEqual(ruled.map(([field]) => field).sort(), ['stat.source', 'stats.items[].source', 'stats.sourceDefault']);
  for (const [field, { probe }] of ruled) for (const value of NOT_HTTPS) assert.deepEqual(probe(value), [], `${field} = ${JSON.stringify(value)}`);
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
