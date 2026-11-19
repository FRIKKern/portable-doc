import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '@portable-doc/validate';
import { underBudget } from '../../scripts/lib/cpu-budget.mjs';
import { parsedWork, readPlan } from './from-markdown.js';
import { CASES, callouts, calloutsOverQuotes } from './import-work-cases.mjs';
import { planText } from './import-work.js';
import { IMPORT_WORK, fromMarkdown, readMarkdown } from './index.js';

const t = (value) => ({ type: 'text', value });
const words = (n, prefix = 'w') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

// The deepest item of a list chain, and how many lists down it is (the top list is depth 0).
function deepest(list) {
  let item = list.items[0];
  let depth = 0;
  while (item.children) {
    item = item.children[0].items[0];
    depth++;
  }
  return { depth, content: item.content ?? item };
}

// Every word of the Markdown is in the doc's text, and the doc validates.
function keepsEveryWord(md, label) {
  const blocks = fromMarkdown(md);
  assert.deepEqual(validate({ blocks }), { ok: true }, label);
  assert.notEqual(blocks[0]?.type, 'code', `${label}: fell back to a code block`);
  const text = new Set(JSON.stringify(blocks).match(/[a-z]+\d+/g));
  const lost = md.match(/[a-z]+\d+/g).filter((w) => !text.has(w));
  assert.deepEqual(lost, [], `${label}: words lost`);
  return blocks;
}

test('a list nested 60 levels deep keeps every word: lists to depth 50, then the deepest item holds the rest as text, one space apart', () => {
  const nested = (marker, indent) => words(60).map((w, i) => `${' '.repeat(indent * i)}${marker} ${w}`).join('\n');
  for (const [label, md] of [['bullets', nested('-', 2)], ['ordered', nested('1.', 3)], ['checklist', nested('- [ ]', 2)]]) {
    const { depth, content } = deepest(keepsEveryWord(md, label)[0]);
    assert.equal(depth, 50, label);
    assert.deepEqual(content, [t(label === 'checklist' ? 'w50 [ ] w51 [ ] w52 [ ] w53 [ ] w54 [ ] w55 [ ] w56 [ ] w57 [ ] w58 [ ] w59' : words(10).map((_, i) => `w${50 + i}`).join(' '))], label);
  }
  // The deepest item keeps its own marks; what is flattened into it is plain text.
  const marked = words(60).map((w, i) => `${'  '.repeat(i)}- **${w}** and *more*`).join('\n');
  const { content } = deepest(keepsEveryWord(marked, 'marked')[0]);
  assert.deepEqual(content.slice(0, 2), [{ type: 'strong', children: [t('w50')] }, t(' and ')]);
  assert.equal(content.at(-1).value, ' w51 and more w52 and more w53 and more w54 and more w55 and more w56 and more w57 and more w58 and more w59 and more');
  // `- - - x` nests a list per marker on one line.
  assert.deepEqual(deepest(keepsEveryWord(`${'- '.repeat(60)}end0`, 'one line')[0]), { depth: 50, content: [t('end0')] });
});

test('quotes nested deep, lists inside quotes and quotes inside lists keep every word, and the doc validates', () => {
  const quotes = words(150).map((w, i) => `${'>'.repeat(i + 1)} ${w}`).join('\n');
  assert.deepEqual(keepsEveryWord(quotes, 'quotes'), [{ type: 'blockquote', content: [t(words(150).join(' '))] }]);
  keepsEveryWord(words(150).map((w, i) => `${'> '.repeat(i + 1)}- ${w}`).join('\n'), 'lists in quotes');
  keepsEveryWord(words(80).map((w, i) => `${'  '.repeat(i)}- > ${w}`).join('\n'), 'quotes in lists');
  keepsEveryWord(words(80).map((w, i) => `${'  '.repeat(i)}- ${w}\n${'  '.repeat(i + 1)}> q${i}`).join('\n'), 'a quote under each item');
  keepsEveryWord(`${'> - 1. '.repeat(60)}end0`, 'mixed on one line');
  keepsEveryWord(`${'**'.repeat(80)}w0 w1${'**'.repeat(80)} ${'['.repeat(60)}w2${'](https://a.example)'.repeat(60)}`, 'inline marks and links');
  const table = `${'> '.repeat(120)}| a0 | b0 |\n${'> '.repeat(120)}| - | - |\n${'> '.repeat(120)}| c0 | d0 |`;
  keepsEveryWord(table, 'a table deep in quotes');
});

