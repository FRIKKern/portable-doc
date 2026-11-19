import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { MAX_VALUE_DEPTH, blockSchema, validate } from '@portable-doc/validate';
import { READ_ALIASES, canon } from './golden-reads.mjs';
import { fromMarkdown, toMarkdown, toPlainText } from './index.js';
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
    { type: 'heading', level: 2, content: [t('Title')] },
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

test('a heading keeps its marks and links as inline content, the way a paragraph does, and no block import builds itself uses an old name', () => {
  const md = '# Hello **world** and [a link](https://example.com)';
  const content = [t('Hello '), { type: 'strong', children: [t('world')] }, t(' and '), { type: 'link', href: 'https://example.com', children: [t('a link')] }];
  assert.deepEqual(fromMarkdown(md), [{ type: 'heading', level: 1, content }]);
  assert.deepEqual(fromMarkdown(md.slice(2))[0].content, content, 'the same inline content as a paragraph');
  assert.equal(toMarkdown(fromMarkdown(md)), `${md}\n`, 'and it writes back as it was');
  // A heading import leaves with no text is still dropped.
  assert.deepEqual(fromMarkdown('# ![](javascript:x)\n\n## `` ``'), []);
  // Import writes no block key under an old name (READ_ALIASES) in any block it builds itself. A
  // portabledoc fence is spliced in as written, so a fenced heading keeps its `text`: putting
  // fenced blocks under canonical names is the alias file's follow-up, and the check skips them.
  const fenced = { type: 'heading', level: 2, text: 'Fenced' };
  const every = [
    '# h', 'p **b**', '- a\n  - b', '1. a', '- [x] t', '```js\nx\n```', '```mermaid\ngraph TD\n```\n\n*cap*', '    indented',
    '| a |\n| - |\n| 1 |', '> q\n>\n> — Who', '> [!warning] c', '---', '<div>html</div>',
    `\`\`\`portabledoc\n${JSON.stringify([fenced])}\n\`\`\``,
  ].join('\n\n');
  const read = fromMarkdown(every);
  assert.deepEqual(read.at(-1), fenced, 'the fenced heading comes in as written, old name and all');
  const stack = read.slice(0, -1);
  const types = new Set();
  while (stack.length) {
    const v = stack.pop();
    if (Array.isArray(v)) stack.push(...v);
    else if (v && typeof v === 'object') {
      if (typeof v.type === 'string') types.add(v.type);
      for (const key of Object.keys(v)) assert.ok(!Object.hasOwn(READ_ALIASES, `${v.type}.${key}`), `import writes ${v.type}.${key}, an old name`);
      stack.push(...Object.values(v));
    }
  }
  for (const type of ['heading', 'paragraph', 'list', 'code', 'diagram', 'table', 'blockquote', 'callout', 'divider']) assert.ok(types.has(type), `the sample makes a ${type}`);
});

