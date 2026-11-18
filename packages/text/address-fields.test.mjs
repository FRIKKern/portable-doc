import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { renderPortableDocument } from '@portable-doc/react';
import { blockSchema } from '@portable-doc/validate';
import { FENCE_TYPES } from './from-markdown.js';
import { fromMarkdown, toMarkdown, toPlainText } from './index.js';
import { ADDRESS_KEYS, LINKED_BY_RULE } from './util.js';

// Which fields of a ```portabledoc fence does a renderer turn into an address? Ask the
// renderers, not the field names: put a URL in one string field at a time, splice the
// fence with fromMarkdown, render it as HTML, Markdown and plain text, and look for the
// URL where an address goes.

const goldens = new URL('../../goldens/blocks/', import.meta.url);
const MARK = 'https://marker.example/p';
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
// HTML attributes that hold a URL, a CSS url(), a Markdown link or autolink, and plain text's "label (url)".
const html = (url) => new RegExp(`\\s(?:href|src|srcset|poster|action|formaction|cite|data|background|ping|xlink:href|data-[\\w-]*(?:src|href|url))="${escape(url)}|url\\(['"]?${escape(url)}`, 'i');
const md = (url) => new RegExp(`\\]\\(${escape(url)}|<${escape(url)}>`);
const text = (url) => new RegExp(`\\(${escape(url)}`);

const fence = (blocks) => '```portabledoc\n' + JSON.stringify(blocks) + '\n```';
const strings = (v, path = []) => (typeof v === 'string' ? [path] : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => strings(x, [...path, Array.isArray(v) ? Number(k) : k])) : []);
const withValue = (block, path, value) => {
  const copy = structuredClone(block);
  let at = copy;
  for (const key of path.slice(0, -1)) at = at[key];
  at[path.at(-1)] = value;
  return copy;
};
const name = (block, path) => [block.type, ...path].map((k) => (typeof k === 'number' ? '[]' : k)).join('.').replaceAll('.[]', '[]');

/** Where the block with `value` at `path` shows it as an address after a round trip through a fence: [] when nowhere, or when the fence stays code. */
function addressedIn(block, path, value) {
  const doc = fromMarkdown(fence([withValue(block, path, value)]));
  if (doc.length === 1 && doc[0].type === 'code') return [];
  const out = { html: [renderPortableDocument(doc, {}), html], markdown: [toMarkdown(doc), md], text: [toPlainText(doc), text] };
  return Object.entries(out).filter(([, [rendered, find]]) => find(value).test(rendered)).map(([where]) => where);
}

/** Every fence-type block in the goldens, with each string field the schema gives its type and the golden leaves out added. */
function blocks() {
  const found = [];
  for (const file of fs.readdirSync(goldens).filter((f) => f.endsWith('.golden.json')).sort()) {
    const { input } = JSON.parse(fs.readFileSync(new URL(file, goldens), 'utf8'));
    for (const block of Array.isArray(input) ? input : (input?.blocks ?? [input])) {
      if (!block || !FENCE_TYPES.has(block.type)) continue;
      const declared = blockSchema.definitions.blocks[block.type]?.properties ?? {};
      const extra = Object.entries(declared).filter(([k, p]) => !Object.hasOwn(block, k) && [p.type].flat().includes('string'));
      found.push({ ...block, ...Object.fromEntries(extra.map(([k]) => [k, 'x'])) });
    }
  }
  return found;
}

test('every field a renderer shows as an address is on ADDRESS_KEYS, or on LINKED_BY_RULE and kept to its rule', () => {
  const linked = new Map();
  let fields = 0;
  for (const block of blocks()) {
    for (const path of strings(block)) {
      if (path.at(-1) === 'type') continue;
      fields++;
      const where = addressedIn(block, path, MARK);
      if (where.length) linked.set(name(block, path), { key: path.at(-1), where, block, path });
      // No string field, wherever it sits, carries a script address into any output.
      assert.deepEqual(addressedIn(block, path, 'javascript:alert(1)'), [], name(block, path));
    }
  }
  // The search is live: it read the fields, and it finds a link's href in all three outputs.
  assert.ok(fields >= 80, `${fields} string fields`);
  assert.deepEqual(linked.get('paragraph.content[].marks[].href')?.where, ['html', 'markdown', 'text']);
  const off = [...linked].filter(([, { key }]) => !ADDRESS_KEYS.includes(key) && !Object.hasOwn(LINKED_BY_RULE, key));
  assert.deepEqual(off.map(([field, { where }]) => `${field} (${where.join(', ')})`), [], 'shown as an address but on neither list');
  // The rule list names only fields a renderer links today, and their rule holds: a URL that does not start with https:// stays text.
  const ruled = [...linked].filter(([, { key }]) => Object.hasOwn(LINKED_BY_RULE, key));
  assert.deepEqual([...new Set(ruled.map(([, { key }]) => key))].sort(), Object.keys(LINKED_BY_RULE).sort());
  assert.deepEqual(ruled.map(([field]) => field).sort(), ['stat.source', 'stats.items[].source', 'stats.sourceDefault']);
  for (const [field, { block, path }] of ruled) assert.deepEqual(addressedIn(block, path, 'http://marker.example/p'), [], field);
});