test('100,000 levels of nesting import in under 1.5 s of CPU, with every word kept and no deep stack', () => {
  for (const md of [`${'- '.repeat(100_000)}end0`, `${'>'.repeat(100_000)} end0`, `${'1. '.repeat(100_000)}end0`, `${'> - '.repeat(50_000)}end0`]) {
    const start = process.cpuUsage();
    const blocks = fromMarkdown(md);
    const used = process.cpuUsage(start);
    const ms = (used.user + used.system) / 1000;
    assert.ok(ms < 1500, `${md.slice(0, 6)}: ${Math.round(ms)} ms of CPU`);
    assert.deepEqual(validate({ blocks }), { ok: true });
    assert.notEqual(blocks[0].type, 'code', md.slice(0, 6));
    assert.ok(JSON.stringify(blocks).includes('end0'), md.slice(0, 6));
  }
});

// The worst shape review found: lazy continuation lines under a deep quote. markdown-it checks
// every quote level on each line, so the import's work counts lines × depth as well as bytes.
const lazyUnderDeepQuote = () => {
  let md = `${'> '.repeat(300)}l0`;
  for (let i = 1; md.length < 500_000; i++) md += `\n> l${i}`;
  return md;
};

test('the work budget cuts lines nested deep at a stated line, keeps every word as plain text, and says so', () => {
  const md = lazyUnderDeepQuote();
  // A hang guard only, far above the real cost; the budget itself is counted in work.
  const { blocks, notices, work } = underBudget(20_000, () => readMarkdown(md));
  // Lines 1 to 3,998 are read; from line 3,999 on, the 52,726 lines left are one plain paragraph.
  assert.deepEqual(notices, [{ code: 'import_work_spent', rule: 'budget', path: '/blocks/1', line: 3_999, lines: 52_726 }]);
  assert.equal(IMPORT_WORK.notice, 'import_work_spent');
  assert.equal(work, 251_084_328);
  assert.deepEqual(blocks.map((b) => b.type), ['blockquote', 'paragraph']);
  assert.match(blocks[1].content[0].value, /^> l3998 > l3999 /);
  assert.deepEqual(blocks, keepsEveryWord(md, 'lazy lines under a deep quote'));
  // One long line, thousands of levels deep, runs out of the same budget by its characters.
  const line = readMarkdown(`${'- '.repeat(100_000)}end0`);
  assert.deepEqual(line.notices.map((n) => n.code), ['import_work_spent']);
  assert.ok(line.work > IMPORT_WORK.budget);
  // Within the budget there is no notice.
  assert.deepEqual(readMarkdown(words(60).map((w, i) => `${'  '.repeat(i)}- ${w}`).join('\n')).notices, []);
});

test('markdown-it\'s own count charges a quote its own lines, not the rest of the source, and lazy lines under a quote past the parse levels once per level', () => {
  const rest = 'x '.repeat(5_000);
  // The quote's line, its two characters and its line end; the 10 kB paragraph after it is the top level's.
  assert.equal(parsedWork(`> a\n# h\n\n${rest}`) - parsedWork(`a\n# h\n\n${rest}`), 5);
  // 150 quotes deep, past the levels one parse builds: each lazy line `lxxx` is 151 tokenize calls,
  // each charged the line and its 5 characters with the line end.
  const lazy = (n) => `${'>'.repeat(150)}l0${'\nlxxx'.repeat(n)}`;
  assert.equal((parsedWork(lazy(200)) - parsedWork(lazy(100))) / 100, 151 * 6);
});

test('a list item past the parse levels reads only its own lines: each later item stays its own, and the reading stays within the text\'s count', () => {
  // Each line opens a new top-level item, 300 lists deep. markdown-it once re-read every later
  // line at each item past the levels, and every later item landed inside the first.
  const items = Array.from({ length: 20 }, (_, i) => `${'- '.repeat(300)}a${i}`).join('\n');
  const [list, ...rest] = readMarkdown(items, { ...IMPORT_WORK, budget: Infinity }).blocks;
  assert.deepEqual(rest, []);
  assert.equal(list.items.length, 20);
  list.items.forEach((item, i) => assert.match(JSON.stringify(item), new RegExp(`"a${i}"`)));
  assert.ok(parsedWork(items) <= readMarkdown(items).work, `markdown-it ${parsedWork(items)}, the text's count ${readMarkdown(items).work}`);
});

// ── callouts in callouts ──

