// Markdown written by hand imports as deep as validate allows blocks: one Markdown level is one
// format level, validate's MAX_DEPTH of them, callouts and lists counted together. Past it every
// word is kept as text in the deepest block, and readMarkdown says so with a NESTING_KEPT_AS_TEXT
// notice naming that block. Marks inside marks keep their own limit, MAX_MARK_NEST.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DEPTH, MAX_VALUE_DEPTH, validate, walkDepth } from '@portable-doc/validate';
import { underBudget } from '../../scripts/lib/cpu-budget.mjs';
import { MAX_MARK_NEST } from './from-markdown-inline.js';
import { NESTING_KEPT_AS_TEXT, readMarkdown } from './index.js';

const t = (value) => ({ type: 'text', value });
// n callouts, each `[!note] c<i>` with a bare quote line under it, so the next is a block of its body.
const quotes = (n) => Array.from({ length: n }, (_, i) => `${'> '.repeat(i + 1)}[!note] c${i + 1}\n${'> '.repeat(i + 1).trimEnd()}`).join('\n');
// A list indented n deep, one item a level, no fence.
const list = (n) => Array.from({ length: n }, (_, i) => `${'  '.repeat(i)}- l${i + 1}`).join('\n');
// em inside em, n deep.
const marks = (n) => Array.from({ length: n }).reduce((s, _, i) => `*m${n - i} ${s} m${n - i}*`, 'x');

// Blocks down the first block's callout body or first item's nested list: how many, and the deepest.
function chain(blocks) {
  let at = blocks[0];
  let depth = 1;
  for (let next = at.slots?.body?.[0] ?? at.items?.[0]?.children?.[0]; next; next = at.slots?.body?.[0] ?? at.items?.[0]?.children?.[0]) {
    at = next;
    depth++;
  }
  return { depth, deepest: at };
}
// The marks down a paragraph's first node, and the text in the innermost.
function markChain(content) {
  let depth = 0;
  let at = { children: content };
  while (at.children?.some((n) => n.type === 'em')) {
    at = at.children.find((n) => n.type === 'em');
    depth++;
  }
  return { depth, text: at.children.map((n) => n.value).join('') };
}
const read = (md) => {
  const out = underBudget(500, () => readMarkdown(md));
  assert.deepEqual(validate({ blocks: out.blocks }), { ok: true });
  return out;
};

test('100 nested [!note] quotes and a list indented 100 deep, written by hand, import 100 deep with no notice', () => {
  assert.equal(MAX_DEPTH, 100);
  const q = read(quotes(MAX_DEPTH));
  assert.deepEqual(q.notices, []);
  const { depth, deepest } = chain(q.blocks);
  assert.deepEqual([depth, deepest.type, deepest.content, deepest.slots], [MAX_DEPTH, 'callout', [t(`c${MAX_DEPTH}`)], undefined]);
  const l = read(list(MAX_DEPTH));
  assert.deepEqual(l.notices, []);
  assert.deepEqual(chain(l.blocks).depth, MAX_DEPTH);
  assert.deepEqual(chain(l.blocks).deepest.items, [[t(`l${MAX_DEPTH}`)]]);
});

test('101 deep, the words past 100 are kept as text in the 100th block, nothing is refused, and the notice names that block', () => {
  const q = read(quotes(MAX_DEPTH + 1));
  const { depth, deepest } = chain(q.blocks);
  assert.deepEqual([depth, deepest.content, deepest.slots], [MAX_DEPTH, [t('c100 [!note] c101')], undefined]);
  // The 100th callout: its two lines and the 101st's two.
  assert.deepEqual(q.notices, [{ code: NESTING_KEPT_AS_TEXT, path: `/blocks/0${'/slots/body/0'.repeat(MAX_DEPTH - 1)}`, line: 199, lines: 4 }]);
  const l = read(list(MAX_DEPTH + 1));
  assert.deepEqual([chain(l.blocks).depth, chain(l.blocks).deepest.items], [MAX_DEPTH, [[t('l100 l101')]]]);
  assert.deepEqual(l.notices, [{ code: NESTING_KEPT_AS_TEXT, path: `/blocks/0${'/items/0/children/0'.repeat(MAX_DEPTH - 1)}`, line: 100, lines: 2 }]);
});

