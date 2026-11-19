import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsedWork, readPlan } from './from-markdown.js';
import { IMPORT_WORK, normalize, planText, prefix } from './import-work.js';
import { readMarkdown } from './index.js';

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

// markdown-it's own count (parsedWork) is what reading the text costs; the text's count may
// be more, never less, for the whole text and for every run of first lines (what the import
// reads before a cut).
const CASES = {
  'lazy lines under a deep quote': `${X(300, '> ')}l0${'\nl1'.repeat(150)}`,
  'quoted lines under a deep quote': `${X(300, '> ')}l0${'\n> l1'.repeat(150)}`,
  'lazy lines under quote markers with no spaces': `${X(300, '>')}l0${'\nlxxxxxxxxxxxxxxx'.repeat(150)}`,
  'a lazy line that looks like a list marker': `${X(120, '> ')}a\n- b\n${X(120, '> ')}c\n1. d\n* e`,
  'a lazy line that looks like a fence': `${X(120, '> ')}a\n\`\`\`\ncode\n\`\`\`\n${X(60, '- ')}b\n~~~\nx`,
  'a blank line inside a fenced block under quotes': `${X(80, '> ')}\`\`\`\n${X(80, '> ')}a\n\n${X(80, '> ')}b\n${X(80, '> ')}\`\`\`\n`,
  'tabs versus spaces before markers': [...Array.from({ length: 80 }, (_, i) => `${X(i, '\t')}- t${i}`), ...Array.from({ length: 80 }, (_, i) => `${X(i, '  ')}- s${i}`)].join('\n'),
  'tabs between markers': `${X(150, '>\t')}a\n${X(150, '-\t')}b`,
  'a setext underline under a deep quote': `${X(150, '> ')}Title\n===\n${X(150, '> ')}Sub\n---\n${X(70, '- ')}x\n  ---`,
  'one long line of list markers': `${X(3000, '- ')}end`,
  'one long line of quote markers': `${X(3000, '> ')}end`,
  'ordered markers': `${X(400, '1. ')}x\n${X(400, '2) ')}y`,
  'list items continued by indentation after blank lines': Array.from({ length: 60 }, (_, i) => `${X(i, '  ')}- i${i}\n\n${X(i + 1, '  ')}more ${i}\n`).join('\n'),
  'a list item that starts with a blank line': Array.from({ length: 60 }, (_, i) => `${X(i, '  ')}-\n${X(i + 1, '  ')}text ${i}`).join('\n'),
  'a quote under each list item': Array.from({ length: 120 }, (_, i) => `${X(i, '  ')}- > q${i}`).join('\n'),
  'deep then shallow then deep': `${X(200, '- ')}a\nb\n\nc\n${X(200, '> ')}d`,
  'html and tables deep': ['<div>', 'x</div>', '| a | b |', '| - | - |', '| 1 | 2 |'].map((l) => `${X(120, '> ')}${l}`).join('\n'),
  'carriage returns': `${X(150, '> ')}a\r\n> b\r\n\r\n${X(100, '- ')}c\r\n`,
  'lone carriage returns under deep quotes': `x\r${X(200, `${X(200, '> ')}y\r`)}`,
  'lone carriage returns under deep list items': `x\r${X(200, `${X(200, '- ')}y\r`)}`,
  'a carriage return inside each list prefix': X(100, `${X(10, '- \r- ')}y\n`),
  'tabs after markers at every column': Array.from({ length: 120 }, (_, i) => `${X(i % 7, ' ')}${X(i, i % 2 ? '>\t' : '-\t')}t${i}`).join('\n'),
  'NULs under a deep quote': `${X(150, '> ')}${X(300, '\0')}\n${X(150, '> ')}a`,
};

/** A seeded run of numbers in [0, n), the same on every machine. */
function seeded(seed) {
  let s = seed >>> 0;
  return (n) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return Math.floor((((x ^ (x >>> 14)) >>> 0) / 4294967296) * n);
  };
}

// The sweep's size: IMPORT_WORK_SWEEP=20000 runs a longer one (a few minutes) by hand.
const SWEEP = Number(process.env.IMPORT_WORK_SWEEP) || 300;
const netNotices = (r) => r.notices.filter((n) => n.rule === 'net');

test('the text\'s count is never below what markdown-it does, for each case and a seeded sweep, whole and for every run of first lines; so the net never fires', () => {
  const below = [];
  const nets = [];
  const check = (name, md) => {
    const lines = normalize(md).split('\n');
    for (let n = 1; n <= lines.length; n += Math.max(1, Math.floor(lines.length / 6))) {
      const head = lines.slice(0, n).join('\n');
      if (planText(head, NO_LIMIT).work < parsedWork(head)) below.push(`${name}, first ${n} lines`);
    }
    const work = planText(md, NO_LIMIT).work;
    if (work < parsedWork(md)) below.push(name);
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
  assert.deepEqual(netNotices(read).map(({ code, rule, path }) => ({ code, rule, path })), [{ code: 'import_work_spent', rule: 'net', path: '/blocks/0' }]);
  assert.ok(read.notices[0].work > limits.budget);
  assert.deepEqual(words(read.blocks), ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']);
  assert.deepEqual(read.blocks.at(-1), p('w7 end'), 'the top level is still read');
  // With the text's own count the plan cuts first, and the net stays quiet.
  assert.deepEqual(netNotices(readMarkdown(md, limits)), []);
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
  // One notice per rule: the first line it cut, and how many.
  assert.deepEqual(read(`${X(41)}\n${X(41, 'y')}\nok\n${X(41, 'z')}`).notices, [lineNotice('/blocks/0', 1, 3)]);
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

test('past the budget, open containers close at the cut line, and the rest of the text is one plain top-level paragraph with one notice', () => {
  // A list too deep to read is cut at its own line: the whole text is one paragraph.
  const huge = `${X(100_000, '- ')}a0\n\nb0\n\n${X(300, '> ')}c0`;
  const { blocks, notices } = readMarkdown(huge);
  assert.deepEqual(notices, [{ code: 'import_work_spent', rule: 'budget', path: '/blocks/0', line: 1, lines: 5 }]);
  assert.deepEqual(blocks, [p(`${X(100_000, '- ')}a0 b0 ${X(300, '> ')}c0`.replace(/\s+/g, ' ').trim())]);
  // Cut inside a list: the lines read before the cut are a list; b0 and the quote are in the plain rest.
  const deepItems = Array.from({ length: 120 }, (_, i) => `${X(300, '- ')}a${i}`).join('\n');
  const mid = readMarkdown(`${deepItems}\n\nb0\n\n${X(300, '> ')}c0`);
  assert.deepEqual(mid.blocks.map((b) => b.type), ['list', 'paragraph']);
  assert.deepEqual(mid.notices, [{ code: 'import_work_spent', rule: 'budget', path: '/blocks/1', line: 59, lines: 66 }]);
  assert.match(mid.blocks[1].content[0].value, /^- - .* a58 .* a119 b0 > > .* c0$/);
});
