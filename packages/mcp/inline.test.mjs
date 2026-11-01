import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validCardInline, validTableInline } from './ops/inline.js';

const text = (value) => ({ type: 'text', value });
const EVERY = [
  text('a'),
  { type: 'code', value: 'c' },
  { type: 'link', href: 'https://example.test', children: [text('l')] },
  { type: 'wikilink', target: 't', children: [text('w')], alias: 'x' },
  { type: 'blockref', target: 'doc', anchor: 'b' },
  { type: 'tag', name: 'n' },
  { type: 'valueref', target: 'doc', field: 'f', as: 'number' },
  { type: 'strong', children: [{ type: 'em', children: [{ type: 'code', value: 'c' }] }] },
];

test('card and table inline take every node kind, nested marks in rank order', () => {
  assert.equal(validCardInline(EVERY), true);
  assert.equal(validTableInline([...EVERY, { type: 'highlight', children: [{ type: 'sup', children: [text('h')] }] }]), true);
  for (const node of EVERY) {
    assert.equal(validCardInline([node]), true, JSON.stringify(node));
    assert.equal(validTableInline([node]), true, JSON.stringify(node));
  }
});

test('a node with a key it does not take, or a mark out of rank order, is refused', () => {
  for (const node of EVERY) {
    const extra = { ...node, extra: 1 };
    assert.equal(validCardInline([extra]), false, JSON.stringify(extra));
    assert.equal(validTableInline([extra]), false, JSON.stringify(extra));
  }
  const backwards = { type: 'em', children: [{ type: 'strong', children: [text('x')] }] };
  assert.equal(validCardInline([backwards]), false);
  assert.equal(validTableInline([backwards]), false);
});
