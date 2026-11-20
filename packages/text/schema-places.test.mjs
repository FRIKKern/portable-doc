// SPDX-License-Identifier: Apache-2.0
// Where the readers (React HTML, Markdown, plain text) read text and blocks on every golden and
// writer-case block, against where spec/blocks.schema.json types them (schema-places.mjs).
// schema-places.json lists each difference exactly: a new one fails, and so does a listed one that
// is no longer a difference, so the list only shrinks, row by row, in the change that types the
// place or stops the reader reading it.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { renderPortableDocument } from '@portable-doc/react';
import { goldenBlocks, writerCaseBlocks } from './golden-reads.mjs';
import { BLOCK_TYPES, toMarkdown, toPlainText } from './index.js';
import { places } from './schema-places.mjs';

const PINNED = JSON.parse(fs.readFileSync(new URL('./schema-places.json', import.meta.url), 'utf8'));
const RENDERS = { html: (blocks) => renderPortableDocument(blocks, {}), markdown: toMarkdown, text: toPlainText };
const TYPES = new Set(BLOCK_TYPES);

const CASES = [...goldenBlocks(TYPES), ...writerCaseBlocks(TYPES)];

test('every place the readers read, and the schema does not type, is listed by name and kind; the list only shrinks', () => {
  const got = places(CASES, RENDERS);
  const counts = { gaps: Object.keys(got.gaps).length, probed: got.probed.length, oldNames: got.oldNames.length };
  // Exact both ways: a new difference fails, and so does a listed one the schema now types.
  assert.deepEqual(got.gaps, PINNED.gaps, 'read where a case fills it, untyped in the schema: { name: kind }');
  assert.deepEqual(got.probed, PINNED.probed, 'read, filled by no case');
  assert.deepEqual(got.oldNames, PINNED.oldNames, 'old names (spec/read-aliases.json), read under the one-field-one-name rule');
  assert.deepEqual(counts, PINNED.counts);
  const textAndBlocks = Object.values(got.gaps).filter((k) => /inline|blocks|text/.test(k)).length;
  assert.equal(textAndBlocks, PINNED.counts.textAndBlocks, 'gaps that hold text, inline content or blocks');
});

test('a table cell is read by the readers and untyped in the schema', () => {
  const table = { type: 'table', head: ['A'], rows: [[[{ type: 'text', value: 'x' }]], ['y']] };
  const got = places([{ block: table }], RENDERS);
  assert.equal(got.gaps['table.rows[]'], 'inline text');
  assert.equal(got.gaps['table.head[]'], 'text');
});

test('the list is only as wide as the cases: a key a reader reads on a shape no case has is not seen', () => {
  // A planted reader that asks for `hidden` only when `flag` is set.
  const plant = { plant: ([b]) => (b.flag ? String(b.hidden) : '') };
  const block = { type: 'paragraph', content: [{ type: 'text', value: 'p' }] };
  assert.deepEqual(places([{ block }], plant), { gaps: {}, probed: ['paragraph.flag'], oldNames: [] });
  assert.deepEqual(places([{ block: { ...block, flag: true, hidden: 'h' } }], plant), { gaps: { 'paragraph.flag': 'other', 'paragraph.hidden': 'text' }, probed: [], oldNames: [] });
});
