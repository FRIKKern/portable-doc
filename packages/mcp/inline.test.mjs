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

test('a key a node does not take or a mark out of rank order is refused; a mark inside itself is fine in a card, refused in a table', () => {
  for (const node of EVERY) {
    const extra = { ...node, extra: 1 };
    assert.equal(validCardInline([extra]), false, JSON.stringify(extra));
    assert.equal(validTableInline([extra]), false, JSON.stringify(extra));
  }
  for (const type of ['strong', 'wikilink']) {
    const twice = { type, ...(type === 'wikilink' ? { target: 't' } : {}), children: [{ type, ...(type === 'wikilink' ? { target: 't' } : {}), children: [text('x')] }] };
    assert.equal(validCardInline([twice]), true, `card: ${type} in ${type}`);
    assert.equal(validTableInline([twice]), false, `table: ${type} in ${type}`);
  }
  for (const junk of [null, 'x', 5, []]) {
    assert.equal(validCardInline([junk]), false, JSON.stringify(junk));
    assert.equal(validTableInline([junk]), false, JSON.stringify(junk));
  }
  const ref = { type: 'valueref', target: 'doc', field: 'f' };
  assert.equal(validTableInline([ref, ref]), false, 'two adjacent equal nodes would merge');
  assert.equal(validTableInline([ref, { ...ref, as: 'number' }]), true);
  const backwards = { type: 'em', children: [{ type: 'strong', children: [text('x')] }] };
  assert.equal(validCardInline([backwards]), false);
  assert.equal(validTableInline([backwards]), false);
});
