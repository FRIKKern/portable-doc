// A raw tag (<script>, <style>) opened in a container (a link's label, a mark) and never closed
// there skips to the container's end only: its kept shape reads each container's children on their
// own. Kept as text, a link shows what its kept shape shows: its safe address when the label gave no
// text, and the words after it. Raw text that is really skipped (opened and closed outside any
// container) stays skipped, a link or mark in it too, whole, even when a closing tag sits in it.
// Where the words decide a shape (an image's alt, a cite, a diagram's caption), an address is still
// no word.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DEPTH, MAX_VALUE_DEPTH, validate } from '@portable-doc/validate';
import { NESTING_KEPT_AS_TEXT, readMarkdown } from './index.js';

const U = 'https://a.example';
const I = 'https://b.example/i.png';
const t = (value) => ({ type: 'text', value });
// The deepest marks a top-level paragraph keeps (packages/text/import-depth.test.mjs).
const DEEPEST_MARKS = Math.floor((MAX_VALUE_DEPTH - 5) / 2);
const marks = (n, inner) => Array.from({ length: n }).reduce((s, _, i) => `*m${n - i} ${s} m${n - i}*`, inner);
// `inner` in a list item n lists deep.
const lists = (n, inner) => [...Array.from({ length: n - 1 }, (_, i) => `${'  '.repeat(i)}- l${i}`), `${'  '.repeat(n - 1)}- ${inner}`].join('\n');
const json = (doc) => JSON.stringify(doc.blocks);
const codes = (doc) => doc.notices.map((n) => n.code);
const read = (md, label) => {
  const doc = readMarkdown(md);
  assert.deepEqual(validate({ blocks: doc.blocks }), { ok: true }, label);
  return doc;
};

const MARKS = [['em', '*'], ['strong', '**'], ['strikethrough', '~~']];
// A raw tag opened in a container and not closed there, as [markdown, the text kept as text].
const OPENED = [
  [`[<style>](${U}) z </style> w`, `${U} z  w`],
  [`[<script>](${U}) z`, `${U} z`],
  [`[x<script>y](${U}) z`, 'x z'],
  [`[*<style>* x](${U}) z </style> w`, 'x z  w'],
  ...MARKS.map(([, m]) => [`${m}<style>${m} z </style> w`, 'z  w']),
  ...MARKS.map(([, m]) => [`${m}a<script>b${m} z`, 'a z']),
];
// A closing tag in a container inside raw text that is skipped, as [markdown, the text kept as text].
const SKIPPED = [
  [`a <style>[](${U})</style> b`, 'a  b'],
  [`x <style> [a</style>b](${U}) c </style> d`, 'x  d'],
  ...MARKS.map(([, m]) => [`x <style> ${m}a</style>b${m} c </style> d`, 'x  d']),
];

// Each place the import keeps inline content as text, as [name, markdown with `inner` in it,
// whether its text is kept past a limit] (as in empty-link-text.test.mjs).
const PLACES = [
  ['innermost of the deepest marks, as the node past them', (inner) => marks(DEEPEST_MARKS, inner), true],
  ['under the first mark past the deepest', (inner) => marks(DEEPEST_MARKS + 1, inner), true],
  ['in a list nested one past MAX_DEPTH', (inner) => lists(MAX_DEPTH + 1, inner), true],
  ['in a list nested past what the parser builds', (inner) => lists(MAX_DEPTH + 6, inner), true],
  ['in a quote that is a list item\'s text', (inner) => `- > ${inner}`, false],
  ['in a list inside a quote', (inner) => `> q\n>\n> - ${inner}`, false],
];

test('a link whose label opens a raw tag it never closes, kept as text, shows its address and the words after it, as its kept shape does', () => {
  // The kept shape: the label is read on its own, so its <style> ends with it.
  assert.deepEqual(read(`[<style>](${U}) z </style> w`).blocks, [{ type: 'paragraph', content: [{ type: 'link', href: U, children: [t(U)] }, t(' z  w')] }]);
  assert.deepEqual(read(`[x<script>y](${U}) z`).blocks, [{ type: 'paragraph', content: [{ type: 'link', href: U, children: [t('x')] }, t(' z')] }]);
  for (const [place, md, past] of PLACES) {
    for (const [inner, want] of OPENED.slice(0, 4)) {
      const label = `${inner} ${place}`;
      const doc = read(md(inner), label);
      assert.ok(json(doc).includes(want), `${label}: ${json(doc).slice(-120)}`);
      // A label that gave text shows no address, as the kept shape has the label.
      if (!want.startsWith(U)) assert.ok(!json(doc).includes(U), label);
      assert.deepEqual(codes(doc), past ? [NESTING_KEPT_AS_TEXT] : [], label);
    }
  }
  // A quote that is an item's text and only such a link is kept: it has the address.
  assert.deepEqual(read(`- > [<style>](${U}) z`).blocks[0].items, [[t(`${U} z`)]]);
});

