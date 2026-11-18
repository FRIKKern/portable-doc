import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { blockSchema, validate } from '@portable-doc/validate';
import { fromMarkdown, toMarkdown } from './index.js';
import { safeUrl } from './util.js';

const golden = (type) => JSON.parse(fs.readFileSync(new URL(`../../goldens/blocks/${type}.golden.json`, import.meta.url), 'utf8')).input;

const t = (value) => ({ type: 'text', value });
const valid = (blocks) => {
  const r = validate({ blocks });
  assert.ok(r.ok, JSON.stringify(r.errors, null, 1));
};

test('fromMarkdown reads headings, inline marks, links, task lists, tables and mermaid fences, and the result validates', () => {
  const md = [
    '## Title',
    'plain **bold** *it* `code` [go](https://x.example)',
    '- [ ] todo\n- [x] done',
    '| Name | N |\n| ---- | - |\n| a    | 1 |',
    '```mermaid\ngraph TD\n  A-->B\n```',
  ].join('\n\n');
  const blocks = fromMarkdown(md);
  assert.deepEqual(blocks, [
    { type: 'heading', level: 2, text: 'Title' },
    {
      type: 'paragraph',
      content: [
        t('plain '),
        { type: 'strong', children: [t('bold')] },
        t(' '),
        { type: 'em', children: [t('it')] },
        t(' '),
        { type: 'code', value: 'code' },
        t(' '),
        { type: 'link', href: 'https://x.example', children: [t('go')] },
      ],
    },
    { type: 'list', ordered: false, task: true, items: [{ content: [t('todo')], checked: false }, { content: [t('done')], checked: true }] },
    { type: 'table', head: [[t('Name')], [t('N')]], rows: [[[t('a')], [t('1')]]] },
    { type: 'diagram', source: 'graph TD\n  A-->B' },
  ]);
  valid(blocks);
});

test('fromMarkdown follows Barkpark FromMarkdown on its own examples', () => {
  const list = (items, extra) => ({ type: 'list', ordered: true, items: items.map((v) => [t(v)]), ...extra });
  const cases = [
    ['#### Four\n\n##### Five\n\n###### Six', [4, 5, 6].map((level, i) => ({ type: 'heading', level, text: ['Four', 'Five', 'Six'][i] }))],
    [
      '1. first\n2. second\n   - nested\n',
      [{ type: 'list', ordered: true, items: [[t('first')], { content: [t('second')], children: [{ type: 'list', ordered: false, items: [[t('nested')]] }] }] }],
    ],
    ['5. five\n6. six\n', [list(['five', 'six'], { start: 5 })]],
    ['0. zero\n1. one\n', [list(['zero', 'one'], { start: 0 })]],
    ['```python\nprint(1)\n```', [{ type: 'code', value: 'print(1)', lang: 'python' }]],
    ['~~~js\nlet a = 1\n~~~', [{ type: 'code', value: 'let a = 1', lang: 'js' }]],
    ['```\nplain\n```', [{ type: 'code', value: 'plain' }]],
    ['    plain\n', [{ type: 'code', value: 'plain' }]],
    ['> heads up', [{ type: 'blockquote', content: [t('heads up')] }]],
    ['> [!warn] mind the gap', [{ type: 'callout', tone: 'warning', content: [t('mind the gap')] }]],
    ['> [!note] a note', [{ type: 'callout', tone: 'info', content: [t('a note')] }]],
    ['> [!success]- folded', [{ type: 'callout', tone: 'success', content: [t('folded')] }]],
    ['---', [{ type: 'divider' }]],
    ['```portabledoc\n[{"type":"callout","tone":"success","content":[{"type":"text","value":"ok"}]},{"type":"divider"}]\n```', [{ type: 'callout', tone: 'success', content: [t('ok')] }, { type: 'divider' }]],
    ['```portabledoc\n[{oops\n```', [{ type: 'code', value: '[{oops' }]],
    ['```portabledoc\n[{"type":"field-string","label":"x","value":"y"}]\n```', [{ type: 'code', value: '[{"type":"field-string","label":"x","value":"y"}]' }]],
    ['```portabledoc\n{"type":"divider"}\n```', [{ type: 'code', value: '{"type":"divider"}' }]],
  ];
  for (const [md, expected] of cases) {
    const blocks = fromMarkdown(md);
    assert.deepEqual(blocks, expected, md);
    valid(blocks);
  }
});

