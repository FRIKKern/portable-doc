// An empty link, or an image with no alt, writes its address when it keeps its shape. Kept as text
// anywhere the import flattens inline content (past the deepest marks, in a list past MAX_DEPTH, in a
// quote or list read as an item's or a quote's text, in a cite), it shows the same address. An unsafe
// address shows nothing either way. Where the words decide a shape (an image's alt, whether a
// paragraph is a cite or a diagram's caption), an address is not a word: those stay as before.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DEPTH, MAX_VALUE_DEPTH, validate } from '@portable-doc/validate';
import { NESTING_KEPT_AS_TEXT, readMarkdown } from './index.js';

const U = 'https://a.example';
const I = 'https://b.example/i.png';
const LINK = `[](${U})`;
const IMAGE = `![](${I})`;
const UNSAFE = ['[](javascript:alert(1))', '![](javascript:alert(1))'];
// The deepest marks a top-level paragraph keeps (packages/text/import-depth.test.mjs).
const DEEPEST_MARKS = Math.floor((MAX_VALUE_DEPTH - 5) / 2);
const marks = (n, inner) => Array.from({ length: n }).reduce((s, _, i) => `*m${n - i} ${s} m${n - i}*`, inner);
// `inner` in a list item n lists deep.
const lists = (n, inner) => [...Array.from({ length: n - 1 }, (_, i) => `${'  '.repeat(i)}- l${i}`), `${'  '.repeat(n - 1)}- ${inner}`].join('\n');
const json = (doc) => JSON.stringify(doc.blocks);
const codes = (doc) => doc.notices.map((n) => n.code);

// Each place, as [name, markdown with `inner` in it, whether its text is kept past a limit].
const PLACES = [
  ['innermost of the deepest marks, as the node past them', (inner) => marks(DEEPEST_MARKS, inner), true],
  ['under the first mark past the deepest', (inner) => marks(DEEPEST_MARKS + 1, inner), true],
  ['under marks well past the deepest', (inner) => marks(DEEPEST_MARKS + 4, inner), true],
  ['in a list nested one past MAX_DEPTH', (inner) => lists(MAX_DEPTH + 1, inner), true],
  ['in a list nested past what the parser builds', (inner) => lists(MAX_DEPTH + 6, inner), true],
  ['in a quote that is a list item\'s text', (inner) => `- > ${inner}`, false],
  ['in a list inside a quote', (inner) => `> q\n>\n> - ${inner}`, false],
];

test('an empty link or an image with no alt kept as text shows its address, alone and beside words', () => {
  for (const [place, md, past] of PLACES) {
    for (const [inner, want] of [[LINK, U], [IMAGE, I], [`w ${LINK} z`, `w ${U} z`], [`w ${IMAGE} z`, `w ${I} z`]]) {
      const doc = readMarkdown(md(inner));
      const label = `${inner} ${place}`;
      assert.ok(json(doc).includes(want), label);
      assert.equal(validate(doc).valid, true, label);
      assert.deepEqual(codes(doc), past ? [NESTING_KEPT_AS_TEXT] : [], label);
    }
  }
});

test('a list item that is a quote of only an empty link is kept, its text the address', () => {
  for (const [inner, want] of [[LINK, U], [IMAGE, I]]) {
    const doc = readMarkdown(`- > ${inner}`);
    assert.deepEqual(doc.blocks.map((b) => b.type), ['list'], inner);
    assert.deepEqual(doc.blocks[0].items, [[{ type: 'text', value: want }]], inner);
  }
});

test('a cite with an empty link in it shows the address after the name', () => {
  const doc = readMarkdown(`> q\n>\n> — Name ${LINK}`);
  assert.deepEqual(doc.blocks, [{ type: 'blockquote', content: [{ type: 'text', value: 'q' }], cite: `Name ${U}` }]);
});

test('an unsafe address never shows, kept as text or not', () => {
  for (const [place, md] of PLACES) {
    for (const inner of UNSAFE) {
      for (const source of [md(inner), md(`w ${inner} z`)]) assert.ok(!json(readMarkdown(source)).includes('javascript'), `${inner} ${place}`);
    }
  }
});

test('where the words decide a shape, an empty link is no word: alt, cite and caption are as before', () => {
  // An image's alt is its words (CommonMark): an empty link in it adds none.
  const alt = readMarkdown(`![a ${LINK} b](${I})`);
  assert.deepEqual(alt.blocks, [{ type: 'paragraph', content: [{ type: 'link', href: I, children: [{ type: 'text', value: 'a  b' }] }] }]);
  // "— " and an empty link is no cite: the paragraph stays, the link with it.
  const cite = readMarkdown(`> q\n>\n> — ${LINK}`);
  assert.equal(cite.blocks.length, 1);
  assert.equal(cite.blocks[0].cite, undefined);
  assert.ok(JSON.stringify(cite.blocks[0].content).includes(`{"type":"link","href":"${U}"`));
  // An emphasised empty link after a diagram is no caption: it stays a paragraph, the link in it.
  const caption = readMarkdown('```mermaid\ngraph TD\n```\n\n*' + LINK + '*');
  assert.deepEqual(caption.blocks.map((b) => [b.type, b.caption]), [['diagram', undefined], ['paragraph', undefined]]);
  assert.ok(JSON.stringify(caption.blocks[1].content).includes(`{"type":"link","href":"${U}"`));
});
