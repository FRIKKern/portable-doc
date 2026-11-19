import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderPortableDocument } from '@portable-doc/react';
import { FENCE_TYPES } from './from-markdown.js';
import { SCHEMA_TYPES } from './block-forms.mjs';
import { READ_ALIASES, behaviourReads, changesRender, filledNames, goldenBlocks, pathName, reads, readsMissing } from './golden-reads.mjs';
import { toMarkdown, toPlainText } from './index.js';

const RENDERS = { html: (blocks) => renderPortableDocument(blocks, {}), markdown: toMarkdown, text: toPlainText };

// Old names a golden still uses, each with why. The goldens are synced from Barkpark's pack, never
// edited here. Matched both ways: a stale entry fails, and so does an unlisted use.
// An entry enters this list only in the same change that makes its name an old name (the golden
// did not change, the name did). After that the list only shrinks; adding an entry is never the
// fix for a golden that uses an old name. Its pinned length is a ceiling, lowered as the pack
// moves each field. That an old
// name still reads is the shared alias cases' job (read-aliases.test.mjs), not the goldens'.
// Both lists have pinned lengths too.
const PACK = 'Barkpark\'s pack has not moved it to the current name yet';
const GOLDENS_STILL_USE_ALIAS = { 'asciicast.poster': PACK, 'eyebrow.text': PACK, 'heading.text': PACK, 'note.text': PACK, 'notes.items[].text': PACK };

/** Every inline-node-like object in `block`: each object with a string `type` inside it, the block itself left out. */
const inlineNodes = (block) => {
  const out = [];
  const stack = Object.values(block);
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== 'object') continue;
    if (!Array.isArray(v) && typeof v.type === 'string') out.push(v);
    stack.push(...Object.values(v));
  }
  return out;
};

// Keys the HTML, Markdown or text renderer reads on a fence-type block that no golden
// fills yet, as pathName writes them. A key is read when the Proxy sees a renderer read it,
// or when giving it a valid value changes a render (behaviourReads in golden-reads.mjs).
// The goldens come from Barkpark's golden pack, so the fills belong there: its twin task
// fills every renderer-read key in the fence-type goldens. This list may only shrink. A key filled by some golden, or no longer read,
// must leave it; a new read key that no golden fills fails until a golden fills it.
// Its length is pinned, so adding a key is an edit a reviewer sees.
const NOT_FILLED_YET = [
  'callout.collapsed',
  'callout.collapsible',
  'callout.content[].content',
  'callout.content[].marks',
  'chart.axes.max',
  'chart.axes.min',
  'code.emphasis',
  'code.lang',
  'eyebrow.content',
  'heading.content',
  'heatmap.colLabels',
  'heatmap.marginals',
  'heatmap.max',
  'heatmap.mode',
  'heatmap.rowLabels',
  'heatmap.values',
  'list.items[][].content',
  'list.items[][].marks',
  'list.start',
  'list.task',
  'paragraph.content[].children[].content',
  'paragraph.content[].children[].marks',
  'paragraph.content[].content',
  'paragraph.content[].marks[].attrs',
  'pullquote.content[].content',
  'pullquote.content[].marks',
  'stat.verdict',
  'stats.items[].body',
  'stats.items[].denom',
  'stats.items[].max',
  'stats.items[].spark',
  'stats.items[].unit',
  'table.columns',
  'table.head[][].content',
  'table.head[][].marks',
  'table.rows[][][].content',
  'table.rows[][][].marks',
  'table.spans',
];

/** { read, missing, filled }: every key a renderer reads on a fence-type golden, the ones it reads while absent, and every key some golden fills. */
function survey() {
  const read = new Set();
  const missing = new Set();
  const filled = new Set();
  for (const { file, block } of goldenBlocks(FENCE_TYPES)) {
    for (const name of filledNames(block)) filled.add(name);
    let seen;
    try {
      seen = reads(block, RENDERS);
    } catch (error) {
      assert.fail(`${file}: a renderer threw on the golden: ${error.message}`);
    }
    for (const { path, present } of seen) {
      read.add(pathName(block.type, path));
      if (!present) missing.add(pathName(block.type, path));
    }
    // The Proxy is blind to reads made on a copy; the behaviour net is not.
    for (const path of behaviourReads(block, RENDERS)) {
      read.add(pathName(block.type, path));
      missing.add(pathName(block.type, path));
    }
  }
  return { read, missing, filled };
}