// Equivalent: the same blocks once ids are dropped and inline content is
// compared as its text runs, each with its set of marks. A mark is a mark
// whether written as a node (`{ type: 'strong', children }`, a link node) or
// on a text leaf (`marks: [{ type: 'bold' }]`, a link mark), and neighbouring
// runs with the same marks are one run.
const MARK = { strong: 'strong', bold: 'strong', em: 'em', italic: 'em', strikethrough: 'strike', strike: 'strike', s: 'strike' };
const INLINE = new Set(['text', 'link', 'code', ...Object.keys(MARK)]);
function runs(nodes, marks = [], out = []) {
  for (const n of nodes) {
    const own = (n.marks ?? []).map((m) => (m.type === 'link' ? `link:${m.href}` : MARK[m.type] ?? m.type));
    if (n.type === 'text') out.push({ text: n.value ?? n.text, marks: [...marks, ...own] });
    else if (n.type === 'code') out.push({ text: n.value, marks: [...marks, 'code'] });
    else runs(n.children, [...marks, n.type === 'link' ? `link:${n.href}` : MARK[n.type]], out);
  }
  return out.reduce((acc, r) => {
    const key = [...new Set(r.marks)].sort().join(' ');
    if (acc.at(-1)?.marks === key) acc.at(-1).text += r.text;
    else acc.push({ text: r.text, marks: key });
    return acc;
  }, []);
}
const isInline = (v) => Array.isArray(v) && v.length > 0 && v.every((n) => n && INLINE.has(n.type));
function canon(v) {
  if (isInline(v)) return runs(v);
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'id').map(([k, x]) => [k, canon(x)]));
  return v;
}

// Each core type has a Markdown form that toMarkdown writes and fromMarkdown reads back.
const ROUND_TRIP = ['heading', 'paragraph', 'list', 'code', 'table', 'blockquote', 'divider', 'diagram'];
// These have no Markdown form of their own; they travel in a portabledoc fence.
const FENCE_ONLY = ['callout', 'chart', 'stat', 'stats', 'heatmap', 'pullquote', 'eyebrow'];

test('a nested list reads back as a list in its item, not as text: fromMarkdown(toMarkdown(doc)) keeps the tree', () => {
  const doc = [
    {
      type: 'list',
      ordered: false,
      items: [
        { content: [t('a')], children: [{ type: 'list', ordered: true, items: [[t('b')], { content: [t('c')], children: [{ type: 'list', ordered: false, items: [[t('d')]] }] }] }] },
        [t('e')],
      ],
    },
    { type: 'list', ordered: false, task: true, items: [{ content: [t('todo')], checked: false, children: [{ type: 'list', ordered: false, items: [[t('sub')]] }] }] },
  ];
  const back = fromMarkdown(toMarkdown(doc));
  assert.deepEqual(back, doc);
  valid(back);
});

test('inline <script> and <style> keep no text, in a paragraph or a heading', () => {
  assert.deepEqual(fromMarkdown('<b>hi</b> <script>bad()</script>there <style>p{}</style>end'), [{ type: 'paragraph', content: [t('hi there end')] }]);
  assert.deepEqual(fromMarkdown('# Title <script>bad()</script>'), [{ type: 'heading', level: 1, text: 'Title' }]);
  assert.deepEqual(fromMarkdown('a <script/> b'), [{ type: 'paragraph', content: [t('a  b')] }]);
});

test('a portabledoc fence nested deeper than 100 levels stays a code block, so the doc can be written as JSON', () => {
  const deep = (n) => '['.repeat(n) + ']'.repeat(n);
  const md = (n) => '```portabledoc\n[{"type":"chart","series":[{"x":' + deep(n) + '}]}]\n```';
  const out = fromMarkdown(md(8000));
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'code');
  assert.doesNotThrow(() => JSON.stringify(out));
  assert.equal(fromMarkdown(md(20))[0].type, 'chart');
});

test('round trip: every core golden survives toMarkdown then fromMarkdown, and fence types survive the portabledoc fence', () => {
  for (const type of ROUND_TRIP) {
    const doc = [golden(type)];
    const back = fromMarkdown(toMarkdown(doc));
    assert.deepEqual(back.map(canon), doc.map(canon), type);
    valid(back);
  }
  for (const type of FENCE_ONLY) {
    const doc = [golden(type)];
    assert.deepEqual(fromMarkdown(`\`\`\`portabledoc\n${JSON.stringify(doc)}\n\`\`\``), doc, type);
  }
  // Anything else in a fence is kept as the fence's text.
  const image = JSON.stringify([golden('image')]);
  assert.deepEqual(fromMarkdown(`\`\`\`portabledoc\n${image}\n\`\`\``), [{ type: 'code', value: image }]);
});

/** Every link and href in a doc, anywhere. */
function hrefs(v, out = []) {
  if (Array.isArray(v)) for (const x of v) hrefs(x, out);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) k === 'href' ? out.push(x) : hrefs(x, out);
  return out;
}

