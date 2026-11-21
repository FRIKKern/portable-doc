import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsedWork, readPlan } from './from-markdown.js';
import { IMPORT_WORK, normalize, planText, prefix } from './import-work.js';
import { readMarkdown } from './index.js';
import { CASES, seeded } from './import-work-cases.mjs';

const t = (value) => ({ type: 'text', value });
const p = (value) => ({ type: 'paragraph', content: [t(value)] });
const X = (n, c = 'x') => c.repeat(n);
const NO_LIMIT = { budget: Infinity, lineBytes: null, notice: IMPORT_WORK.notice };
// A small line bound, so the cases stay readable; the pack sets the real one.
const LINE = { budget: IMPORT_WORK.budget, lineBytes: 40, notice: IMPORT_WORK.notice };
const lineNotice = (path, line, lines = 1) => ({ code: 'import_work_spent', rule: 'line', path, line, lines });

test('the work is counted from the text: each line (depth + 1) × (2 + its bytes), the depth from its markers and indentation, carried over lazy lines', () => {
  assert.deepEqual(prefix('> - 1. x'), { m: 3, w: 3, at: 7, containers: [{ quote: true }, { col: 4 }, { col: 7 }] });
  assert.deepEqual(prefix('\t-\tx'), { m: 1, w: 7, at: 3, containers: [{ col: 6 }] }, 'a tab runs to the next tab stop');
  assert.equal(prefix('-x').m, 0, 'a marker needs a space, a tab or the line end after it');
  assert.equal(prefix('1234567890. x').m, 0, 'at most 9 digits');
  const work = (md) => planText(md, NO_LIMIT).work;
  assert.equal(work('a'), 3);
  assert.equal(work('> a'), 2 * 5, 'one marker, one space: depth 1 + 0');
  assert.equal(work('> > a\nlazy'), 4 * 7 + 4 * 6, 'two markers, two spaces: depth 3; a lazy line keeps it');
  assert.equal(work('> > a\n\nb'), 4 * 7 + 4 * 2 + 1 * 3, 'a blank line keeps it; the line after a blank line starts again');
  assert.equal(work('- a\n\n    b'), 2 * 5 + 2 * 2 + 3 * 7, 'indentation counts a level per 2 columns');
  assert.equal(work('é'), 4, 'bytes, not characters');
  // Lines and bytes as markdown-it sees them: its core rule 'normalize' first.
  assert.equal(work('a\rb\r\nc\nd'), 4 * 3, '"\\n", "\\r\\n" and a lone "\\r" each end a line');
  assert.equal(work('\0'), 5, 'a NUL is read as U+FFFD, three bytes');
  assert.deepEqual(readMarkdown('a\r\rb\0', NO_LIMIT).blocks, [p('a'), p('b\uFFFD')]);
});

// Each sweep's size: IMPORT_WORK_SWEEP=20000 runs longer ones (several minutes) by hand.
const SWEEP = Number(process.env.IMPORT_WORK_SWEEP) || 300;
const netNotices = (r) => r.notices.filter((n) => n.rule === 'net');

