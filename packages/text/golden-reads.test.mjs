import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderPortableDocument } from '@portable-doc/react';
import { FENCE_TYPES } from './from-markdown.js';
import { filledNames, goldenBlocks, pathName, reads, readsMissing } from './golden-reads.mjs';
import { toMarkdown, toPlainText } from './index.js';

const RENDERS = { html: (blocks) => renderPortableDocument(blocks, {}), markdown: toMarkdown, text: toPlainText };

// Keys the HTML, Markdown or text renderer reads on a fence-type block that no golden
// fills yet, as pathName writes them. The goldens come from Barkpark's golden pack, so
// the fills belong there: its twin task fills every renderer-read key in the fence-type
// goldens. This list may only shrink. A key filled by some golden, or no longer read,
// must leave it; a new read key that no golden fills fails until a golden fills it.
// A second name for a key, mapped to the key's own name. Goldens and writers use the
// canonical name; readers accept the alias for old docs until the format drops it.
const READ_ALIASES = {
  'blockquote.attribution': 'blockquote.cite',
  'callout.text': 'callout.content',
  'code.code': 'code.value',
  'code.content': 'code.value',
  'code.language': 'code.lang',
  'code.text': 'code.value',
  'eyebrow.text': 'eyebrow.content',
  'heading.text': 'heading.content',
  'paragraph.text': 'paragraph.content',
  'pullquote.text': 'pullquote.content',
  'table.cols': 'table.columns',
  'table.header': 'table.head',
  'terminal.blocks': 'terminal.children',
};
// Aliases a golden still uses, until Barkpark's pack moves it to the canonical name. Only shrinks.
const GOLDENS_STILL_USE_ALIAS = ['eyebrow.text', 'heading.text'];

const NOT_FILLED_YET = [
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
  }
  return { read, missing, filled };
}

test('every key a renderer reads on a fence-type golden is filled in some golden, or on NOT_FILLED_YET, which only shrinks', () => {
  const { read, missing, filled } = survey();
  assert.ok(missing.size > 0, 'the Proxy saw no reads: the survey is broken');
  const unfilled = [...missing].filter((name) => !filled.has(name) && !Object.hasOwn(READ_ALIASES, name)).sort();
  const listed = new Set(NOT_FILLED_YET);
  assert.deepEqual(NOT_FILLED_YET, [...listed].sort(), 'NOT_FILLED_YET is sorted, each key once');
  assert.deepEqual(unfilled.filter((name) => !listed.has(name)), [], 'read by a renderer and filled by no golden: fill it in a golden (in Barkpark\'s pack)');
  assert.deepEqual(NOT_FILLED_YET.filter((name) => filled.has(name)), [], 'filled by a golden now: take it off NOT_FILLED_YET');
  assert.deepEqual(NOT_FILLED_YET.filter((name) => !read.has(name)), [], 'no renderer reads it now: take it off NOT_FILLED_YET');
});

test('each READ_ALIASES alias is read in place of its canonical key, the canonical key is read, and no golden uses the alias but those listed', () => {
  assert.deepEqual(Object.keys(READ_ALIASES), Object.keys(READ_ALIASES).sort(), 'READ_ALIASES is sorted');
  const inGoldens = [];
  for (const [alias, canonical] of Object.entries(READ_ALIASES)) {
    const type = alias.split('.')[0];
    assert.equal(canonical.split('.')[0], type, `${alias}: an alias and its key are on one block type`);
    const goldens = goldenBlocks(new Set([type])).map(({ block }) => block);
    assert.ok(goldens.length, `${alias}: no ${type} golden to check it on`);
    const readOn = (blocks) => new Set(blocks.flatMap((block) => reads(block, RENDERS).map((r) => pathName(type, r.path))));
    assert.ok(readOn(goldens).has(canonical), `${canonical}, the key ${alias} stands for, is read by no renderer`);
    // A reader takes the alias only while the canonical key is empty, so ask with it taken out.
    const key = canonical.split('.').at(-1);
    const without = goldens.map((block) => Object.fromEntries(Object.entries(block).filter(([k]) => k !== key)));
    assert.ok(readOn(without).has(alias), `no renderer reads ${alias} when ${canonical} is empty: take it off READ_ALIASES`);
    if (goldens.some((block) => filledNames(block).has(alias))) inGoldens.push(alias);
  }
  assert.deepEqual(inGoldens, GOLDENS_STILL_USE_ALIAS, 'which goldens use an alias: a golden uses the canonical name, and GOLDENS_STILL_USE_ALIAS lists those not moved yet');
});

test('the survey sees a read key a golden leaves out, by its path, and a key a golden fills', () => {
  const block = { type: 'stats', items: [{ value: '1', label: 'a' }] };
  const reads = readsMissing(block, { probe: ([b]) => [b.items[0].body, b.items[0].value, b.title] }).map((path) => pathName('stats', path));
  assert.deepEqual(reads, ['stats.items[].body', 'stats.title']);
  assert.deepEqual([...filledNames(block)].sort(), ['stats.items', 'stats.items[].label', 'stats.items[].value', 'stats.type']);
});