test('hostile Markdown never throws, and what it gives validates and links only to safe URLs', () => {
  const fenced = (json) => `\`\`\`portabledoc\n${json}\n\`\`\``;
  const inputs = [
    '>'.repeat(5000) + ' deep',
    Array.from({ length: 300 }, (_, i) => `${' '.repeat(i * 2)}- level ${i}`).join('\n'),
    '*a **b *c **d '.repeat(5000),
    '['.repeat(20000) + 'x' + ']'.repeat(20000) + '(https://a.example)',
    '<div>'.repeat(10000) + '<script>alert(1)</script><img src=x onerror=alert(1)>',
    '`'.repeat(50000),
    ('## Head\n\nSome **bold**, *em*, [a link](https://example.com) and `code`.\n\n- one\n- two\n\n> quote\n\n').repeat(3000),
    '[a](javascript:alert(1)) [b](JaVaScRiPt:alert(1)) [c]( \tjavascript:x) ![d](javascript:x) <javascript:alert(1)> [e](//evil.example) [f](data:text/html,x)',
    fenced('[{oops'),
    fenced('[]'),
    fenced(JSON.stringify(Array.from({ length: 51 }, () => ({ type: 'divider' })))),
    fenced('[{"type":"heading","level":9,"text":"x"}]'),
    fenced('[{"type":"paragraph","content":[{"type":"link","href":"javascript:alert(1)","children":[]}]}]'),
    `${fenced('[{"type":"divider","id":"a"}]')}\n\n${fenced('[{"type":"divider","id":"a"}]')}`,
    '\u0000\u001b[31m\ud800 \r\n\r\n|a|\n|-|\n|b|',
  ];
  for (const md of inputs) {
    const blocks = fromMarkdown(md);
    valid(blocks);
    for (const href of hrefs(blocks)) assert.equal(safeUrl(href), href, `unsafe href ${href}`);
    assert.ok(!JSON.stringify(blocks).includes('<script'), md.slice(0, 40));
  }
  // The second fence reuses an id, so it stays as text.
  assert.deepEqual(fromMarkdown(inputs.at(-2)).map((b) => b.type), ['divider', 'code']);
  for (const odd of [undefined, null, 42, {}, []]) assert.deepEqual(fromMarkdown(odd), []);
});

const fenceOf = (blocks) => `\`\`\`portabledoc\n${JSON.stringify(blocks)}\n\`\`\``;
const field = { type: 'field-string', label: 'x', value: 'y' };
const FENCE_TYPES = [...ROUND_TRIP.filter((type) => type !== 'blockquote'), ...FENCE_ONLY];

test('a field-string in a list item\'s children keeps the fence as code', () => {
  const md = fenceOf([{ type: 'list', ordered: false, items: [{ content: [t('a')], children: [field] }] }]);
  assert.equal(validate([{ type: 'list', ordered: false, items: [{ content: [t('a')], children: [field] }] }]).ok, true);
  assert.deepEqual(fromMarkdown(md), [{ type: 'code', value: md.split('\n')[1] }]);
});

test('a field-string in a callout\'s slots.body keeps the fence as code', () => {
  const blocks = [{ type: 'callout', tone: 'info', content: [t('a')], slots: { body: [{ type: 'paragraph', text: 'ok' }, field] } }];
  assert.equal(validate(blocks).ok, true);
  assert.deepEqual(fromMarkdown(fenceOf(blocks)), [{ type: 'code', value: JSON.stringify(blocks) }]);
});

test('every allowed block type still splices in when nested in a list item or a callout body', () => {
  const all = FENCE_TYPES.map(golden);
  const blocks = [
    { type: 'callout', tone: 'info', content: [t('a')], slots: { body: all } },
    { type: 'list', ordered: false, items: [{ content: [t('b')], children: all }] },
  ];
  valid(blocks);
  assert.deepEqual(fromMarkdown(fenceOf(blocks)), blocks);
});

test('the exported schema is frozen: a mutation throws and leaves validate and the fence guard as they were', () => {
  assert.ok(Object.isFrozen(blockSchema) && Object.isFrozen(blockSchema.allOf) && Object.isFrozen(blockSchema.definitions.blocks.heading.properties.level));
  const attempts = [
    () => { blockSchema.definitions.blocks.heading.properties.level = { type: 'integer' }; },
    () => { blockSchema.allOf.length = 0; },
    () => { blockSchema.allOf[0].then.$ref = '#'; },
  ];
  for (const attempt of attempts) assert.throws(attempt, TypeError);
  assert.equal(validate([{ type: 'heading', level: 9, text: 'x' }]).ok, false);
  const list = [{ type: 'list', ordered: false, items: [{ content: [t('a')], children: [field] }] }];
  assert.deepEqual(fromMarkdown(fenceOf(list)), [{ type: 'code', value: JSON.stringify(list) }]);
});