test('callouts and the lists in their bodies count as one depth: 50 callouts over a list 50 deep import whole, one level more is text', () => {
  const over = (n) => `${quotes(50)}\n${list(n).split('\n').map((line) => `${'> '.repeat(50)}${line}`).join('\n')}`;
  const whole = read(over(50));
  assert.deepEqual([chain(whole.blocks).depth, whole.notices], [MAX_DEPTH, []]);
  const past = read(over(51));
  assert.deepEqual([chain(past.blocks).depth, chain(past.blocks).deepest.items], [MAX_DEPTH, [[t('l50 l51')]]]);
  assert.deepEqual(past.notices.map((n) => [n.code, n.path]), [[NESTING_KEPT_AS_TEXT, `/blocks/0${'/slots/body/0'.repeat(50)}${'/items/0/children/0'.repeat(49)}`]]);
});

test('marks inside marks keep their own limit, 50: 50 deep stay marks, the 51st is text, and the paragraph says so', () => {
  assert.equal(MAX_MARK_NEST, 50);
  const whole = read(marks(MAX_MARK_NEST));
  assert.deepEqual([markChain(whole.blocks[0].content).depth, whole.notices], [MAX_MARK_NEST, []]);
  const past = read(marks(MAX_MARK_NEST + 1));
  assert.deepEqual(markChain(past.blocks[0].content), { depth: MAX_MARK_NEST, text: 'm50 m51 x m51 m50' });
  assert.deepEqual(past.notices, [{ code: NESTING_KEPT_AS_TEXT, path: '/blocks/0', line: 1, lines: 1 }]);
});

// A portabledoc fence holds its blocks as JSON, and the import reads old names under their current
// ones: an inline code node's old `children` becomes its `value`, their flat text (inlineText, the
// text-from-inline convert). The fence is taken when its blocks, counted as a doc object
// ({ blocks }), nest at most MAX_VALUE_DEPTH value levels: doc, blocks, paragraph, content, code,
// children, the deepest em's text leaves, and two for each em. Deeper, it is kept as a code block
// of its JSON.
test('a portabledoc fence with old code children over the deepest em it takes imports with every word in the value; one em more is kept as a code block', () => {
  const ems = (k) => [{ type: 'em', children: Array.from({ length: k - 1 }).reduce((kids, _, i) => [t(`w${k - 1 - i} `), { type: 'em', children: kids }], [t(`w${k}`), t(' end')]) }];
  const blocks = (k) => [{ type: 'paragraph', content: [{ type: 'code', children: ems(k) }] }];
  const fence = (k) => `\`\`\`portabledoc\n${JSON.stringify(blocks(k))}\n\`\`\`\n`;
  const words = (s) => new Set(s.match(/w\d+/g)).size;
  const k = Math.floor((MAX_VALUE_DEPTH - 7) / 2);
  assert.deepEqual([walkDepth({ blocks: blocks(k) }) <= MAX_VALUE_DEPTH, walkDepth({ blocks: blocks(k + 1) }) > MAX_VALUE_DEPTH, validate(blocks(k)).ok], [true, true, true]);
  const taken = readMarkdown(fence(k));
  assert.deepEqual([taken.blocks.length, taken.blocks[0].type, taken.blocks[0].content.length, taken.blocks[0].content[0].type, taken.notices], [1, 'paragraph', 1, 'code', []]);
  assert.equal(words(taken.blocks[0].content[0].value), k, `${k} em: every word in the code's value`);
  const kept = readMarkdown(fence(k + 1));
  assert.deepEqual([kept.blocks.length, kept.blocks[0].type, words(kept.blocks[0].value)], [1, 'code', k + 1], `${k + 1} em: a code block of the JSON, every word`);
});
