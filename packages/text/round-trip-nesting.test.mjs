import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DEPTH, validate } from '@portable-doc/validate';
import { fromMarkdown, toMarkdown, toPlainText } from './index.js';

// A callout is Markdown's quote: `> [!tone]` and its first paragraph are the callout, every block
// after that is its `slots.body`. Round-trip mode writes it so, each block of the body decided as
// it is at the top: itself, a fence, or listed in `lost` under its own path.

const ROUND_TRIP = { mode: 'round-trip' };
const t = (value) => ({ type: 'text', value });
const p = (value) => ({ type: 'paragraph', content: [t(value)] });
const callout = (body, tone = 'info', content = [t('Note')]) => ({ type: 'callout', tone, content, slots: { body } });

// Import: each case is Markdown and the blocks it reads as.
const IMPORT = [
  ['a paragraph after the first is the body', '> [!note] Heads up\n>\n> Second paragraph.', [callout([p('Second paragraph.')], 'info', [t('Heads up')])]],
  ['the first paragraph alone, over two lines, is the content', '> [!note] Heads up\n> same paragraph', [{ type: 'callout', tone: 'info', content: [t('Heads up same paragraph')] }]],
  [
    'a list and a code block are blocks of the body',
    '> [!warning] Mind the gap\n>\n> - one\n> - two\n>\n> ```js\n> x()\n> ```',
    [callout([{ type: 'list', ordered: false, items: [[t('one')], [t('two')]] }, { type: 'code', value: 'x()', lang: 'js' }], 'warning', [t('Mind the gap')])],
  ],
  ['a marker with no text on its line: empty content, then the body', '> [!tip]\n>\n> Only a body.', [callout([p('Only a body.')], 'info', [])]],
  ['a callout in a callout', '> [!info] Outer\n>\n> > [!danger] Inner\n> >\n> > Deep.', [callout([callout([p('Deep.')], 'danger', [t('Inner')])], 'info', [t('Outer')])]],
  [
    'a portabledoc fence in the body is spliced, its ids counted with the fences after it',
    '> [!info] A\n>\n> ```portabledoc\n> [{"type":"divider","id":"d"}]\n> ```\n\n```portabledoc\n[{"type":"divider","id":"d"}]\n```',
    [callout([{ type: 'divider', id: 'd' }], 'info', [t('A')]), { type: 'code', value: '[{"type":"divider","id":"d"}]' }],
  ],
  [
    'a mermaid fence in the body keeps its caption',
    '> [!info] A\n>\n> ```mermaid\n> graph TD; A-->B\n> ```\n>\n> *The flow*',
    [callout([{ type: 'diagram', source: 'graph TD; A-->B', caption: 'The flow' }], 'info', [t('A')])],
  ],
  ['a plain quote holds inline content only: its blocks stay one run of text', '> a\n>\n> - b\n> - c', [{ type: 'blockquote', content: [t('a b c')] }]],
];

test('import reads the blocks after a callout\'s first paragraph into slots.body, and a plain quote as one run of text', () => {
  for (const [name, markdown, blocks] of IMPORT) assert.deepEqual(fromMarkdown(markdown), blocks, name);
});

test('a block in a callout that import cannot bring back is listed under its own path, and the rest of the callout is kept', () => {
  const unsafe = { type: 'paragraph', content: [{ type: 'link', href: 'javascript:alert(1)', children: [t('bad')] }] };
  const image = { type: 'image', src: 'https://example.com/a.png', alt: 'A' };
  const doc = [callout([p('kept'), image, unsafe], 'warning')];
  const { markdown, lost } = toMarkdown(doc, ROUND_TRIP);
  assert.deepEqual(lost, [
    { path: '/blocks/0/slots/body/1', id: null, type: 'image', reason: 'type' },
    { path: '/blocks/0/slots/body/2', id: null, type: 'paragraph', reason: 'address' },
  ]);
  const [back] = fromMarkdown(markdown);
  assert.deepEqual({ ...back, slots: undefined }, { ...doc[0], slots: undefined }, 'the callout itself comes back');
  assert.deepEqual(back.slots.body[0], p('kept'));
  assert.equal(back.slots.body.length, 3, 'each lost block stays a block of its own, never joined into the callout\'s text');
});

test('a fence in a callout that import would keep back for a reused id is lost, in the order import reads fences', () => {
  const heading = (value) => ({ type: 'heading', level: 1, content: [t(value)], id: 'x' });
  const nestedFirst = toMarkdown([callout([heading('a')]), heading('b')], ROUND_TRIP);
  assert.deepEqual(nestedFirst.lost, [{ path: '/blocks/1', id: 'x', type: 'heading', reason: 'id' }]);
  const topFirst = toMarkdown([heading('a'), callout([heading('b')])], ROUND_TRIP);
  assert.deepEqual(topFirst.lost, [{ path: '/blocks/1/slots/body/0', id: 'x', type: 'heading', reason: 'id' }]);
});

