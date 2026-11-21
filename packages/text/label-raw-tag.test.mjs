// A raw tag (<script>, <style>) opened in a link's label and never closed there skips the label's
// words to the label's end only: its kept shape reads the label on its own. Kept as text, the link
// shows what its kept shape shows: its safe address when the label gave no text, and the words
// after it. Raw text that is really skipped (opened and closed outside a link) stays skipped, a link
// in it too, label and address, even when a closing tag sits in that label. An unsafe address never
// shows. Where the words decide a shape (an image's alt, a cite, a diagram's caption), an address is
// still no word.
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
    for (const [inner, want, not] of [
      [`[<style>](${U}) z </style> w`, `${U} z  w`, null],
      [`[<script>](${U}) z`, `${U} z`, null],
      // The label gave text: no address, as the kept shape has the label.
      [`[x<script>y](${U}) z`, 'x z', U],
      // Unsafe: the words, never the address.
      ['[<style>](javascript:alert(1)) z </style> w', 'z  w', 'javascript'],
    ]) {
      const label = `${inner} ${place}`;
      const doc = read(md(inner), label);
      assert.ok(json(doc).includes(want), `${label}: ${json(doc).slice(-120)}`);
      if (not) assert.ok(!json(doc).includes(not), label);
      assert.deepEqual(codes(doc), past ? [NESTING_KEPT_AS_TEXT] : [], label);
    }
  }
  // A quote that is an item's text and only such a link is kept: it has the address.
  assert.deepEqual(read(`- > [<style>](${U}) z`).blocks[0].items, [[t(`${U} z`)]]);
});

test('a link inside raw text that is really skipped shows no address and no label, kept as text or not: the skip goes on past it', () => {
  assert.deepEqual(read(`- > a <style>[](${U})</style> b`).blocks[0].items, [[t('a  b')]]);
  // A closing tag in the label of a skipped link does not end the skip, as in the kept shape.
  assert.deepEqual(read(`x <style> [a</style>b](${U}) c </style> d`).blocks, [{ type: 'paragraph', content: [t('x  d')] }]);
  for (const [place, md] of PLACES) {
    for (const [inner, want] of [[`a <style>[](${U})</style> b`, 'a  b'], [`x <style> [a</style>b](${U}) c </style> d`, 'x  d']]) {
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
  // "— " and such a link alone is no cite, as with an empty link.
  const alone = read(`> q\n>\n> — [<style>](${U})`).blocks;
  assert.deepEqual([alone.length, alone[0].cite], [1, undefined]);
  // A caption: its words after the link make it one, and it shows the address.
  const caption = read('```mermaid\ngraph TD\n```\n\n*Fig [<style>](' + U + ') z*').blocks;
  assert.deepEqual(caption.map((b) => [b.type, b.caption]), [['diagram', `Fig ${U} z`]]);
  const bare = read('```mermaid\ngraph TD\n```\n\n*[<style>](' + U + ')*').blocks;
  assert.deepEqual(bare.map((b) => [b.type, b.caption]), [['diagram', undefined], ['paragraph', undefined]]);
});
