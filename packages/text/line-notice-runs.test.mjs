// Under lineBytes, the line rule gives one notice per run of cut lines: { line: the run's first
// line, lines: how many }, at the path of the paragraph that first line went to. A run is cut lines
// with consecutive line numbers; any line not cut (blank or short) ends it, and a fence opened again
// after a cut line does not. So `lines` is a range, as in every other notice, and a portabledoc
// fence whose opening line is cut has a notice on its own line within the first MAX_LINE_NOTICES
// runs; past them, the import_line_notices_capped notice counts it. The notices keep their order:
// 'budget' and 'line' by first line, then the rest of the import's, then 'net'. Past
// MAX_LINE_NOTICES runs, one LINE_NOTICES_CAPPED notice stands for every later run.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPlan } from './from-markdown.js';
import { IMPORT_WORK, planText } from './import-work.js';
import { LINE_NOTICES_CAPPED, MAX_LINE_NOTICES, readMarkdown } from './index.js';

const X = (n, c = 'x') => c.repeat(n);
const LINE = { ...IMPORT_WORK, lineBytes: 40 };
const lineNotice = (path, line, lines = 1) => ({ code: 'import_work_spent', rule: 'line', path, line, lines });
const at = (doc, path) => path.split('/').slice(1).reduce((v, k) => v?.[k], { blocks: doc.blocks });
const long = (line) => line.trim() !== '' && Buffer.byteLength(line) > LINE.lineBytes;

// Each line notice covers `line` to `line + lines - 1`. A run notice names its own run: the lines
// it spans are cut, the lines just outside are not. The capped notice's range starts and ends on a
// cut line, with no cut line just outside, and holds exactly its `cut` cut lines and `runs` runs,
// counted in the text. Each path is the paragraph of the notice's first line, as typed.
function ownRuns(md, doc) {
  const lines = md.split('\n');
  for (const n of doc.notices.filter((n) => n.rule === 'line')) {
    const range = lines.slice(n.line - 1, n.line - 1 + n.lines);
    if (n.code === LINE_NOTICES_CAPPED) {
      assert.ok(long(range[0]) && long(range.at(-1)), `the capped range ${n.line}+${n.lines} starts and ends on a cut line`);
      const runStarts = range.filter((line, i) => long(line) && !long(range[i - 1] ?? '')).length;
      assert.deepEqual({ cut: range.filter(long).length, runs: runStarts }, { cut: n.cut, runs: n.runs }, `the capped range ${n.line}+${n.lines} holds its cut lines and runs`);
    } else for (let i = n.line; i < n.line + n.lines; i++) assert.ok(long(lines[i - 1]), `line ${i} in a run is cut`);
    assert.ok(!long(lines[n.line - 2] ?? ''), `the line before the range at ${n.line} is not cut`);
    assert.ok(!long(lines[n.line + n.lines - 1] ?? ''), `the line after the range at ${n.line} is not cut`);
    assert.deepEqual(at(doc, n.path), { type: 'paragraph', content: [{ type: 'text', value: lines[n.line - 1] }] }, `${n.path} is line ${n.line}`);
  }
}

test('under lineBytes, a portabledoc fence whose opening line is cut has a line notice on its own line, after an earlier cut line too', () => {
  const md = `${X(41)}\n\n\`\`\`portabledoc ${X(40, 'y')}\n[{"type":"divider"}]\n\`\`\``;
  const doc = readMarkdown(md, LINE);
  assert.deepEqual(doc.notices.filter((n) => n.rule === 'line'), [lineNotice('/blocks/0', 1), lineNotice('/blocks/1', 3)]);
  ownRuns(md, doc);
});

test('each run of cut lines has its own line notice: its first line, its length and the path of its first line\'s paragraph', () => {
  for (const [md, want] of [
    // Two runs: a line not cut ends a run.
    [`${X(41)}\n${X(41, 'y')}\nok\n${X(41, 'z')}`, [lineNotice('/blocks/0', 1, 2), lineNotice('/blocks/3', 4)]],
    // A blank line ends a run too.
    [`${X(41)}\n\n${X(41, 'y')}`, [lineNotice('/blocks/0', 1), lineNotice('/blocks/1', 3)]],
    // In an open fence, the fence opened again after a cut line does not end the run.
    [`\`\`\`js\na\n${X(41)}\n${X(41, 'y')}\nb\n\`\`\`\nafter`, [lineNotice('/blocks/1', 3, 2)]],
  ]) {
    const doc = readMarkdown(md, LINE);
    assert.deepEqual(doc.notices, want, md);
    ownRuns(md, doc);
  }
});

