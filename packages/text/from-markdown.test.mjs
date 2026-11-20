import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { MAX_DEPTH, MAX_VALUE_DEPTH, blockSchema, validate, walkDepth } from '@portable-doc/validate';
import { CASES as LIST_SPLIT } from '../../fixtures/list-split/cases.mjs';
import { currentNames } from './current-names.js';
import { MAX_NEST } from './from-markdown-inline.js';
import { readPlan } from './from-markdown.js';
import { READ_ALIASES, canon } from './golden-reads.mjs';
import { planText } from './import-work.js';
import { IMPORT_FELL_BACK, IMPORT_WORK, LIST_ITEM_SPLIT, OLD_NAME_DROPPED, fromMarkdown, readMarkdown, toMarkdown, toPlainText } from './index.js';
import { safeUrl } from './util.js';

const here = fileURLToPath(new URL('.', import.meta.url));
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
  // Import writes no block key under an old name (READ_ALIASES) in any block: those it builds
  // itself, and a portabledoc fence's, whose old names import under their current names.
  const fenced = { type: 'heading', level: 2, text: 'Fenced' };
  const every = [
    '# h', 'p **b**', '- a\n  - b', '1. a', '- [x] t', '```js\nx\n```', '```mermaid\ngraph TD\n```\n\n*cap*', '    indented',
    '| a |\n| - |\n| 1 |', '> q\n>\n> — Who', '> [!warning] c', '---', '<div>html</div>',
    `\`\`\`portabledoc\n${JSON.stringify([fenced])}\n\`\`\``,
  ].join('\n\n');
  const read = fromMarkdown(every);
  assert.deepEqual(read.at(-1), { type: 'heading', level: 2, content: [t('Fenced')] }, 'the fenced heading comes in under its current name');
  const stack = [...read];
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

test('a portabledoc fence imports its old names under their current names, by the rule every reader uses; each value it loses is a notice', () => {
  const code = (v) => ({ type: 'code', value: v });
  // [stored, imported, the names dropped as { path, name, current }]. The current name wins when it
  // holds a value; of two old names, the table's first. A table's `cols` and `header: true` stay.
  // A blank or empty value holds nothing, so dropping it is no notice. Data under a key no reader
  // reads as blocks (`meta`) is kept as written.
  const cases = [
    [{ type: 'code', code: 'a' }, code('a'), []],
    [{ type: 'code', code: 'a', value: 'b' }, code('b'), [['/blocks/0/code', 'code', 'value']]],
    [{ type: 'code', code: 'a', text: 'b' }, code('a'), [['/blocks/0/text', 'text', 'value']]],
    [{ type: 'code', value: ' ', code: 'a' }, code('a'), []],
    [{ type: 'heading', level: 2, text: 'H', content: [] }, { type: 'heading', level: 2, content: [t('H')] }, []],
    [{ type: 'paragraph', content: [t('p')], meta: { type: 'heading', text: 'k' } }, { type: 'paragraph', content: [t('p')], meta: { type: 'heading', text: 'k' } }, []],
    [{ type: 'paragraph', content: [t('p')], meta: [{ type: 'code', code: 'a', value: 'b' }] }, { type: 'paragraph', content: [t('p')], meta: [{ type: 'code', code: 'a', value: 'b' }] }, []],
    [{ type: 'code', code: 'a', value: 'a', lang: 'js' }, { ...code('a'), lang: 'js' }, []],
    [{ type: 'paragraph', text: 'hi' }, { type: 'paragraph', content: [t('hi')] }, []],
    [{ id: 'h1', type: 'heading', level: 2, text: 'H', content: [t('C')] }, { id: 'h1', type: 'heading', level: 2, content: [t('C')] }, [['/blocks/0/text', 'text', 'content']]],
    [{ type: 'paragraph', content: [{ type: 'text', text: 'leaf' }, { type: 'code', children: [t('x')] }] }, { type: 'paragraph', content: [t('leaf'), code('x')] }, []],
    [{ type: 'list', ordered: false, items: [{ text: 'one' }] }, { type: 'list', ordered: false, items: [{ content: [t('one')] }] }, []],
    [{ type: 'table', header: ['A'], rows: [['1']] }, { type: 'table', head: ['A'], rows: [['1']] }, []],
    [{ type: 'table', header: true, rows: [['A'], ['1']] }, { type: 'table', header: true, rows: [['A'], ['1']] }, []],
    [{ type: 'table', cols: [{ key: 'a', type: 'delta' }], columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }] }, { type: 'table', cols: [{ key: 'a', type: 'delta' }], columns: [{ key: 'a', text: 'A' }], rows: [{ a: 1 }] }, []],
    [
      { type: 'callout', tone: 'info', text: 'hi', slots: { body: [{ type: 'paragraph', text: 'x', content: [t('y')] }] } },
      { type: 'callout', tone: 'info', content: [t('hi')], slots: { body: [{ type: 'paragraph', content: [t('y')] }] } },
      [['/blocks/0/slots/body/0/text', 'text', 'content']],
    ],
    [
      { type: 'callout', tone: 'info', content: [t('c')], slots: { body: [{ type: 'code', code: 'a', lang: 'js' }] } },
      { type: 'callout', tone: 'info', content: [t('c')], slots: { body: [{ type: 'code', value: 'a', lang: 'js' }] } },
      [],
    ],
  ];
  for (const [stored, imported, dropped] of cases) {
    const label = JSON.stringify(stored);
    valid([stored]);
    const read = readMarkdown(`\`\`\`portabledoc\n${JSON.stringify([stored])}\n\`\`\``);
    assert.deepEqual(read.blocks, [imported], label);
    valid(read.blocks);
    // Block by block: canon reads a list of only code blocks as inline content, by their text alone.
    assert.deepEqual(canon(read.blocks[0]), canon(stored), `${label}: the same doc as canon reads it`);
    assert.equal(toPlainText(read.blocks), toPlainText([stored]), `${label}: the same text`);
    const want = dropped.map(([path, name, current]) => ({ code: OLD_NAME_DROPPED, path, line: 1, lines: 3, name, current, fix: `write ${current}` }));
    assert.deepEqual(read.notices, want, label);
  }
  // The notice's path is the block's place in the doc, and its lines the fence's.
  const later = readMarkdown(`Intro\n\n\`\`\`portabledoc\n[{"type":"divider"},\n${JSON.stringify({ type: 'code', code: 'a', value: 'b' })}]\n\`\`\``);
  assert.deepEqual(later.notices, [{ code: OLD_NAME_DROPPED, path: '/blocks/2/code', line: 3, lines: 4, name: 'code', current: 'value', fix: 'write value' }]);
});

