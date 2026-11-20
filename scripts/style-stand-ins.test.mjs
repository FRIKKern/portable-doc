import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { renderPortableDocument } from '@portable-doc/react';
import { validate } from '@portable-doc/validate';

// scripts/style-stand-ins.json: React's own output for blocks whose style no golden holds yet,
// recorded from the renderer before style formats were named. Each row is held byte for byte
// until the goldens carry its case; then the row goes, so the count only shrinks.

const { about, rows } = JSON.parse(fs.readFileSync(new URL('style-stand-ins.json', import.meta.url), 'utf8'));
const STAND_INS_MOST = 6;

// The style each row is there to hold, by case.
const HOLDS = {
  'a section cell with an order': ['order:2', 'order:1'],
  'a heatmap matrix with marginals and values': ['grid-template-columns:auto repeat(2,minmax(28px,auto)) auto'],
  'a heatmap matrix with marginals and no values': ['grid-template-columns:auto repeat(2,minmax(10px,44px)) auto'],
  'a heatmap grid with row labels': ['grid-template-columns:auto repeat(2,minmax(10px,44px))'],
  'a heatmap calendar with row labels': ['grid-template-columns:auto repeat(2,12px)'],
  'a heatmap matrix with values, no marginals and row labels': ['grid-template-columns:auto repeat(2,minmax(28px,auto))'],
};

test('every stand-in row renders its recorded bytes and holds its style', () => {
  assert.match(about, /not parity truth/);
  assert.ok(rows.length > 0 && rows.length <= STAND_INS_MOST, `${rows.length} rows; the count only shrinks`);
  assert.deepEqual(rows.map((row) => row.case).sort(), Object.keys(HOLDS).sort());
  for (const { case: name, block, html } of rows) {
    assert.ok(validate({ blocks: [block] }).ok, `${name}: the block does not validate`);
    assert.equal(renderPortableDocument([block]), html, name);
    for (const style of HOLDS[name]) assert.ok(html.includes(`style="${style}"`), `${name}: no style="${style}"`);
  }
});