test('the text\'s count is never below what markdown-it does, for each case and two seeded sweeps, whole and for every run of first lines; so the net never fires', (t) => {
  const below = [];
  const nets = [];
  const least = { cases: { ratio: Infinity }, sweeps: { ratio: Infinity } };
  const measure = (name, md) => {
    const work = planText(md, NO_LIMIT).work;
    const real = parsedWork(md);
    if (work < real) below.push(name);
    const kind = /^(random|fences) /.test(name) ? 'sweeps' : 'cases';
    if (real > 0 && work / real < least[kind].ratio) least[kind] = { ratio: work / real, name, md };
    return work;
  };
  const check = (name, md) => {
    const lines = normalize(md).split('\n');
    for (let n = 1; n <= lines.length; n += Math.max(1, Math.floor(lines.length / 6))) measure(`${name}, first ${n} lines`, lines.slice(0, n).join('\n'));
    const work = measure(name, md);
    // markdown-it's own count behind the text's, at budgets that cut the text and at the bound.
    for (const budget of [Math.floor(work / 3), Math.floor(work / 2), work]) {
      for (const lineBytes of [null, 40]) {
        if (netNotices(readMarkdown(md, { ...IMPORT_WORK, budget, lineBytes })).length) nets.push(`${name}, budget ${budget}, lineBytes ${lineBytes}`);
      }
    }
  };
  for (const [name, md] of Object.entries(CASES)) check(name, md);
  const PIECES = ['> ', '>', '>', '- ', '* ', '+ ', '1. ', '2) ', '10. ', '  ', '  ', ' ', '    ', '\t', '-\t', '>\t'];
  const TAILS = ['text', '', '```', '~~~', '---', '===', '- x', '# h', '| a | b |', '| - | - |', '<div>', '</div>', '***', '> ', '1. y', '    code', '[x]: /u', '\\', '**b**'];
  const rnd = seeded(825);
  for (let d = 0; d < SWEEP; d++) {
    const deep = rnd(4) === 0 ? 150 : 25;
    const lines = Array.from({ length: 1 + rnd(30) }, () => {
      if (rnd(6) === 0) return '';
      if (rnd(4) === 0) return TAILS[rnd(TAILS.length)];
      let s = '';
      for (let i = rnd(deep); i > 0; i--) s += PIECES[rnd(PIECES.length)];
      return s + TAILS[rnd(TAILS.length)];
    });
    check(`random ${d}`, lines.join(rnd(8) === 0 ? ['\r\n', '\r'][rnd(2)] : '\n'));
  }
  // Weighted toward where a fence tracker may go wrong: fences in quotes and list items, fences
  // left open or ended by their container, fence-like lines in indented code, HTML and link
  // definitions, backticks against tildes, short closing fences, info strings with backticks,
  // tabs with markers, indentation before a marker; and deep lines to show any line wrongly
  // charged as code.
  const OPEN = ['', '', '> ', '> > ', '- ', '1. ', '* ', '  ', '   ', '    ', '     ', '\t', '>\t', '-\t', '\t- ', ' - ', '  - ', '-   ', '-     ', '> - ', '- > ', '>     '];
  const BODY = ['```', '```', '````', '~~~', '~~~~', '```js', '``` a`b', '~~~ a`b', '``', '```   ', '    ```', '\t```', 'code', 'text', '', '', '- x', '> q', '<div>', '<!--', '-->', '<script>', '</script>', '[x]:', '"t', '\t\tx', '\t- t', '  - i', '1. o', '2. o', '-'];
  const DEEP = ['> ', '- ', '>', '  ', '\t', '1. ', '  - '];
  for (let d = 0; d < SWEEP; d++) {
    const lines = [];
    for (let k = 1 + rnd(40); k > 0; k--) {
      const r = rnd(12);
      if (r === 0) lines.push(DEEP[rnd(DEEP.length)].repeat(10 + rnd(60)) + BODY[rnd(BODY.length)]);
      else if (r === 1) for (let i = 0, n = rnd(20); i < n; i++) lines.push(`${'  '.repeat(i)}- s${i}`);
      else {
        let s = '';
        for (let i = rnd(3); i > 0; i--) s += OPEN[rnd(OPEN.length)];
        lines.push(s + BODY[rnd(BODY.length)]);
      }
    }
    check(`fences ${d}`, lines.join('\n'));
  }
  for (const [kind, l] of Object.entries(least)) t.diagnostic(`least count / markdown-it in the ${kind}: ${l.ratio.toFixed(3)}, ${l.name}: ${JSON.stringify(l.md).slice(0, 400)}`);
  assert.deepEqual(below, []);
  assert.deepEqual(nets, []);
});

