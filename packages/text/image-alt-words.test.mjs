// An image's alt is its label's words only, as a shape test reads them: it never shows its Markdown
// source. A label with no words (only a link, an image or raw HTML) gives no alt, so the image is a
// link labelled by its safe address, as an image with no alt is, and kept as text it shows that
// address. An alt with words is as before.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DEPTH, MAX_VALUE_DEPTH, validate } from '@portable-doc/validate';
import { readMarkdown } from './index.js';

const U = 'https://a.example';
const I = 'https://b.example/i.png';
const J = 'https://c.example/j.png';
const t = (value) => ({ type: 'text', value });
// The deepest marks a top-level paragraph keeps (packages/text/import-depth.test.mjs).
const DEEPEST_MARKS = Math.floor((MAX_VALUE_DEPTH - 5) / 2);
const marks = (n, inner) => Array.from({ length: n }).reduce((s, _, i) => `*m${n - i} ${s} m${n - i}*`, inner);
// `inner` in a list item n lists deep.
const lists = (n, inner) => [...Array.from({ length: n - 1 }, (_, i) => `${'  '.repeat(i)}- l${i}`), `${'  '.repeat(n - 1)}- ${inner}`].join('\n');
const read = (md, label) => {
  const doc = readMarkdown(md);
  assert.deepEqual(validate({ blocks: doc.blocks }), { ok: true }, label);
  return doc;
};
// Every text value in a doc's blocks, in order.
const texts = (v) => (Array.isArray(v) ? v.flatMap(texts) : v && typeof v === 'object' ? (v.type === 'text' ? [v.value] : Object.values(v).flatMap(texts)) : []);
// Whether a text holds Markdown or HTML source.
const source = (s) => s.includes('[') || s.includes('](') || s.includes('<');

// Each place the import keeps inline content as text (as in empty-link-text.test.mjs).
const PLACES = [
  ['innermost of the deepest marks, as the node past them', (inner) => marks(DEEPEST_MARKS, inner)],
  ['under the first mark past the deepest', (inner) => marks(DEEPEST_MARKS + 1, inner)],
  ['in a list nested one past MAX_DEPTH', (inner) => lists(MAX_DEPTH + 1, inner)],
  ['in a list nested past what the parser builds', (inner) => lists(MAX_DEPTH + 6, inner)],
  ['in a quote that is a list item\'s text', (inner) => `- > ${inner}`],
  ['in a list inside a quote', (inner) => `> q\n>\n> - ${inner}`],
];
// Labels with no words: only an empty link, a link whose label is only a tag, an image with no alt,
// raw HTML or an HTML comment.
const NO_WORDS = [`[](${U})`, `[<span></span>](${U})`, `![](${J})`, '<b></b>', '<style>x</style>', '<!-- c -->'];

test('an image\'s alt never shows its Markdown source: a label with no words gives no alt, at the top level and kept as text, and the image shows its safe address', () => {
  for (const label of NO_WORDS) {
    const md = `![${label}](${I})`;
    // Kept, it is a link labelled by its address, as `![](i)` is.
    assert.deepEqual(read(md, md).blocks, [{ type: 'paragraph', content: [{ type: 'link', href: I, children: [t(I)] }] }], md);
    for (const [place, at] of PLACES) {
      const name = `${md} ${place}`;
      const words = texts(read(at(`w ${md} z`), name).blocks).join('');
      assert.ok(!source(words), `${name}: ${words.slice(-80)}`);
      assert.ok(words.includes(`w ${I} z`), `${name}: ${words.slice(-80)}`);
    }
  }
});

test('an image\'s alt with words is its words, as before, at the top level and kept as text: entities, code and a space are words', () => {
  for (const [label, alt] of [
    ['a', 'a'], [`a [x](${U}) b`, 'a x b'], [`a [](${U}) b`, 'a  b'], ['*e*', 'e'],
    // Only an entity, only code, only a space: each is a word, so none needs the label's source.
    ['&amp;', '&'], ['&#65;', 'A'], ['`c`', 'c'], ['` `', ' '], [' ', ' '], ['\\[', '['],
  ]) {
    const md = `![${label}](${I})`;
    // Words around it: a paragraph of only a blank alt has no text, and goes.
    assert.deepEqual(read(`w ${md} z`, md).blocks, [{ type: 'paragraph', content: [t('w '), { type: 'link', href: I, children: [t(alt)] }, t(' z')] }], md);
    for (const [place, at] of PLACES) {
      const name = `${md} ${place}`;
      const words = texts(read(at(`w ${md} z`), name).blocks).join('');
      assert.ok(words.includes(`w ${alt} z`), `${name}: ${words.slice(-80)}`);
      assert.ok(!words.includes(I), name);
    }
  }
});