test('a raw tag opened in a mark ends with the mark, kept as text or not, as in its kept shape: em, strong and strikethrough', () => {
  for (const [type, m] of MARKS) {
    assert.deepEqual(read(`${m}<style>${m} z </style> w`).blocks, [{ type: 'paragraph', content: [t(' z  w')] }], type);
    assert.deepEqual(read(`${m}a<script>b${m} z`).blocks, [{ type: 'paragraph', content: [{ type, children: [t('a')] }, t(' z')] }], type);
  }
  for (const [place, md, past] of PLACES) {
    for (const [inner, want] of OPENED.slice(4)) {
      const label = `${inner} ${place}`;
      const doc = read(md(inner), label);
      assert.ok(json(doc).includes(want), `${label}: ${json(doc).slice(-120)}`);
      assert.deepEqual(codes(doc), past ? [NESTING_KEPT_AS_TEXT] : [], label);
    }
  }
});

test('a link or mark inside raw text that is really skipped is skipped whole, kept as text or not: a closing tag in it does not end the skip', () => {
  assert.deepEqual(read(`- > a <style>[](${U})</style> b`).blocks[0].items, [[t('a  b')]]);
  // A closing tag in a skipped link's label, or in a skipped mark, does not end the skip, as in the kept shape.
  for (const [inner, want] of SKIPPED.slice(1)) assert.deepEqual(read(inner).blocks, [{ type: 'paragraph', content: [t(want)] }], inner);
  for (const [place, md] of PLACES) {
    for (const [inner, want] of SKIPPED) {
      const label = `${inner} ${place}`;
      const doc = read(md(inner), label);
      assert.ok(json(doc).includes(want), `${label}: ${json(doc).slice(-120)}`);
      assert.ok(!json(doc).includes(U), label);
    }
  }
});

test('where the words decide a shape, a label\'s raw tag skips only to the label\'s end: alt, cite and caption read the words after it, never an address', () => {
  // An image's alt is its words: the link's address is none.
  assert.deepEqual(read(`![a [<style>](${U}) b](${I})`).blocks, [{ type: 'paragraph', content: [{ type: 'link', href: I, children: [t('a  b')] }] }]);
  // The words after the link place the dash; the cite shows the address, as an empty link's does.
  assert.deepEqual(read(`> q\n>\n> — [<style>](${U}) Name`).blocks, [{ type: 'blockquote', content: [t('q')], cite: `${U} Name` }]);
  // The words after such a link are read whatever its label: a cite after a label with words, an alt
  // whose link's label opened a style.
  assert.equal(read(`> q\n>\n> — [x<script>y](${U}) z`).blocks[0].cite, 'x z');
  assert.deepEqual(read(`![[<style>](${U}) z </style> w](${I})`).blocks[0].content[0].children, [t(' z  w')]);
  // "— " and such a link alone is no cite, as with an empty link.
  const alone = read(`> q\n>\n> — [<style>](${U})`).blocks;
  assert.deepEqual([alone.length, alone[0].cite], [1, undefined]);
  // A caption: its words after the link make it one, and it shows the address.
  const caption = read('```mermaid\ngraph TD\n```\n\n*Fig [<style>](' + U + ') z*').blocks;
  assert.deepEqual(caption.map((b) => [b.type, b.caption]), [['diagram', `Fig ${U} z`]]);
  const bare = read('```mermaid\ngraph TD\n```\n\n*[<style>](' + U + ')*').blocks;
  assert.deepEqual(bare.map((b) => [b.type, b.caption]), [['diagram', undefined], ['paragraph', undefined]]);
});

test('every input above reads the same words kept as text as in its kept shape', () => {
  // The words a value shows: its text nodes' values in order (a link's address is its href, no word;
  // an empty link's text node is its address, as it shows), whitespace runs as one space.
  const texts = (v) => (Array.isArray(v) ? v.flatMap(texts) : v && typeof v === 'object' ? (v.type === 'text' ? [v.value] : Object.values(v).flatMap(texts)) : []);
  const words = (v) => (typeof v === 'string' ? v : texts(v).join('')).replace(/\s+/g, ' ').trim();
  for (const [inner, want] of [...OPENED, ...SKIPPED]) {
    const kept = words(read(inner).blocks);
    // The quote that is an item's text is read as text: the item's inline content.
    assert.equal(words(read(`- > ${inner}`).blocks[0].items[0]), kept, inner);
    assert.equal(words(want), kept, inner);
  }
});
