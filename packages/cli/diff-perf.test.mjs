import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asDoc, diffDocs } from './diff-core.js';

// Large docs of blocks without ids, the case git's diff driver meets on every `git diff`.
// Each must finish far inside LIMIT_MS; matching that scanned or rescored every pair took 6 to 100 s.
const LIMIT_MS = 5000;

function timed(a, b) {
  const start = performance.now();
  const result = diffDocs(asDoc(a), asDoc(b));
  const ms = performance.now() - start;
  assert.ok(ms < LIMIT_MS, `took ${Math.round(ms)} ms`);
  return result;
}

const para = (text) => ({ type: 'paragraph', text });

test('60,000 identical paragraphs without ids diff as equal', () => {
  const doc = Array.from({ length: 60_000 }, (_, i) => para(`Paragraph ${i} of the long doc.`));
  assert.equal(timed(doc, structuredClone(doc)).equal, true);
});

test('30,000 paragraphs without ids in reverse order diff as moves, not removes and adds', () => {
  const doc = Array.from({ length: 30_000 }, (_, i) => para(`Paragraph ${i} of the long doc.`));
  const { summary } = timed(doc, doc.toReversed());
  assert.deepEqual([summary.added, summary.removed, summary.changed], [0, 0, 0]);
  assert.equal(summary.moved, 29_999);
});

test('500 by 500 paragraphs of 3,000 words each, every one a little different, stay inside the limit', () => {
  const words = (i, shift) => Array.from({ length: 3000 }, (_, k) => `w${(i * 7 + k * 13 + shift) % 4000}`).join(' ');
  const a = Array.from({ length: 500 }, (_, i) => para(words(i, 0)));
  const b = Array.from({ length: 500 }, (_, i) => para(words(i, 1)));
  const { summary } = timed(a, b);
  assert.equal(summary.added, summary.removed);
});