test('fromMarkdown follows Barkpark FromMarkdown on its own examples', () => {
  const list = (items, extra) => ({ type: 'list', ordered: true, items: items.map((v) => [t(v)]), ...extra });
  const cases = [
    ['#### Four\n\n##### Five\n\n###### Six', [4, 5, 6].map((level, i) => ({ type: 'heading', level, content: [t(['Four', 'Five', 'Six'][i])] }))],
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
  // The space before the script stays, as in a paragraph; written back, the heading is "# Title".
  assert.deepEqual(fromMarkdown('# Title <script>bad()</script>'), [{ type: 'heading', level: 1, content: [t('Title ')] }]);
  assert.deepEqual(fromMarkdown('a <script/> b'), [{ type: 'paragraph', content: [t('a  b')] }]);
});

test('a portabledoc fence whose deepest container sits at doc level MAX_VALUE_DEPTH is spliced in, whatever it holds; one level more, or 8,000, stays a code block', () => {
  // In { blocks: [chart] }: the doc 1, blocks 2, chart 3, series 4, item 5, x 6.
  // The deepest container, at level n, holds a number or a string, or is an object.
  const inner = { number: '[1]', string: '["s"]', object: '{"k":"v"}' };
  const md = (n, holds) => '```portabledoc\n[{"type":"chart","series":[{"x":' + '['.repeat(n - 6) + inner[holds] + ']'.repeat(n - 6) + '}]}]\n```';
  for (const holds of Object.keys(inner)) {
    const atLimit = fromMarkdown(md(MAX_VALUE_DEPTH, holds));
    assert.equal(atLimit[0].type, 'chart', holds);
    assert.deepEqual(validate({ blocks: atLimit }), { ok: true }, holds);
    for (const n of [MAX_VALUE_DEPTH + 1, 8000]) {
      const out = fromMarkdown(md(n, holds));
      assert.deepEqual(out.map((b) => b.type), ['code'], `${holds} ${n}`);
      assert.doesNotThrow(() => JSON.stringify(out));
    }
  }
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

test('a portabledoc fence with an unsafe value in any address field stays a code block, whole', () => {
  const t = (value) => ({ type: 'text', value });
  const bad = 'javascript:alert(1)';
  const fences = [
    [{ type: 'paragraph', content: [t('a')], src: bad }],
    [{ type: 'paragraph', content: [t('a'), { type: 'image', src: bad }] }],
    [{ type: 'callout', tone: 'info', slots: { body: [{ type: 'paragraph', content: [t('a')], poster: bad }] } }],
    [{ type: 'heading', level: 2, text: 'a', url: ' data:text/html,x' }],
    [{ type: 'paragraph', content: [{ type: 'text', value: 'a', marks: [{ type: 'link', href: bad }] }] }],
  ];
  for (const blocks of fences) assert.deepEqual(fromMarkdown(fenceOf(blocks)), [{ type: 'code', value: JSON.stringify(blocks) }], JSON.stringify(blocks));
  const safe = [{ type: 'paragraph', content: [t('a'), { type: 'image', src: 'https://example.com/a.png' }], poster: '/a.png' }];
  assert.deepEqual(fromMarkdown(fenceOf(safe)), safe);
});

test('a Markdown image or link with an unsafe address keeps its text and loses the address; a safe one links', () => {
  const para = (content) => [{ type: 'paragraph', content }];
  assert.deepEqual(fromMarkdown('![d](javascript:alert(1))'), para([{ type: 'text', value: 'd' }]));
  assert.deepEqual(fromMarkdown('[e](javascript:alert(1))'), para([{ type: 'text', value: 'e' }]));
  assert.deepEqual(fromMarkdown('![d](https://example.com/a.png)'), para([{ type: 'link', href: 'https://example.com/a.png', children: [{ type: 'text', value: 'd' }] }]));
});

test('a Markdown image with an unsafe address and no alt text leaves no text: the address never shows', () => {
  for (const md of ['![](javascript:alert(1))', 'a ![](javascript:alert(1)) b', '![](data:text/html,x)']) {
    const blocks = fromMarkdown(md);
    valid(blocks);
    assert.doesNotMatch(JSON.stringify(blocks), /javascript:|data:/, md);
  }
  assert.deepEqual(fromMarkdown('![](javascript:alert(1))'), []);
  assert.deepEqual(fromMarkdown('a ![](javascript:alert(1)) b'), [{ type: 'paragraph', content: [{ type: 'text', value: 'a  b' }] }]);
  assert.deepEqual(fromMarkdown('![](https://example.com/a.png)'), [{ type: 'paragraph', content: [{ type: 'link', href: 'https://example.com/a.png', children: [{ type: 'text', value: 'https://example.com/a.png' }] }] }]);
});

test('a heading, paragraph, list item or quote that import leaves with no text is dropped, never kept empty; a list with no items left goes too', () => {
  const t = (value) => ({ type: 'text', value });
  const cases = [
    ['# ![](javascript:x)', []],
    ['# <script>x</script>', []],
    ['# &nbsp;', []],
    ['&nbsp;', []],
    ['` `', []],
    ['[ ](https://x.example)', []],
    ['> ![](javascript:x)', []],
    ['- ![](javascript:x)', []],
    ['- [ ] ![](javascript:x)', []],
    ['1. ![](javascript:x)\n   - ![](javascript:x)', []],
    ['- ![](javascript:x)\n- b', [{ type: 'list', ordered: false, items: [[t('b')]] }]],
    ['- [x] ![](javascript:x)\n- b', [{ type: 'list', ordered: false, items: [[t('b')]] }]],
    // An item with no text but a nested list keeps its place, as the list's parent.
    ['- ![](javascript:x)\n  - a', [{ type: 'list', ordered: false, items: [{ content: [], children: [{ type: 'list', ordered: false, items: [[t('a')]] }] }] }]],
    // A table cell is not a block: it stays, empty.
    ['| a |\n|---|\n| ![](javascript:x) |', [{ type: 'table', head: [[t('a')]], rows: [[[]]] }]],
    ['# a\n\n![](javascript:x)\n\nb', [{ type: 'heading', level: 1, content: [t('a')] }, { type: 'paragraph', content: [t('b')] }]],
  ];
  for (const [md, blocks] of cases) {
    const got = fromMarkdown(md);
    assert.deepEqual(got, blocks, md);
    // "No text" is toMarkdown's measure: every block kept writes something back.
    for (const b of got) assert.notEqual(toMarkdown([b]).trim(), '', `${md}: ${JSON.stringify(b)}`);
  }
});

test('an empty code block is a real block: toMarkdown writes its empty fence, with its language, and import gives the same block back', () => {
  for (const md of ['```\n```', '```js\n```', '````\n````', '```\n   \n```']) {
    const blocks = fromMarkdown(md);
    assert.equal(blocks.length, 1, md);
    assert.equal(blocks[0].type, 'code', md);
    assert.deepEqual(fromMarkdown(toMarkdown(blocks)), blocks, md);
  }
  for (const md of ['```mermaid\n```', '```mermaid\n```\n\n*A caption*']) {
    const blocks = fromMarkdown(md);
    assert.equal(blocks[0].type, 'diagram', md);
    assert.deepEqual(fromMarkdown(toMarkdown(blocks)), blocks, md);
  }
  assert.equal(toMarkdown([{ type: 'code', value: '   ' }]), '```\n   \n```\n', 'whitespace kept in the current name');
  // Every name blank: the first name present is read as stored, so whitespace under an old name is kept too.
  assert.equal(toMarkdown([{ type: 'code', code: '   ' }]), '```\n   \n```\n');
  assert.equal(toMarkdown([{ type: 'code', value: '', lang: 'py' }]).trim(), '```py\n```');
  assert.equal(toPlainText([{ type: 'code', value: '' }]).trim(), '');
});