// The callouts down the first one's body, and the deepest.
function calloutChain(block) {
  let depth = 0;
  let at = block;
  for (let next = at.slots?.body?.find((b) => b.type === 'callout'); next; next = at.slots?.body?.find((b) => b.type === 'callout')) {
    at = next;
    depth++;
  }
  return { depth: depth + 1, deepest: at };
}

test('callouts nested past MAX_NEST in a document: the blocks around them stay, callouts go 50 deep, the deepest keeps the rest as its text', () => {
  for (const D of [51, 101]) {
    const md = `# Title0\n\nIntro0.\n\n${callouts(D)}\n\nOutro0.`;
    const blocks = keepsEveryWord(md, `${D} deep`);
    assert.deepEqual(blocks.map((b) => b.type), ['heading', 'paragraph', 'callout', 'paragraph'], `${D} deep`);
    assert.deepEqual(readMarkdown(md).notices, [], `${D} deep`);
    const { depth, deepest: last } = calloutChain(blocks[2]);
    assert.equal(depth, 51, `${D} deep: 50 callouts read their body as blocks, the 51st keeps its body as text`);
    assert.equal(last.slots, undefined);
    // The deeper markers stay as the literal text they are, as in any quote kept as text.
    assert.deepEqual(last.content, [t(Array.from({ length: D - 50 }, (_, i) => `h${50 + i}`).join(' [!info] '))], `${D} deep`);
  }
});

test('callouts 1000 deep cost what plain quotes as deep cost, in the text\'s count and in markdown-it\'s; past the budget the rest is plain text, as for plain quotes', () => {
  const NO_LIMIT = { ...IMPORT_WORK, budget: Infinity, lineBytes: null };
  const marked = callouts(1000);
  const plain = callouts(1000, '');
  // Within 1.05: the `[!info] ` on every other line is all the callouts add.
  for (const count of [(md) => planText(md, NO_LIMIT).work, parsedWork]) {
    assert.ok(count(marked) <= 1.05 * count(plain), `callouts ${count(marked)}, plain quotes ${count(plain)}`);
  }
  // The text before the cut reads as one callout, 50 deep; the rest is the plain paragraph
  // after it, and the notice names that paragraph.
  for (const md of [marked, plain]) {
    const { blocks, notices } = readMarkdown(md);
    assert.deepEqual(blocks.map((b) => b.type), [md === marked ? 'callout' : 'blockquote', 'paragraph']);
    assert.deepEqual(notices.map((n) => [n.code, n.rule, n.path]), [[IMPORT_WORK.notice, 'budget', '/blocks/1']]);
  }
  assert.equal(calloutChain(readMarkdown(marked).blocks[0]).depth, 51);
});

test('a callout\'s parts are each read once: the nodes the read visits stay within the tokens markdown-it made, for callouts 1000 and 150 deep and over plain quotes', () => {
  const NO_LIMIT = { ...IMPORT_WORK, budget: Infinity, lineBytes: null };
  for (const name of ['callouts 1000 deep', 'callouts 150 deep, a paragraph in each', ...Object.keys(CASES).filter((n) => / callouts over \d+ plain quotes/.test(n))]) {
    const { count } = readPlan(planText(CASES[name], NO_LIMIT), NO_LIMIT);
    // Each node read once is at most one visit a token; reading a callout's text again at each level of 50 is ten times that and more.
    assert.ok(count.tokens > 0 && count.visits <= count.tokens, `${name}: ${count.visits} visits, ${count.tokens} tokens`);
  }
});

test('callouts over plain quotes, and callouts 150 deep, keep their structure with no notice', () => {
  for (const [C, P, W] of [[10, 40, 5], [30, 30, 3], [3, 90, 2]]) {
    const md = calloutsOverQuotes(C, P, W);
    const blocks = keepsEveryWord(md, `${C} over ${P}`);
    assert.deepEqual(readMarkdown(md).notices, []);
    const { depth, deepest: last } = calloutChain(blocks[0]);
    assert.equal(depth, C, `${C} over ${P}`);
    assert.deepEqual(last.slots.body.map((b) => b.type), ['blockquote'], `${C} over ${P}: the plain quotes are one quote of text`);
  }
  const md = CASES['callouts 150 deep, a paragraph in each'];
  assert.deepEqual(readMarkdown(md).notices, []);
  assert.equal(calloutChain(keepsEveryWord(md, '150 deep')[0]).depth, 51);
});
