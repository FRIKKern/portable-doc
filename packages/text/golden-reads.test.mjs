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
// A second name a reader accepts for a key, mapped to the key's own name. Goldens and
// writers use the canonical name; readers accept the alias only so old docs still
// render. An alias is never a key to fill, so it is not on NOT_FILLED_YET.
const READ_ALIASES = {
  'code.language': 'code.lang', // packages/text blocks-prose.js: str(b.lang) || str(b.language)
};

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
  'table.cols',
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

test('each READ_ALIASES alias is read in place of its canonical key, the canonical key is read, and no golden uses the alias', () => {
  const { read, filled } = survey();
  for (const [alias, canonical] of Object.entries(READ_ALIASES)) {
    const type = alias.split('.')[0];
    assert.equal(canonical.split('.')[0], type, `${alias}: an alias and its key are on one block type`);
    assert.ok(read.has(canonical), `${canonical}, the key ${alias} stands for, is read by no renderer`);
    assert.ok(!filled.has(alias), `a golden uses the alias ${alias}: goldens use ${canonical}`);
    // A reader takes the alias only while the canonical key is empty, so ask with it taken out.
    const key = canonical.split('.').at(-1);
    const without = goldenBlocks(new Set([type])).map(({ block }) => Object.fromEntries(Object.entries(block).filter(([k]) => k !== key)));
    assert.ok(without.length, `${alias}: no ${type} golden`);
    const aliasRead = without.some((block) => reads(block, RENDERS).some((r) => pathName(type, r.path) === alias));
    assert.ok(aliasRead, `no renderer reads ${alias} when ${canonical} is empty: take it off READ_ALIASES`);
  }
});

test('the survey sees a read key a golden leaves out, by its path, and a key a golden fills', () => {
  const block = { type: 'stats', items: [{ value: '1', label: 'a' }] };
  const reads = readsMissing(block, { probe: ([b]) => [b.items[0].body, b.items[0].value, b.title] }).map((path) => pathName('stats', path));
  assert.deepEqual(reads, ['stats.items[].body', 'stats.title']);
  assert.deepEqual([...filledNames(block)].sort(), ['stats.items', 'stats.items[].label', 'stats.items[].value', 'stats.type']);
});
