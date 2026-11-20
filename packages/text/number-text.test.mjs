import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { STYLE_AFTER, STYLE_BEFORE, STYLE_FORMATS, numberText, stringOf, styleAttr, styleOf } from './number-text.js';

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
  assert.deepEqual([styleOf('order', 2), styleOf('--i', -0), styleOf('width', 40, { after: '%' }), styleOf('grid-column', 3, { before: 'span ' })], ['order:2', '--i:0', 'width:40%', 'grid-column:span 3']);
  assert.deepEqual([2.25, 7, 1e21].map((n) => styleOf('width', n, { format: 'tenths', after: '%' })), ['width:2.3%', 'width:7%', 'width:1000000000000000000000%']);
  assert.deepEqual([styleOf('--i', 1 / 9, { format: 'thousandths' }), styleOf('--i', 1, { format: 'thousandths' })], ['--i:0.111', '--i:1.000']);
  for (const n of [NaN, Infinity, -Infinity, null, undefined]) assert.equal(styleOf('width', n, { after: '%' }), '', String(n));
  assert.deepEqual([styleAttr(['a:1', '', 'b:2']), styleAttr(['', '']), styleAttr([])], [' style="a:1;b:2"', '', '']);
});

test('a style format, a text before and a text after are each one of a closed list; any other throws', () => {
  for (const how of [{ format: 'hundredths' }, { format: 'toString' }, { before: 'auto ' }, { after: '%;height:1px' }, { after: 'em' }]) {
    for (const n of [1, NaN]) assert.throws(() => styleOf('width', n, how), TypeError, JSON.stringify(how));
  }
  for (const before of STYLE_BEFORE) for (const after of STYLE_AFTER) assert.equal(styleOf('p', 4, { before, after }), `p:${before}4${after}`);
});

test('the types list the same formats and texts as the code', () => {
  const dts = fs.readFileSync(new URL('number-text.d.ts', import.meta.url), 'utf8');
  const tuple = (name) => JSON.parse(dts.match(new RegExp(`export const ${name}: readonly (\\[[^\\]]*\\]);`))[1].replace(/'/g, '"'));
  assert.deepEqual(tuple('STYLE_BEFORE'), [...STYLE_BEFORE]);
  assert.deepEqual(tuple('STYLE_AFTER'), [...STYLE_AFTER]);
  const formats = dts.match(/export const STYLE_FORMATS: Readonly<\{ (.*) \}>;/)[1].split('; ').map((f) => f.split(':')[0]);
  assert.deepEqual(formats, Object.keys(STYLE_FORMATS));
});
