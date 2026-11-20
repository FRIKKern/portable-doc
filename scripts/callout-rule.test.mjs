// A callout's content and its body: the rule SPEC.md states, and the shared cases held to it.
// The importer, React and the text writers follow it; the editor here is Barkpark's copy, synced
// (decision 0012), and is held by Barkpark. Decision 0014 says why the rule is one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { validate } from '@portable-doc/validate';
import { fixtureCases } from './lib/fixture-cases.mjs';
import { WRITERS } from './lib/writers.mjs';
import { KEEP_BYTES } from './write-shared-cases.mjs';

/** The sentences SPEC.md states, word for word. */
export const CALLOUT_RULE = [
  "A callout's `content` is its own first paragraph, and its `slots.body` is the blocks after that paragraph; neither field is a copy of the other.",
  "A callout's body holds any block a document may hold, under the one depth limit every document has.",
];
export const EMPTY_CONTENT = 'A callout with empty `content` and a body is allowed: an empty first line is not a missing one.';

test('SPEC.md states the callout rule, and allows a callout with empty content and a body', () => {
  const spec = fs.readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.deepEqual([...CALLOUT_RULE, EMPTY_CONTENT].filter((s) => !spec.includes(s)), [], 'SPEC.md does not say these, word for word');
});

const wordsIn = (s) => s.match(/\p{L}[\p{L}\p{N}]*/gu) ?? [];
// Keys that hold a setting or a name, not words of the document.
const NOT_WORDS = new Set(['type', 'id', 'tone', 'lang', 'kind', 'mode', 'role', 'align', 'style', 'verdict', 'href', 'src', 'source', 'sourceDefault', 'posterAt', 'format']);
/** The words of a value's strings, in document order. */
const words = (x, key) =>
  typeof x === 'string' ? (NOT_WORDS.has(key) ? [] : wordsIn(x)) : Array.isArray(x) ? x.flatMap((y) => words(y, key)) : x && typeof x === 'object' ? Object.entries(x).flatMap(([k, v]) => words(v, k)) : [];

const isCallout = (b) => b && typeof b === 'object' && b.type === 'callout';
const bodyOf = (b) => (Array.isArray(b.slots?.body) ? b.slots.body : []);

/** Every callout with a body in `blocks`, two callouts deep at most, as [path, callout]. */
function calloutsWithABody(blocks) {
  const out = [];
  const visit = (x, path, depth) => {
    if (Array.isArray(x)) return x.forEach((y, i) => visit(y, [...path, i], depth));
    if (!x || typeof x !== 'object') return;
    if (isCallout(x) && bodyOf(x).length) {
      out.push([path, x]);
      if (depth === 2) return;
    }
    for (const [k, v] of Object.entries(x)) visit(v, [...path, k], depth + (isCallout(x) ? 1 : 0));
  };
  visit(blocks, [], 1);
  return out;
}

/** `blocks` with the value at `path` replaced. */
const replaced = (x, [head, ...rest], value) => {
  if (head === undefined) return value;
  const copy = Array.isArray(x) ? [...x] : { ...x };
  copy[head] = replaced(x[head], rest, value);
  return copy;
};
const withoutBody = ({ slots, ...b }) => {
  const { body, ...others } = slots ?? {};
  return Object.keys(others).length ? { ...b, slots: others } : b;
};

const cases = (await fixtureCases()).filter(({ blocks }) => JSON.stringify(blocks).length <= KEEP_BYTES).flatMap(({ name, blocks }) => calloutsWithABody(blocks).map(([path, callout]) => ({ name, blocks, path, callout })));

test('the shared cases hold callouts with content and a body, and one with empty content and a body', () => {
  const both = cases.filter(({ callout }) => words(callout.content).length);
  assert.ok(both.length >= 9, `callouts with content and a body: ${both.length}`);
  const empty = cases.filter(({ callout }) => !words(callout.content).length);
  assert.ok(empty.some(({ name }) => name === 'callout-empty-content-with-body'), 'callout-empty-content-with-body');
  for (const { name, blocks } of empty) assert.equal(validate({ blocks }).ok, true, name);
});

test("in every shared case, a callout's content is never its body's first block", () => {
  const copies = cases.filter(({ callout }) => words(callout.content).length && words(callout.content).join(' ') === words(bodyOf(callout)[0]).join(' '));
  assert.deepEqual(copies.map(({ name, path }) => `${name} at /${path.join('/')}`), []);
});

// What a writer shows of a callout's words, counted. Each callout is written four ways: as it
// is, with its content only, with its body only, and with neither. A writer that shows content,
// then every block of the body, once each, shows each word of the callout as often in the whole
// as in the content alone and the body alone, less what the callout shows with neither.
const READERS = WRITERS.filter((w) => w.package !== '@portable-doc/editor');
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const textOf = (writer, blocks) => {
  const { output } = writer.write(blocks);
  return writer.writes === 'html' ? output.replace(/<[^>]*\balt="([^"]*)"[^>]*>/g, ' $1 ').replace(/<[^>]*>/g, ' ').replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ENTITIES[e]) : output;
};
const counts = (list) => list.reduce((m, w) => m.set(w, (m.get(w) ?? 0) + 1), new Map());
/** Whether `want` is in `list` in order, not always side by side. */
const inOrder = (list, want) => {
  let i = 0;
  for (const w of list) if (w === want[i]) i++;
  return i === want.length;
};

test('React and the text writers show a callout\'s content, then every block of its body, each once', () => {
  assert.deepEqual(READERS.map((w) => w.name), ['readable Markdown', 'plain text', 'round-trip Markdown', 'HTML', 'HTML with field and embed blocks']);
  const wrong = [];
  for (const { name, blocks, path, callout } of cases) {
    const at = (b) => replaced(blocks, path, b);
    const own = new Set(words(callout));
    for (const writer of READERS) {
      const [whole, content, body, neither] = [callout, withoutBody(callout), { ...callout, content: [] }, withoutBody({ ...callout, content: [] })].map((b) => counts(wordsIn(textOf(writer, at(b)))));
      const off = [...own].filter((w) => (whole.get(w) ?? 0) !== (content.get(w) ?? 0) + (body.get(w) ?? 0) - (neither.get(w) ?? 0));
      if (off.length) wrong.push(`${writer.name}: ${name} at /${path.join('/')}: ${off.join(', ')} shown other than once`);
      // Order: the content's words, then each body block's words as the writer writes that block alone.
      const mine = (text) => wordsIn(text).filter((w) => own.has(w));
      if (!inOrder(mine(textOf(writer, blocks)), [...words(callout.content), ...bodyOf(callout).flatMap((b) => mine(textOf(writer, [b])))])) wrong.push(`${writer.name}: ${name} at /${path.join('/')}: not content, then the body in order`);
    }
  }
  assert.deepEqual(wrong, []);
});
