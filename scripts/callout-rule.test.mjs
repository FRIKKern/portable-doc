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

/**
 * The callout rule, word for word: SPEC.md opens its callout paragraph with it, and the schema's
 * callout entry is to carry the same two sentences, compared against this one constant.
 */
export const CALLOUT_RULE = "A callout's content is its own first paragraph, its slots.body is the blocks after that paragraph, and neither field is a copy of the other. A callout's body holds any block a document may hold.";
export const DEPTH = 'The one depth limit every document has applies to it too.';
export const EMPTY_CONTENT = 'A callout with empty `content` and a body is allowed: an empty first line is not a missing one.';

test('SPEC.md states the callout rule, and allows a callout with empty content and a body', () => {
  const raw = fs.readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
  const spec = raw.replace(/\s+/g, ' ');
  assert.deepEqual([CALLOUT_RULE, DEPTH, EMPTY_CONTENT].filter((s) => !spec.includes(s)), [], 'SPEC.md does not say these, word for word');
  assert.ok(raw.includes(`\n\n${CALLOUT_RULE} ${DEPTH} `), 'SPEC.md opens a paragraph with the rule, byte for byte, then the depth limit');
});

const wordsIn = (s) => s.match(/\p{L}[\p{L}\p{N}]*/gu) ?? [];
// Keys that hold a setting or a name, not words of the document.
const NOT_WORDS = new Set(['type', 'id', 'tone', 'lang', 'kind', 'mode', 'role', 'align', 'style', 'verdict', 'href', 'src', 'source', 'sourceDefault', 'posterAt', 'format']);
/** The words of a value's strings, in document order. */
const words = (x, key) =>
  typeof x === 'string' ? (NOT_WORDS.has(key) ? [] : wordsIn(x)) : Array.isArray(x) ? x.flatMap((y) => words(y, key)) : x && typeof x === 'object' ? Object.entries(x).flatMap(([k, v]) => words(v, k)) : [];

const isCallout = (b) => b && typeof b === 'object' && b.type === 'callout';
const bodyOf = (b) => (Array.isArray(b.slots?.body) ? b.slots.body : []);

/** Every callout with a body in `blocks`, at any depth, as [path, callout]. */
function calloutsWithABody(blocks) {
  const out = [];
  const visit = (x, path) => {
    if (Array.isArray(x)) return x.forEach((y, i) => visit(y, [...path, i]));
    if (!x || typeof x !== 'object') return;
    if (isCallout(x) && bodyOf(x).length) out.push([path, x]);
    for (const [k, v] of Object.entries(x)) visit(v, [...path, k]);
  };
  visit(blocks, []);
  return out;
}

/** `blocks` with the value at `path` replaced. */
const replaced = (x, [head, ...rest], value) => {
  if (head === undefined) return value;
  const copy = Array.isArray(x) ? [...x] : { ...x };
  copy[head] = replaced(x[head], rest, value);
  return copy;
};

/** How many callouts deep the callouts in `x` go. */
const calloutDepth = (x) => {
  if (Array.isArray(x)) return x.reduce((m, y) => Math.max(m, calloutDepth(y)), 0);
  if (!x || typeof x !== 'object') return 0;
  const below = Object.values(x).reduce((m, y) => Math.max(m, calloutDepth(y)), 0);
  return isCallout(x) ? below + 1 : below;
};
const withoutBody = ({ slots, ...b }) => {
  const { body, ...others } = slots ?? {};
  return Object.keys(others).length ? { ...b, slots: others } : b;
};

// Every callout with a body, at any depth, in every shared case.
const cases = (await fixtureCases()).flatMap(({ name, blocks }) => calloutsWithABody(blocks).map(([path, callout]) => ({ name, blocks, path, callout })));