test('line notices come in source order by first line, with the budget notice where it falls, before the fence notices and after none of them', () => {
  const head = `${X(41)}\nok\n${X(41, 'y')}\n\n\`\`\`portabledoc\nnope\n\`\`\`\n`;
  // The budget runs out on the filler after the fence.
  const budget = planText(head, { ...LINE, budget: Infinity }).work + 20;
  const md = `${head}${Array.from({ length: 10 }, (_, i) => `filler ${i}`).join('\n')}`;
  const doc = readMarkdown(md, { ...LINE, budget });
  assert.deepEqual(doc.notices.map((n) => [n.code, n.rule, n.line]), [
    ['import_work_spent', 'line', 1],
    ['import_work_spent', 'line', 3],
    // Line 10: the head's count takes its last, blank line (2), so the first two fillers fit.
    ['import_work_spent', 'budget', 10],
    ['fence_not_json', undefined, 5],
  ]);
  ownRuns(md, doc);
});

test('past MAX_LINE_NOTICES runs, one capped notice stands for the rest: run notices, and the run notices\' lines plus its cut equal the cut lines, at one below, at, and one and two past the bound', () => {
  for (const runs of [MAX_LINE_NOTICES - 1, MAX_LINE_NOTICES, MAX_LINE_NOTICES + 1, MAX_LINE_NOTICES + 2]) {
    // Runs of one and two cut lines in turn, each ended by a short line.
    const md = Array.from({ length: runs }, (_, i) => `${X(41)}\n${i % 2 ? `${X(41, 'y')}\n` : ''}ok ${i}`).join('\n');
    const cut = md.split('\n').filter(long).length;
    const doc = readMarkdown(md, LINE);
    const notices = doc.notices.filter((n) => n.rule === 'line');
    const runNotices = notices.filter((n) => n.code === 'import_work_spent');
    const capped = notices.filter((n) => n.code === LINE_NOTICES_CAPPED);
    const row = { runs, runNotices: runNotices.length, capped: capped.map((n) => n.runs), sum: runNotices.reduce((a, n) => a + n.lines, 0) + (capped[0]?.cut ?? 0) };
    assert.deepEqual(row, { runs, runNotices: Math.min(runs, MAX_LINE_NOTICES), capped: runs > MAX_LINE_NOTICES ? [runs - MAX_LINE_NOTICES] : [], sum: cut });
    assert.equal(notices.length, runNotices.length + capped.length, 'every line notice is a run notice or the capped one');
    if (capped.length) {
      // The capped notice is last, at the first line of the first run past the bound.
      const all = md.split('\n');
      const starts = all.flatMap((line, i) => (long(line) && !long(all[i - 1] ?? '') ? [i + 1] : []));
      assert.equal(notices.at(-1), capped[0]);
      assert.equal(capped[0].line, starts[MAX_LINE_NOTICES]);
    }
    ownRuns(md, doc);
  }
});

test('readPlan keeps a paragraph path only where a notice starts: its path keys are at most its notices, past the bound too', () => {
  const runs = MAX_LINE_NOTICES + 2;
  // Runs of two cut lines: more cut lines than notices, whether a notice stands for one run or many.
  const md = Array.from({ length: runs }, (_, i) => `${X(41)}\n${X(41, 'y')}\nok ${i}`).join('\n');
  const plan = planText(md, LINE);
  const read = readPlan(plan, LINE);
  const cut = md.split('\n').filter(long).length;
  assert.deepEqual([read.notices.length, cut], [MAX_LINE_NOTICES + 1, 2 * runs]);
  assert.ok(read.pathKeys <= read.notices.length, `${read.pathKeys} path keys for ${read.notices.length} notices and ${cut} cut lines`);
});