test('a fence folds old names only where readers read blocks: other data is kept as written, however deep, and an old name is folded as deep as blocks nest', () => {
  const fenced = (blocks) => readMarkdown(`Intro\n\n\`\`\`portabledoc\n${JSON.stringify(blocks)}\n\`\`\``);
  // Block-shaped data under `meta`, one level short of the depth limit; its fold would pass it.
  let deep = { type: 'paragraph', text: 'x' };
  for (let i = 0; i < 995; i++) deep = [deep];
  const meta = [{ type: 'paragraph', content: [t('p')], meta: deep }];
  assert.equal(walkDepth({ blocks: meta }), MAX_VALUE_DEPTH - 1);
  const kept = fenced(meta);
  assert.deepEqual([kept.blocks, kept.notices], [[{ type: 'paragraph', content: [t('Intro')] }, ...meta], []]);
  // A paragraph under its old name in the deepest list a fence may hold (blocks nest at most
  // MAX_DEPTH deep): far above MAX_VALUE_DEPTH, so it folds, and nothing else changes.
  let stored = { type: 'paragraph', text: 'x' };
  let folded = { type: 'paragraph', content: [t('x')] };
  for (let i = 1; i < MAX_DEPTH; i++) [stored, folded] = [stored, folded].map((b) => ({ type: 'list', items: [{ children: [b] }] }));
  valid([stored]);
  assert.ok(!validate([{ type: 'list', items: [{ children: [stored] }] }]).ok, 'one list more is too deep');
  const read = fenced([stored]);
  assert.deepEqual([read.blocks, read.notices], [[{ type: 'paragraph', content: [t('Intro')] }, folded], []]);
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

/**
 * Markdown with one item, at `depth`, that holds text, then a nested list two deep, then
 * more text; each word a token t0, t1, … in source order, the items above it included.
 */
function textAroundNestedList(depth) {
  const lines = [];
  let n = 0;
  const line = (indent, body) => lines.push(`${'  '.repeat(indent)}${body}`);
  for (let i = 0; i < depth; i++) line(i, `- t${n++}`);
  line(depth, `- t${n++}`);
  line(depth + 1, `- t${n++}`);
  line(depth + 2, `- t${n++}`);
  lines.push('');
  line(depth + 1, `t${n++} after the nested list`);
  return { markdown: lines.join('\n'), tokens: Array.from({ length: n }, (_, i) => `t${i}`) };
}
const tokensOf = (text) => text.match(/\bt\d+\b/g) ?? [];

test('a list item\'s text after its nested list stays after it, in source order, at every depth, and the round trip keeps the order', () => {
  // Below MAX_NEST the text splits off as the next item, with a notice; at MAX_NEST and past it
  // the item's nested list is its text, and the text after it follows in place.
  for (const depth of [0, 2, MAX_NEST - 1, MAX_NEST, MAX_NEST + 1]) {
    const { markdown, tokens } = textAroundNestedList(depth);
    const { blocks, notices } = readMarkdown(markdown);
    valid(blocks);
    assert.deepEqual(tokensOf(toPlainText(blocks)), tokens, `depth ${depth}: the import, as plain text`);
    const split = depth < MAX_NEST ? [{ code: LIST_ITEM_SPLIT, path: `/blocks/0${'/items/0/children/0'.repeat(depth)}/items/1`, line: markdown.split('\n').length, lines: 1 }] : [];
    assert.deepEqual(notices, split, `depth ${depth}: the notices`);
    const written = toMarkdown(blocks);
    assert.deepEqual(tokensOf(written), tokens, `depth ${depth}: the import, written back as Markdown`);
    assert.deepEqual(tokensOf(toPlainText(fromMarkdown(written))), tokens, `depth ${depth}: the round trip`);
  }
});

test('a split list item reads as fixtures/list-split/ pins it, writes back as one list item per split, and the round trip splits nothing more', () => {
  // The blocks and notices of each case are pinned in fixtures/list-split/ (the shared-cases test).
  const written = {
    'list-item-text-after-nested-list': '- w0\n  - w1\n    - w2\n- w3 after the nested list\n',
    'list-item-text-around-nested-list': '- a b\n  - c\n- d\n',
    'list-item-text-after-nested-list-numbered': '1. w0\n   1. w1\n      1. w2\n2. w3 after the nested list\n3. w4\n',
    'list-item-text-after-two-nested-lists': '- a\n  - b\n- c more c\n  - d\n- e\n',
    'list-item-split-inside-then-outside-nested-list': '- x\n  - y\n    - z\n  - z2\n- x2\n',
  };
  for (const [name, out] of Object.entries(written)) {
    const read = readMarkdown(LIST_SPLIT[name]);
    assert.ok(read.notices.length, `${name}: no split`);
    assert.equal(toMarkdown(read.blocks), out, name);
    assert.deepEqual(readMarkdown(out), { blocks: read.blocks, notices: [], work: readMarkdown(out).work }, `${name}: the round trip splits nothing more`);
  }
});

test('a split\'s notice names its place in a callout\'s body, and its line in the whole text after a line kept as text', () => {
  const split = (path, line, lines) => ({ code: LIST_ITEM_SPLIT, path, line, lines });
  assert.deepEqual(readMarkdown('> [!info] Note\n>\n> - a\n>   - b\n>\n>   c').notices, [split('/blocks/0/slots/body/0/items/1', 6, 1)]);
  // The long line is read apart, so the list after it is a fresh parse; its lines still count from the text's top.
  const long = 'x'.repeat(50);
  const limits = { ...IMPORT_WORK, lineBytes: 40 };
  const notices = (md) => readMarkdown(md, limits).notices.filter((n) => n.code === LIST_ITEM_SPLIT);
  assert.deepEqual(notices(`${long}\n\n- a\n  - b\n\n  c`), [split('/blocks/1/items/1', 6, 1)]);
  assert.deepEqual(notices(`- p\n\n${long}\n\n- a\n  - b\n\n  c\n\n  more`), [split('/blocks/2/items/1', 8, 3)]);
});

test('a split-off item never opens a task: its `[ ]` or `[x]` stays text, in a checklist or a plain list', () => {
  const t1 = (value) => [{ type: 'text', value }];
  const b = { type: 'list', ordered: false, items: [t1('b')] };
  assert.deepEqual(fromMarkdown('- [ ] a\n  - b\n\n  [ ] c'), [{ type: 'list', ordered: false, task: true, items: [{ content: t1('a'), checked: false, children: [b] }, { content: t1('[ ] c'), checked: false }] }]);
  assert.deepEqual(fromMarkdown('- a\n  - b\n\n  [x] c'), [{ type: 'list', ordered: false, items: [{ content: t1('a'), children: [b] }, t1('[x] c')] }]);
});

test('notices come by kind, not by line: the cut ones (`budget`, `line`), then the splits in source order, then `net`', () => {
  // A split at line 4, a long line at 6, then deep quotes read with a plan whose count is planted short, so the net fires.
  const md = `- a\n  - b\n\n  c\n\n${'x'.repeat(500)}\n\n${'> '.repeat(150)}w0 w1\n${'> '.repeat(150)}w2`;
  const read = readPlan(planText(md, { ...IMPORT_WORK, budget: Infinity, lineBytes: 400 }), { ...IMPORT_WORK, budget: 20_000, lineBytes: 400 });
  assert.deepEqual(read.notices.map((n) => [n.rule ?? n.code, n.line]), [['line', 6], [LIST_ITEM_SPLIT, 4], ['net', 8]]);
});

test('many split-off items, more than a spread of arguments holds on a small stack, still import as one list with a notice each', () => {
  // The shared 120,000-item case's shape: on a 60 kB stack a spread of 20,000 notices overflows,
  // as the full size does on the default stack; the whole text then fell back to one code block.
  const items = 20_000;
  const script = `const { readMarkdown } = await import('./index.js');
const { splitItems } = await import('../../fixtures/text-work/cases.mjs');
const { blocks, notices } = readMarkdown(splitItems(${items}));
console.log(JSON.stringify([blocks.map((b) => b.type), blocks[0].items.length, notices.length]));`;
  const run = spawnSync(process.execPath, ['--stack-size=60', '--input-type=module', '-e', script], { cwd: here, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(run.stdout), [['list'], 2 * items, items], run.stderr);
});

test('a paragraph of more marks than a spread of arguments holds on a small stack still imports as one paragraph', () => {
  // The shared 70,000-mark case's shape: 2n inline nodes in one paragraph. On a 60 kB stack a spread of
  // 40,000 overflows, as the full size does on the default stack; the whole text then fell back to one code block.
  const marks = 20_000;
  const script = `const { readMarkdown } = await import('./index.js');
const { markedParagraph } = await import('../../fixtures/text-work/cases.mjs');
const { blocks, notices } = readMarkdown(markedParagraph(${marks}));
console.log(JSON.stringify([blocks.map((b) => b.type), blocks[1]?.content?.length, blocks[1]?.content?.at(-1), notices.map((n) => n.code)]));`;
  const run = spawnSync(process.execPath, ['--stack-size=60', '--input-type=module', '-e', script], { cwd: here, encoding: 'utf8' });
  const b = { type: 'em', children: [{ type: 'text', value: 'b' }] };
  assert.deepEqual(JSON.parse(run.stdout), [['heading', 'paragraph', 'paragraph'], 2 * marks, b, []], run.stderr);
});

test('when the read fails, the import keeps the whole text as one code block and always says so', () => {
  const planted = { ...IMPORT_WORK, get budget() { throw new Error('a planted throw'); } };
  const md = '# Title\n\nsome text\n';
  assert.deepEqual(readMarkdown(md, planted), { blocks: [{ type: 'code', value: md }], notices: [{ code: IMPORT_FELL_BACK, path: '/blocks/0', line: 1, lines: 3 }], work: 0 });
  assert.deepEqual(readMarkdown('  \n', planted).notices, [{ code: IMPORT_FELL_BACK, path: '/blocks', line: 1, lines: 1 }]);
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
    assert.deepEqual(fromMarkdown(`\`\`\`portabledoc\n${JSON.stringify(doc)}\n\`\`\``), currentNames(doc), type);
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
  assert.deepEqual(fromMarkdown(fenceOf(blocks)), currentNames(blocks));
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