test('the shared cases hold callouts with content and a body, and each with empty content and a body is a valid doc', (t) => {
  const both = cases.filter(({ callout }) => words(callout.content).length);
  assert.ok(both.length >= 9, `callouts with content and a body: ${both.length}`);
  // Judged: every callout with empty content and a body, at any depth, in every shared case.
  const empty = cases.filter(({ callout }) => !words(callout.content).length);
  t.diagnostic(`${empty.length} callouts with empty content and a body: ${[...new Set(empty.map(({ name }) => name))].join(', ')}`);
  assert.ok(empty.some(({ name }) => name === 'callout-empty-content-with-body'), 'callout-empty-content-with-body');
  assert.deepEqual([...new Set(empty.filter(({ blocks }) => !validate({ blocks }).ok).map(({ name }) => name))], [], 'not a valid doc');
});

test("in every shared case, a callout's content is never its body's first block", (t) => {
  t.diagnostic(`${cases.length} callouts with a body`);
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

// Each callout is judged twice: in place, in its whole case's output, where a writer meets it under
// a list item or in another callout's body; and alone, as the one block written. The limits:
// - Round-trip Markdown reads each write back as blocks, and reading back a callout with more than
//   10 callouts in its body takes seconds (on 2026-11-20 every callout alone took 9 s on that writer).
//   Alone, it judges the callouts with at most 10 in their body; in place, only the cases that hold
//   none deeper, since each write there reads the whole case back.
// - In place, a case over KEEP_BYTES is left out: "callouts 1000 deep" (2 MB) written once for each
//   of its 50 callouts takes about a minute. Alone, its callouts are judged.
const ROUND_TRIP_DEPTH = 10;
const isRoundTrip = (writer) => writer.name === 'round-trip Markdown';
const deepCase = new Set(cases.filter(({ callout }) => calloutDepth(bodyOf(callout)) > ROUND_TRIP_DEPTH).map(({ name }) => name));
const small = new Set(cases.filter(({ blocks }) => JSON.stringify(blocks).length <= KEEP_BYTES).map(({ name }) => name));
const alone = (writer) => (isRoundTrip(writer) ? cases.filter(({ callout }) => calloutDepth(bodyOf(callout)) <= ROUND_TRIP_DEPTH) : cases);
const inPlace = (writer) => cases.filter(({ name }) => small.has(name) && !(isRoundTrip(writer) && deepCase.has(name)));

test('React and the text writers show a callout\'s content, then every block of its body, each once', (t) => {
  assert.deepEqual(READERS.map((w) => w.name), ['readable Markdown', 'plain text', 'round-trip Markdown', 'HTML', 'HTML with field and embed blocks']);
  t.diagnostic(READERS.map((w) => `${w.name}: in place ${inPlace(w).length} of ${cases.length}, alone ${alone(w).length} of ${cases.length}`).join('; '));
  const wrong = [];
  const judge = (writer, { name, path, callout }, where, at) => {
    const own = new Set(words(callout));
    const [whole, content, body, neither] = [callout, withoutBody(callout), { ...callout, content: [] }, withoutBody({ ...callout, content: [] })].map((b) => counts(wordsIn(textOf(writer, at(b)))));
    const off = [...own].filter((w) => (whole.get(w) ?? 0) !== (content.get(w) ?? 0) + (body.get(w) ?? 0) - (neither.get(w) ?? 0));
    if (off.length) wrong.push(`${writer.name}, ${where}: ${name} at /${path.join('/')}: ${off.join(', ')} shown other than once`);
    // Order: the content's words, then each body block's words as the writer writes that block alone.
    const mine = (text) => wordsIn(text).filter((w) => own.has(w));
    if (!inOrder(mine(textOf(writer, at(callout))), [...words(callout.content), ...bodyOf(callout).flatMap((b) => mine(textOf(writer, [b])))])) wrong.push(`${writer.name}, ${where}: ${name} at /${path.join('/')}: not content, then the body in order`);
  };
  for (const writer of READERS) {
    for (const c of inPlace(writer)) judge(writer, c, 'in place', (b) => replaced(c.blocks, c.path, b));
    for (const c of alone(writer)) judge(writer, c, 'alone', (b) => [b]);
  }
  assert.deepEqual(wrong, []);
});
