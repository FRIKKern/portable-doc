import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asDoc, diffDocs } from './diff-core.js';
import { MAX_SIMILARITY_WORK, matchBlocks } from './diff-match.js';
import { underBudget } from '../../scripts/lib/cpu-budget.mjs';

// Large docs, the case git's diff driver meets on every `git diff`. Each must
// finish far inside BUDGET_MS of CPU; matching that scanned or rescored every
// pair took 6 to 100 s, and field diffs that re-read each level 4 to 22 s.
const BUDGET_MS = 5000;

const timed = (a, b) => underBudget(BUDGET_MS, () => diffDocs(asDoc(a), asDoc(b)));
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

test('500 by 500 paragraphs of 3,000 words each, every one a little different, stay inside the budget, and the similarity work stops at its cap', () => {
  const words = (i, shift) => Array.from({ length: 3000 }, (_, k) => `w${(i * 7 + k * 13 + shift) % 4000}`).join(' ');
  const a = Array.from({ length: 500 }, (_, i) => para(words(i, 0)));
  const b = Array.from({ length: 500 }, (_, i) => para(words(i, 1)));
  const { summary } = timed(a, b);
  assert.equal(summary.added, summary.removed);
  // Work counts, which no load can change: the equality step reads each block once,
  // and scoring stops once its work passes the cap, by at most one block's words.
  const stats = {};
  matchBlocks(a, b, stats);
  assert.equal(stats.canon, a.length + b.length);
  assert.equal(stats.stopped, true);
  assert.ok(stats.work > MAX_SIMILARITY_WORK && stats.work <= MAX_SIMILARITY_WORK + 3000, `${stats.work} work units`);
});

test('a one-cell change in a 20,000-row table under lists nested 40 deep costs the table once, not once per level', () => {
  const nest = (inner) => Array.from({ length: 40 }).reduce((b, _, i) => ({ type: 'list', items: [{ text: `level ${i}`, children: [b] }] }), inner);
  // About 1.2 MB of JSON.
  const table = (last) => ({ type: 'table', rows: Array.from({ length: 20_000 }, (_, i) => [`row ${i} of the long table`, i === 19_999 ? last : 'a cell that stays the same']) });
  const { changes } = timed([nest(table('old'))], [nest(table('new'))]);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].fields.map((f) => [f.path.endsWith('.rows[19999][1]'), f.from, f.to]), [[true, 'old', 'new']]);
});

test('a one-number change at the bottom of a chart value 990 levels deep, holding 100,000 numbers, costs the value once, not once per level', () => {
  const chart = (last) => {
    let x = Array.from({ length: 100_000 }, (_, i) => (i === 99_999 ? last : i));
    for (let i = 0; i < 984; i++) x = [x];
    return { type: 'chart', series: [{ x }] };
  };
  const { changes } = timed([chart(1)], [chart(2)]);
  assert.deepEqual(changes[0].fields.map((f) => [f.path, f.from, f.to]), [[`series[0].x${'[0]'.repeat(984)}[99999]`, 1, 2]]);
});
