import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { renderPortableDocument } from '@portable-doc/react';

// The limit goldens are the reader's output for blocks at and past a limit: a depth, a range, a
// cap, a padding past the stored cells. They are synced from Barkpark's pack. React must write
// each one byte for byte, as the block goldens' test in packages/mcp/local.test.mjs asks of those.
// A golden React does not yet write is named here with why, and its test fails once React writes
// it, so the name comes out in the same change.

const DIR = new URL('../goldens/limits/', import.meta.url);
const GOLDENS = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.golden.json'))
  .sort()
  .map((f) => [f.replace(/\.golden\.json$/, ''), JSON.parse(fs.readFileSync(new URL(f, DIR), 'utf8'))]);

const NOT_YET = {
  'list-at-the-depth-limit': 'at the deepest level the reader writes the empty item; React writes "Nested too deep to show" there',
};

test('React writes every limit golden byte for byte, except the ones named with why', () => {
  assert.ok(GOLDENS.length > 0, 'no limit goldens');
  const names = GOLDENS.map(([name]) => name);
  for (const name of Object.keys(NOT_YET)) assert.ok(names.includes(name), `${name}: named, but no such golden`);
  const wrong = [];
  const nowRight = [];
  for (const [name, { input, expectedHtml }] of GOLDENS) {
    const same = renderPortableDocument([input]) === expectedHtml;
    if (Object.hasOwn(NOT_YET, name)) {
      if (same) nowRight.push(name);
    } else if (!same) wrong.push(name);
  }
  assert.deepEqual(wrong, [], 'React writes other bytes than these goldens');
  assert.deepEqual(nowRight, [], 'React now writes these named goldens; take them out of NOT_YET');
});
