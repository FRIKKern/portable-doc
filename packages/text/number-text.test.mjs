import assert from 'node:assert/strict';
import { test } from 'node:test';
import { numberText, stringOf, styleAttr, styleOf } from './number-text.js';

test('a finite number shows its digits; NaN, Infinity and -Infinity show nothing', () => {
  for (const n of [NaN, Infinity, -Infinity]) {
    assert.equal(numberText(n), '', String(n));
    assert.equal(numberText(n, 1), '', String(n));
    assert.equal(numberText(n, 'whole'), '', String(n));
  }
  assert.deepEqual([0, -0, 7, -1.5, 0.1 + 0.2, 1e21, 5e-7].map((n) => numberText(n)), ['0', '0', '7', '-1.5', '0.30000000000000004', '1e+21', '5e-7']);
  assert.deepEqual([numberText(2.25, 1), numberText(-0.5, 3), numberText(1e21, 'whole'), numberText(-42, 'whole')], ['2.3', '-0.500', '1000000000000000000000', '-42']);
});

test('stringOf writes a value as String does, each number in it through numberText', () => {
  assert.deepEqual([stringOf(3), stringOf(NaN), stringOf('NaN'), stringOf(true), stringOf(null)], ['3', '', 'NaN', 'true', 'null']);
  assert.deepEqual([stringOf([1, NaN, [2, Infinity]]), stringOf([1, null, undefined, 'a']), String([1, null, undefined, 'a'])], ['1,,2,', '1,,,a', '1,,,a']);
  assert.equal(stringOf({}), String({}));
});

test('styleOf writes a property only when its number is finite; styleAttr writes no empty style', () => {
  assert.deepEqual([styleOf('order', 2), styleOf('--i', -0), styleOf('width', 40, (x) => `${numberText(x)}%`)], ['order:2', '--i:0', 'width:40%']);
  for (const n of [NaN, Infinity, -Infinity, null, undefined]) assert.equal(styleOf('width', n, (x) => `${numberText(x)}%`), '', String(n));
  assert.deepEqual([styleAttr(['a:1', '', 'b:2']), styleAttr(['', '']), styleAttr([])], [' style="a:1;b:2"', '', '']);
});