test('round-trip mode fences a block in a callout that its neighbour there would change', () => {
  const pair = [{ type: 'diagram', source: 'graph TD; A-->B' }, { type: 'paragraph', content: [{ type: 'em', children: [t('Not a caption')] }] }];
  const doc = [callout(pair)];
  const { markdown, lost } = toMarkdown(doc, ROUND_TRIP);
  assert.deepEqual([lost, fromMarkdown(markdown)], [[], doc]);
  assert.match(markdown, /^> ```portabledoc\n> \[\{"type":"paragraph"/m);
});

test('a callout its own line cannot hold (a title, an unknown tone, no content) is kept by a fence of the whole', () => {
  for (const block of [{ ...callout([p('b')]), title: 'T' }, callout([p('b')], 'loss'), { type: 'callout', tone: 'info', slots: { body: [p('b')] } }]) {
    const { markdown, lost } = toMarkdown([block], ROUND_TRIP);
    assert.deepEqual(lost, []);
    assert.equal(markdown, toMarkdown([{ type: 'code', lang: 'portabledoc', value: JSON.stringify([block]) }]));
  }
});

test('a callout round-trip mode cannot keep is written as the readable writer writes it, at the top and in a body', () => {
  const image = { type: 'image', src: 'https://example.com/a.png' };
  for (const block of [{ ...callout([image]), title: 'T' }, callout([image], 'loss')]) {
    const { markdown, lost } = toMarkdown([block], ROUND_TRIP);
    assert.deepEqual(lost, [{ path: '/blocks/0', id: null, type: 'callout', reason: 'type' }]);
    assert.equal(markdown, toMarkdown([block]));
  }
  const inner = callout([image], 'loss', [t('In')]);
  const { markdown, lost } = toMarkdown([callout([inner])], ROUND_TRIP);
  assert.deepEqual(lost, [{ path: '/blocks/0/slots/body/0', id: null, type: 'callout', reason: 'type' }]);
  assert.equal(markdown, `> [!info] Note\n>\n${toMarkdown([inner]).trimEnd().split('\n').map((l) => `> ${l}`).join('\n')}\n`);
});

test('callouts in callouts are kept in their own Markdown as deep as validate allows; one more callout is past MAX_DEPTH', () => {
  const nested = (n, leaf) => {
    let block = leaf;
    for (let i = 0; i < n; i++) block = callout([block]);
    return block;
  };
  // The deepest a valid doc goes: MAX_DEPTH - 1 callouts, a paragraph in the deepest body.
  const deepest = nested(MAX_DEPTH - 1, p('deep'));
  const kept = toMarkdown([deepest], ROUND_TRIP);
  assert.deepEqual([kept.lost, fromMarkdown(kept.markdown)], [[], [deepest]]);
  assert.doesNotMatch(kept.markdown, /portabledoc/);
  // An image at the bottom: listed at its own path, MAX_DEPTH - 1 bodies down.
  const image = toMarkdown([nested(MAX_DEPTH - 1, { type: 'image', src: 'https://example.com/a.png' })], ROUND_TRIP);
  assert.deepEqual(image.lost.map((l) => [l.path, l.reason]), [[`/blocks/0${'/slots/body/0'.repeat(MAX_DEPTH - 1)}`, 'type']]);
  // One callout more is a doc validate refuses: no valid doc nests past what import reads.
  assert.deepEqual(validate([nested(MAX_DEPTH, p('deep'))]).errors.map((e) => e.code), ['too_deep']);
});

test('readable mode writes a callout\'s content, then its body: a two-paragraph callout imported from Markdown keeps every word', () => {
  const md = '> [!warning] Mind the gap\n>\n> Second paragraph, with more words.';
  const blocks = fromMarkdown(md);
  assert.deepEqual(blocks, [callout([p('Second paragraph, with more words.')], 'warning', [t('Mind the gap')])]);
  const words = md.match(/\w+/g).filter((w) => w !== 'warning'); // the tone is written as its label, Warning
  for (const out of [toMarkdown(blocks), toPlainText(blocks)]) assert.deepEqual(words.filter((w) => !out.includes(w)), [], out);
  assert.equal(toMarkdown(blocks), '> **Warning:** Mind the gap\n>\n> Second paragraph, with more words.\n');
  assert.equal(toMarkdown(blocks, { mode: 'readable' }), toMarkdown(blocks));
  assert.equal(toPlainText(blocks), 'Warning: Mind the gap\n\nSecond paragraph, with more words.\n');
  // A callout with only content, or only a body, is written as before.
  assert.equal(toMarkdown([{ type: 'callout', tone: 'warning', content: [t('Mind it')] }]), '> **Warning:** Mind it\n');
  assert.equal(toMarkdown([callout([p('Body.')], 'warning', [])]), '> **Warning:** Body.\n');
});
