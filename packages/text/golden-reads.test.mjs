import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderPortableDocument } from '@portable-doc/react';
import { FENCE_TYPES } from './from-markdown.js';
import { filledNames, goldenBlocks, pathName, readsMissing } from './golden-reads.mjs';
import { toMarkdown, toPlainText } from './index.js';

const RENDERS = { html: (blocks) => renderPortableDocument(blocks, {}), markdown: toMarkdown, text: toPlainText };

// Keys the HTML, Markdown or text renderer reads on a fence-type block that no golden
// fills yet, as pathName writes them. The goldens come from Barkpark's golden pack, so
// the fills belong there: its twin task fills every renderer-read key in the fence-type
// goldens. This list may only shrink. A key filled by some golden, or no longer read,
// must leave it; a new read key that no golden fills fails until a golden fills it.
const NOT_FILLED_YET = [
  'callout.collapsible',
  'callout.content[].content',
  'callout.content[].marks',
  'chart.axes.max',
  'chart.axes.min',
  'code.emphasis',
  'code.lang',
  'code.language',
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
  'table.cols',
  'table.columns',
  'table.head[][].content',
  'table.head[][].marks',
  'table.rows[][][].content',
  'table.rows[][][].marks',
  'table.spans',
];

/** { read, filled }: every absent key a renderer reads on a fence-type golden, and every key some golden fills. */
function survey() {
  const read = new Set();
  const filled = new Set();
  for (const { file, block } of goldenBlocks(FENCE_TYPES)) {
    for (const name of filledNames(block)) filled.add(name);
    let paths;
    try {
      paths = readsMissing(block, RENDERS);
    } catch (error) {
      assert.fail(`${file}: a renderer threw on the golden: ${error.message}`);
    }
    for (const path of paths) read.add(pathName(block.type, path));
  }
  return { read, filled };
}

test('every key a renderer reads on a fence-type golden is filled in some golden, or on NOT_FILLED_YET, which only shrinks', () => {
  const { read, filled } = survey();
  assert.ok(read.size > 0, 'the Proxy saw no reads: the survey is broken');
  const unfilled = [...read].filter((name) => !filled.has(name)).sort();
  const listed = new Set(NOT_FILLED_YET);
  assert.deepEqual(NOT_FILLED_YET, [...listed].sort(), 'NOT_FILLED_YET is sorted, each key once');
  assert.deepEqual(unfilled.filter((name) => !listed.has(name)), [], 'read by a renderer and filled by no golden: fill it in a golden (in Barkpark\'s pack)');
  assert.deepEqual(NOT_FILLED_YET.filter((name) => filled.has(name)), [], 'filled by a golden now: take it off NOT_FILLED_YET');
  assert.deepEqual(NOT_FILLED_YET.filter((name) => !read.has(name)), [], 'no renderer reads it now: take it off NOT_FILLED_YET');
});

test('the survey sees a read key a golden leaves out, by its path, and a key a golden fills', () => {
  const block = { type: 'stats', items: [{ value: '1', label: 'a' }] };
  const reads = readsMissing(block, { probe: ([b]) => [b.items[0].body, b.items[0].value, b.title] }).map((path) => pathName('stats', path));
  assert.deepEqual(reads, ['stats.items[].body', 'stats.title']);
  assert.deepEqual([...filledNames(block)].sort(), ['stats.items', 'stats.items[].label', 'stats.items[].value', 'stats.type']);
});
