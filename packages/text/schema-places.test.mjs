// SPDX-License-Identifier: Apache-2.0
// Where the readers (React HTML, Markdown, plain text) read text and blocks on every golden and
// writer-case block, against where spec/blocks.schema.json types them (schema-places.mjs).
// schema-places.json lists each difference exactly: a new one fails, and so does a listed one that
// is no longer a difference, so the list only shrinks, row by row, in the change that types the
// place or stops the reader reading it. The list is written from the run (schema-places-run.mjs):
//   node packages/text/schema-places-run.mjs --write

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { PIN, RENDERS, measure } from './schema-places-run.mjs';
import { places } from './schema-places.mjs';

const PINNED = JSON.parse(fs.readFileSync(PIN, 'utf8'));

test('every place the readers read, and the schema does not type, is listed by name and kind; the list only shrinks', () => {
  const got = measure();
  // Exact both ways: a new difference fails, and so does a listed one that no longer is one.
  assert.deepEqual(got.gaps, PINNED.gaps, 'read where a case fills it, untyped in the schema: { name: kind }');
  assert.deepEqual(got.probed, PINNED.probed, 'read, but filled by no case');
  assert.deepEqual(got.oldNames, PINNED.oldNames, 'old names (spec/read-aliases.json), read under the one-field-one-name rule');
  // textAndBlocks is the criterion's own subset: gaps that hold text, inline content or blocks.
  assert.deepEqual(got.counts, PINNED.counts);
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
