import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exactKeys, optionalNonNil, same, subsetKeys, termOrder } from './ops/terms.js';

test('termOrder sorts like Elixir: numbers, atoms (false, nil, true), maps, lists, strings', () => {
  const mixed = ['b', [1], { a: 1 }, true, null, 2, 'a', false, 1];
  assert.deepEqual(mixed.toSorted(termOrder), [1, 2, false, null, true, { a: 1 }, [1], 'a', 'b']);
});

test('optionalNonNil: absent or any value but null', () => {
  assert.equal(optionalNonNil({}, 'k'), true);
  assert.equal(optionalNonNil({ k: null }, 'k'), false);
  for (const k of [0, false, '', 'x']) assert.equal(optionalNonNil({ k }, 'k'), true);
});

test('same, exactKeys and subsetKeys look at every item and key', () => {
  assert.equal(same([1, { a: [2] }], [1, { a: [2] }]), true);
  for (const [a, b] of [[[1], [2]], [{ a: 1 }, { a: 2 }], [{ a: 1 }, { b: 1 }], [[1], [1, 2]], [{ a: null }, {}]]) assert.equal(same(a, b), false, JSON.stringify([a, b]));
  assert.equal(exactKeys({ a: 1, b: 2 }, ['b', 'a']), true);
  assert.equal(exactKeys({ a: 1, c: 2 }, ['a', 'b']), false);
  assert.equal(subsetKeys({ a: 1 }, ['a', 'b']), true);
  assert.equal(subsetKeys({ x: 1 }, ['a']), false);
});