test('the net: where the text\'s count was wrong and markdown-it\'s own count passes the budget, the rest of the deep text is plain text, every word, with one notice', () => {
  // A plan made with no budget, read with a small one: the text's count planted short.
  const md = `${X(150, '> ')}w0 w1\n${X(150, '> ')}w2\n\n${X(100, '- ')}w3 **w4**\n\n- w5\n  > w6\n\nw7 end`;
  const words = (blocks) => JSON.stringify(blocks).match(/\bw\d\b/g);
  const limits = { ...IMPORT_WORK, budget: 20_000 };
  assert.ok(parsedWork(md) > limits.budget);
  const read = readPlan(planText(md, NO_LIMIT), limits);
  assert.deepEqual(read.notices, [{ code: 'import_work_spent', rule: 'net', path: '/blocks/0', line: 1, lines: 5 }]);
  // The same shape after a top-level paragraph: the path and line move with it.
  assert.deepEqual(netNotices(readPlan(planText(`top\n\n${md}`, NO_LIMIT), limits)), [{ code: 'import_work_spent', rule: 'net', path: '/blocks/1', line: 3, lines: 5 }]);
  assert.deepEqual(words(read.blocks), ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']);
  assert.deepEqual(read.blocks.at(-1), p('w7 end'), 'the top level is still read');
  // With the text's own count the plan cuts first, and the net stays quiet.
  assert.deepEqual(netNotices(readMarkdown(md, limits)), []);
});

test('the net fires at the top level too: a count planted short of a flat text\'s own work keeps every word, as plain text', () => {
  const md = Array.from({ length: 40 }, (_, i) => `w${i} **x${i}** [y${i}](https://example.com/${i})`).join('\n\n');
  const plan = planText(md, NO_LIMIT);
  // Flat text: markdown-it's work is all at the top level, with no container below it to skip.
  const read = readPlan({ ...plan, work: 1 }, { ...IMPORT_WORK, budget: parsedWork(md) - 1 });
  assert.deepEqual(read.notices, [{ code: 'import_work_spent', rule: 'net', path: '/blocks/0', line: 1, lines: 79 }]);
  assert.deepEqual(read.blocks, [p(md.replace(/\s+/g, ' '))]);
  // A list's own top level passes the budget, not its items: it is cut before any item is read.
  const list = Array.from({ length: 40 }, (_, i) => `- a${i}\n  - b${i}`).join('\n');
  const listRead = readPlan(planText(list, NO_LIMIT), { ...IMPORT_WORK, budget: 100 });
  assert.deepEqual(listRead.notices, [{ code: 'import_work_spent', rule: 'net', path: '/blocks/0', line: 1, lines: 80 }]);
  assert.deepEqual(listRead.blocks, [p(list.replace(/\s+/g, ' '))]);
});

test('a line past the line bound is one plain top-level paragraph, as typed, between the text before it and the text after it, each read as a document', () => {
  const read = (md) => readMarkdown(md, LINE);
  assert.deepEqual(read(X(40)), { blocks: [p(X(40))], notices: [], work: 42 }, 'at the bound, an ordinary line');
  assert.deepEqual(read(X(41)).notices, [lineNotice('/blocks/0', 1)]);
  assert.equal(read(X(41)).work, 41, 'a long line is charged its bytes once');
  // A quote and a list item close before it; the text after it opens new ones.
  const quote = { type: 'blockquote' };
  assert.deepEqual(read(`> a\n> ${X(41)}\n> b`).blocks, [{ ...quote, content: [t('a')] }, p(`> ${X(41)}`), { ...quote, content: [t('b')] }]);
  const list = (...items) => ({ type: 'list', ordered: false, items });
  assert.deepEqual(read(`- a\n  ${X(41)}\n- b`).blocks, [list([t('a')]), p(`  ${X(41)}`), list([t('b')])]);
  // A table ends before it, and the rows after it are read afresh, their words kept.
  const table = read(`| a | b |\n| - | - |\n| 1 | 2 |\n| ${X(41)} |\n| 3 | 4 |`).blocks;
  assert.deepEqual(table.slice(1), [p(`| ${X(41)} |`), p('| 3 | 4 |')]);
  assert.equal(table[0].rows.length, 1);
  // A setext underline makes no heading; a link reference definition defines nothing.
  assert.deepEqual(read(`Title\n${X(41, '=')}`).blocks, [p('Title'), p(X(41, '='))]);
  assert.deepEqual(read(`[ref]: https://example.com/${X(30)}\n\nsee [ref]`).blocks, [p(`[ref]: https://example.com/${X(30)}`), p('see [ref]')]);
  // One notice per run of cut lines: its first line, and how many (line-notice-runs.test.mjs).
  assert.deepEqual(read(`${X(41)}\n${X(41, 'y')}\nok\n${X(41, 'z')}`).notices, [lineNotice('/blocks/0', 1, 2), lineNotice('/blocks/3', 4)]);
});

test('a long line inside an open code fence ends the code before it, and the code after it stays code; a long fence marker opens nothing', () => {
  const read = (md) => readMarkdown(md, LINE).blocks;
  const code = (value) => ({ type: 'code', value, lang: 'js' });
  assert.deepEqual(read(`\`\`\`js\nconst a = 1;\n${X(41, 'y')}\nconst b = 2;\n\`\`\`\nafter`), [code('const a = 1;'), p(X(41, 'y')), code('const b = 2;'), p('after')]);
  assert.deepEqual(read(`\`\`\`${X(41)}\n**a**\nafter`), [p(`\`\`\`${X(41)}`), { type: 'paragraph', content: [{ type: 'strong', children: [t('a')] }, t(' after')] }]);
  // In a quote: the fence goes on while its lines carry the quote, and opens again with `> ```js`.
  const quote = (value) => ({ type: 'blockquote', content: [t(value)] });
  assert.deepEqual(read(`> \`\`\`js\n> one\n> ${X(41)}\n> two\n> \`\`\`\nafter`), [quote('one'), p(`> ${X(41)}`), quote('two'), p('after')]);
  // In a list item: it opens again as `- ```js`, so the rest of the code is in a new item.
  const list = (...items) => ({ type: 'list', ordered: false, items });
  assert.deepEqual(read(`- \`\`\`js\n  one\n  ${X(41)}\n  two\n  \`\`\`\n- b`), [list([{ type: 'code', value: 'one' }]), p(`  ${X(41)}`), list([{ type: 'code', value: 'two' }], [t('b')])]);
  // A line that leaves the quote ends the fence with it, so a long line after that opens nothing.
  assert.deepEqual(read(`> \`\`\`\n> code\nplain\n${X(41)}\nmore`), [quote('code'), p('plain'), p(X(41)), p('more')]);
});

test('past the budget, open containers close at the cut line, and the rest of the text is one plain top-level paragraph with one budget notice', () => {
  // A list too deep to read is cut at its own line: the whole text is one paragraph.
  const huge = `${X(100_000, '- ')}a0\n\nb0\n\n${X(300, '> ')}c0`;
  const { blocks, notices } = readMarkdown(huge);
  assert.deepEqual(notices, [{ code: 'import_work_spent', rule: 'budget', path: '/blocks/0', line: 1, lines: 5 }]);
  assert.deepEqual(blocks, [p(`${X(100_000, '- ')}a0 b0 ${X(300, '> ')}c0`.replace(/\s+/g, ' ').trim())]);
  // Cut inside a list: the lines read before the cut are a list; b0 and the quote are in the plain rest.
  const deepItems = Array.from({ length: 120 }, (_, i) => `${X(300, '- ')}a${i}`).join('\n');
  const mid = readMarkdown(`${deepItems}\n\nb0\n\n${X(300, '> ')}c0`);
  assert.deepEqual(mid.blocks.map((b) => b.type), ['list', 'paragraph']);
  // Each of the 58 items read is 300 lists deep: the list 99 deep under it keeps the rest as text, and says so.
  const kept = Array.from({ length: 58 }, (_, i) => ({ code: 'nesting_kept_as_text', path: `/blocks/0/items/${i}/children/0${'/items/0/children/0'.repeat(98)}`, line: i + 1, lines: 1 }));
  assert.deepEqual(mid.notices, [{ code: 'import_work_spent', rule: 'budget', path: '/blocks/1', line: 59, lines: 66 }, ...kept]);
  assert.match(mid.blocks[1].content[0].value, /^- - .* a58 .* a119 b0 > > .* c0$/);
});