test('every key a renderer reads on a fence-type golden is filled in some golden, or on NOT_FILLED_YET, which only shrinks', () => {
  const { read, missing, filled } = survey();
  assert.ok(missing.size > 0, 'the Proxy saw no reads: the survey is broken');
  const unfilled = [...missing].filter((name) => !filled.has(name) && !Object.hasOwn(READ_ALIASES, name)).sort();
  const listed = new Set(NOT_FILLED_YET);
  assert.equal(NOT_FILLED_YET.length, 38, 'NOT_FILLED_YET\'s length is pinned: change it in the same edit');
  assert.deepEqual(NOT_FILLED_YET, [...listed].sort(), 'NOT_FILLED_YET is sorted, each key once');
  assert.deepEqual(unfilled.filter((name) => !listed.has(name)), [], 'read by a renderer and filled by no golden: fill it in a golden (in Barkpark\'s pack)');
  assert.deepEqual(NOT_FILLED_YET.filter((name) => filled.has(name)), [], 'filled by a golden now: take it off NOT_FILLED_YET');
  assert.deepEqual(NOT_FILLED_YET.filter((name) => !read.has(name)), [], 'no renderer reads it now: take it off NOT_FILLED_YET');
});

test('each READ_ALIASES alias is read in place of its canonical key, the canonical key is read, and no golden uses the alias but those listed', () => {
  assert.deepEqual(Object.keys(READ_ALIASES), Object.keys(READ_ALIASES).sort(), 'READ_ALIASES is sorted');
  assert.equal(Object.keys(READ_ALIASES).length, 27, 'READ_ALIASES\'s length is pinned: change it in the same edit');
  assert.equal(Object.keys(GOLDENS_STILL_USE_ALIAS).length, 5, 'GOLDENS_STILL_USE_ALIAS\'s length is pinned. An entry enters this list only in the same change that makes its name an old name (the golden did not change, the name did). After that the list only shrinks; adding an entry is never the fix for a golden that uses an old name.');
  for (const [name, reason] of Object.entries(GOLDENS_STILL_USE_ALIAS)) assert.ok(typeof reason === 'string' && reason.trim() !== '', `${name}: a golden on an old name says why`);
  const inGoldens = [];
  for (const [alias, canonical] of Object.entries(READ_ALIASES)) {
    const owner = alias.slice(0, alias.lastIndexOf('.'));
    assert.equal(canonical.slice(0, canonical.lastIndexOf('.')), owner, `${alias}: an alias and its key have one owner`);
    // An inline node's names are found on every block; an item's on its block type.
    const type = owner.startsWith('inline:') ? null : owner.split('.')[0];
    const goldens = type === null ? goldenBlocks(new Set(SCHEMA_TYPES)).map(({ block }) => block) : goldenBlocks(new Set([type])).map(({ block }) => block);
    assert.ok(goldens.length, `${alias}: no ${type} golden to check it on`);
    if (type === null) {
      const [nodeType, name] = [owner.slice('inline:'.length), alias.slice(alias.lastIndexOf('.') + 1)];
      if (goldens.some((block) => inlineNodes(block).some((n) => n.type === nodeType && Object.hasOwn(n, name)))) inGoldens.push(alias);
      continue;
    }
    if (goldens.some((block) => filledNames(block).has(alias))) inGoldens.push(alias);
    // An item's names are read through every renderer in read-aliases.test.mjs, case by case.
    if (owner !== type) continue;
    // Read by either net: the Proxy sees it read, or it changes a render (taken out, or given a value).
    const readOn = (blocks, name) => blocks.some((block) => reads(block, RENDERS).some((r) => pathName(type, r.path) === name) || changesRender(block, [], name.split('.')[1], RENDERS));
    assert.ok(readOn(goldens, canonical), `${canonical}, the key ${alias} stands for, is read by no renderer`);
    // A reader takes the alias only while the canonical key is empty, so ask with it taken out.
    const key = canonical.split('.').at(-1);
    const without = goldens.map((block) => Object.fromEntries(Object.entries(block).filter(([k]) => k !== key)));
    assert.ok(readOn(without, alias), `no renderer reads ${alias} when ${canonical} is empty: take it off READ_ALIASES`);
  }
  assert.deepEqual(inGoldens, Object.keys(GOLDENS_STILL_USE_ALIAS), 'which goldens use an old name. An entry enters this list only in the same change that makes its name an old name (the golden did not change, the name did). After that the list only shrinks; adding an entry is never the fix for a golden that uses an old name.');
});

test('the survey sees a read key a golden leaves out, by its path, and a key a golden fills; the behaviour net sees a read made on a copy', () => {
  const block = { type: 'stats', items: [{ value: '1', label: 'a' }] };
  const reads = readsMissing(block, { probe: ([b]) => [b.items[0].body, b.items[0].value, b.title] }).map((path) => pathName('stats', path));
  assert.deepEqual(reads, ['stats.items[].body', 'stats.title']);
  // A renderer that copies the item before reading max: the Proxy misses it, the net does not.
  const copying = { probe: ([b]) => b.items.map((item) => ({ ...item })).map((item) => `${item.value}/${item.max ?? ''}`).join() };
  assert.deepEqual(readsMissing(block, copying), []);
  assert.deepEqual(behaviourReads(block, copying).map((path) => pathName('stats', path)), ['stats.items[].max']);
  assert.deepEqual([...filledNames(block)].sort(), ['stats.items', 'stats.items[].label', 'stats.items[].value', 'stats.type']);
});
