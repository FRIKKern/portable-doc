import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { CODES, validate } from '@portable-doc/validate';
import { REFUSED_WHEN, explain, readCodes, where } from './explain.js';

const brokenDir = new URL('../../fixtures/broken/', import.meta.url);
const broken = fs.readdirSync(brokenDir).filter((f) => f.endsWith('.json')).sort()
  .map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(new URL(f, brokenDir), 'utf8')) }));

test('every reason code has its plain words from CODES.md', () => {
  assert.deepEqual([...REFUSED_WHEN.keys()].sort(), [...CODES].sort());
  assert.match(REFUSED_WHEN.get('duplicate_block_id'), /two blocks in the tree share a non-blank `id`/);
});

test('a CODES.md that lacks a code fails at load, so a new code cannot go unexplained', () => {
  const codes = fs.readFileSync(new URL('../validate/CODES.md', import.meta.url), 'utf8');
  assert.throws(() => readCodes(codes.replace(/^\| `too_deep` .*$/m, '')), /no row for too_deep/);
});

test('paths read as blocks and fields, naming each block by type and id when the doc is given', () => {
  const doc = { blocks: [{ id: 'h', type: 'heading' }, { type: 'section', blocks: [{ type: 'list', items: [[]] }] }] };
  assert.equal(where('', doc), 'the doc');
  assert.equal(where('/blocks', doc), 'the blocks array');
  assert.equal(where('/blocks/0/level', doc), 'block 1 (heading, id "h") › field "level"');
  assert.equal(where('/blocks/1/blocks/0/items/0', doc), 'block 2 (section) › field "blocks" › block 1 (list) › field "items" › item 1');
  assert.equal(where('/blocks/0/level'), 'block 1 › field "level"');
  assert.equal(where('/0/type', [{ type: 'divider' }]), 'block 1 (divider) › field "type"');
  assert.equal(where('/blocks/9/a~1b~0c', doc), 'block 10 › field "a/b~c"');
});

test('every broken fixture: each validate error gets one explanation with its place, its message and its rule', () => {
  assert.ok(broken.length >= 20, `only ${broken.length} broken fixtures`);
  const hit = new Set();
  for (const { file, doc } of broken) {
    const result = validate(doc);
    assert.equal(result.ok, false, file);
    const words = explain(result.errors, doc);
    assert.equal(words.length, result.errors.length, file);
    words.forEach((w, i) => {
      const e = result.errors[i];
      hit.add(e.code);
      assert.equal(w.code, e.code);
      assert.equal(w.where, where(e.path, doc));
      assert.ok(w.text.startsWith(`${w.where}: ${e.message}. Refused when `), w.text);
      assert.ok(w.text.endsWith(`${REFUSED_WHEN.get(e.code).replaceAll('`', '')}.`), w.text);
    });
  }
  assert.deepEqual([...hit].sort(), [...CODES].sort());
});
