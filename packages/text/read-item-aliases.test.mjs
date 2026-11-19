import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderPortableDocument } from '@portable-doc/react';
import { canon } from './golden-reads.mjs';
import { toMarkdown, toPlainText } from './index.js';
import { aliasTable, readItem } from './read-aliases.js';

// The alias table's rows for items inside a block and for inline nodes ("steps.steps[].children",
// "inline:text.text"): every renderer and the round-trip canon read them through readItem, by the
// same rule as a block's fields. Each row's shared case (the same block and reads go to Barkpark's
// reader) is in ROWS: the block with the old name alone, and the same block under the current name.

const html = (block) => renderPortableDocument([block], {}).replace(/ style="[^"]*"/g, '');
const md = (block) => toMarkdown([block]);
const text = (block) => toPlainText([block]);
const t = (value) => [{ type: 'text', value }];
const kid = [{ type: 'paragraph', content: t('kid') }];

// row → [the block with the old name alone, the same block under the current name].
const ROWS = {
  'blockquote.text': [{ type: 'blockquote', text: 'q' }, { type: 'blockquote', content: t('q') }],
  'code-tabs.tabs[].code': [{ type: 'code-tabs', tabs: [{ label: 'L', code: 'x = 1' }] }, { type: 'code-tabs', tabs: [{ label: 'L', value: 'x = 1' }] }],
  'ingress.text': [{ type: 'ingress', text: 'i' }, { type: 'ingress', content: t('i') }],
  'inline:code.children': [{ type: 'paragraph', content: [{ type: 'code', children: t('f()') }] }, { type: 'paragraph', content: [{ type: 'code', value: 'f()' }] }],
  'inline:text.text': [{ type: 'paragraph', content: [{ type: 'text', text: 'leaf' }] }, { type: 'paragraph', content: t('leaf') }],
  'list.items[].text': [{ type: 'list', items: [{ text: 'one' }] }, { type: 'list', items: [{ content: t('one') }] }],
  'note.text': [{ type: 'note', label: 'L', text: 'n' }, { type: 'note', label: 'L', content: t('n') }],
  'notes.items[].text': [{ type: 'notes', items: [{ label: 'L', text: 'n' }] }, { type: 'notes', items: [{ label: 'L', content: t('n') }] }],
  'steps.steps[].children': [{ type: 'steps', steps: [{ title: 'S', children: kid }] }, { type: 'steps', steps: [{ title: 'S', blocks: kid }] }],
  'table.columns[].label': [{ type: 'table', columns: [{ key: 'k', label: 'K' }], rows: [{ k: 1 }] }, { type: 'table', columns: [{ key: 'k', text: 'K' }], rows: [{ k: 1 }] }],
  'task-detail.criteria[].criterion': [{ type: 'task-detail', title: 'T', criteria: [{ criterion: 'c' }] }, { type: 'task-detail', title: 'T', criteria: [{ text: 'c' }] }],
  'task-detail.task.criteria[].criterion': [{ type: 'task-detail', task: { title: 'T', criteria: [{ criterion: 'c' }] } }, { type: 'task-detail', task: { title: 'T', criteria: [{ text: 'c' }] } }],
};

test('every item and inline row, and each block row this table gained, has a case: its old name alone shows as its current name does, in HTML, Markdown and text', () => {
  const rows = Object.keys(aliasTable().aliases).filter((key) => key.includes('[]') || key.startsWith('inline:') || ['blockquote.text', 'ingress.text', 'note.text'].includes(key));
  assert.deepEqual(Object.keys(ROWS), rows);
  for (const [row, [old, current]] of Object.entries(ROWS)) {
    assert.equal(html(old), html(current), `${row}: HTML`);
    assert.equal(md(old), md(current), `${row}: Markdown`);
    assert.equal(text(old), text(current), `${row}: text`);
    assert.ok(text(current).trim() !== '' || html(current).includes('>'), `${row}: the case shows something`);
  }
});

test('the round-trip canon reads item and inline names as the renderers do: an old name alone compares equal to its current name, and a different value does not', () => {
  for (const [row, [old, current]] of Object.entries(ROWS)) assert.deepEqual(canon(old), canon(current), row);
  // A text leaf whose value is blank and whose text is filled: the renderers show the text, and so does canon.
  const leaf = { type: 'paragraph', content: [{ type: 'text', value: '', text: 'a' }] };
  assert.equal(text(leaf), 'a\n');
  assert.deepEqual(canon(leaf), canon({ type: 'paragraph', content: t('a') }));
  assert.notDeepEqual(canon(ROWS['steps.steps[].children'][0]), canon({ type: 'steps', steps: [{ title: 'S', blocks: [{ type: 'paragraph', content: t('other') }] }] }));
  assert.notDeepEqual(canon(ROWS['list.items[].text'][0]), canon({ type: 'list', items: [{ content: t('two') }] }));
});

// Whitespace in running text is a value, as main showed it: a text leaf or an inline code node of
// only whitespace between words, under its old name or its current name, in a paragraph, a
// heading, a list item, strong, after inline code and under a mark. The column 'a whitespace-only
// value under the current name wins' says yes for both. Each row is [case, block, HTML, Markdown,
// text], all as main renders them, whole.
const NEIGHBOURS = [
  ['Hello world, a space under the old name', {type:  'paragraph', content:  [{type:  'text', value:  'Hello'}, {type:  'text', text:  ' '}, {type:  'text', value:  'world'}]}, '<p>Hello world</p>', 'Hello world\n', 'Hello world\n'],
  ['Hello world in a heading, a space under the old name', {type:  'heading', level:  2, content:  [{type:  'text', value:  'Hello'}, {type:  'text', text:  ' '}, {type:  'text', value:  'world'}]}, '<h2>Hello world</h2>', '## Hello world\n', 'Hello world\n'],
  ['Hello world in a list item, a space under the old name', {type:  'list', items:  [{content:  [{type:  'text', value:  'Hello'}, {type:  'text', text:  ' '}, {type:  'text', value:  'world'}]}]}, '<ul><li><span>Hello world</span></li></ul>', '- Hello world\n', '- Hello world\n'],
  ['Hello world in strong, a space under the old name', {type:  'paragraph', content:  [{type:  'strong', children:  [{type:  'text', value:  'Hello'}, {type:  'text', text:  ' '}, {type:  'text', value:  'world'}]}]}, '<p><span>Hello world</span></p>', '**Hello world**\n', 'Hello world\n'],
  ['after inline code, a space under the old name', {type:  'paragraph', content:  [{type:  'code', value:  'f()'}, {type:  'text', text:  ' '}, {type:  'text', value:  'world'}]}, '<p><code>f()</code> world</p>', '`f()` world\n', 'f() world\n'],
  ['Hello world, the leaf in em, a space under the old name', {type:  'paragraph', content:  [{type:  'text', value:  'Hello'}, {type:  'text', text:  ' ', marks:  [{type:  'em'}]}, {type:  'text', value:  'world'}]}, '<p>Hello<span> </span>world</p>', 'Hello world\n', 'Hello world\n'],
  ['Hello world, a space under the current name', {type:  'paragraph', content:  [{type:  'text', value:  'Hello'}, {type:  'text', value:  ' '}, {type:  'text', value:  'world'}]}, '<p>Hello world</p>', 'Hello world\n', 'Hello world\n'],
  ['Hello world in a heading, a space under the current name', {type:  'heading', level:  2, content:  [{type:  'text', value:  'Hello'}, {type:  'text', value:  ' '}, {type:  'text', value:  'world'}]}, '<h2>Hello world</h2>', '## Hello world\n', 'Hello world\n'],
  ['Hello world in a list item, a space under the current name', {type:  'list', items:  [{content:  [{type:  'text', value:  'Hello'}, {type:  'text', value:  ' '}, {type:  'text', value:  'world'}]}]}, '<ul><li><span>Hello world</span></li></ul>', '- Hello world\n', '- Hello world\n'],
  ['Hello world in strong, a space under the current name', {type:  'paragraph', content:  [{type:  'strong', children:  [{type:  'text', value:  'Hello'}, {type:  'text', value:  ' '}, {type:  'text', value:  'world'}]}]}, '<p><span>Hello world</span></p>', '**Hello world**\n', 'Hello world\n'],
  ['after inline code, a space under the current name', {type:  'paragraph', content:  [{type:  'code', value:  'f()'}, {type:  'text', value:  ' '}, {type:  'text', value:  'world'}]}, '<p><code>f()</code> world</p>', '`f()` world\n', 'f() world\n'],
  ['Hello world, the leaf in em, a space under the current name', {type:  'paragraph', content:  [{type:  'text', value:  'Hello'}, {type:  'text', value:  ' ', marks:  [{type:  'em'}]}, {type:  'text', value:  'world'}]}, '<p>Hello<span> </span>world</p>', 'Hello world\n', 'Hello world\n'],
  ['Hello world, a newline under the old name', {type:  'paragraph', content:  [{type:  'text', value:  'Hello'}, {type:  'text', text:  '\n'}, {type:  'text', value:  'world'}]}, '<p>Hello\nworld</p>', 'Hello\\\nworld\n', 'Hello\nworld\n'],
  ['Hello world in a heading, a newline under the old name', {type:  'heading', level:  2, content:  [{type:  'text', value:  'Hello'}, {type:  'text', text:  '\n'}, {type:  'text', value:  'world'}]}, '<h2>Hello\nworld</h2>', '## Hello world\n', 'Hello world\n'],
  ['Hello world in a list item, a newline under the old name', {type:  'list', items:  [{content:  [{type:  'text', value:  'Hello'}, {type:  'text', text:  '\n'}, {type:  'text', value:  'world'}]}]}, '<ul><li><span>Hello\nworld</span></li></ul>', '- Hello\\\n  world\n', '- Hello\n  world\n'],
  ['Hello world in strong, a newline under the old name', {type:  'paragraph', content:  [{type:  'strong', children:  [{type:  'text', value:  'Hello'}, {type:  'text', text:  '\n'}, {type:  'text', value:  'world'}]}]}, '<p><span>Hello\nworld</span></p>', '**Hello\\\nworld**\n', 'Hello\nworld\n'],
  ['after inline code, a newline under the old name', {type:  'paragraph', content:  [{type:  'code', value:  'f()'}, {type:  'text', text:  '\n'}, {type:  'text', value:  'world'}]}, '<p><code>f()</code>\nworld</p>', '`f()`\\\nworld\n', 'f()\nworld\n'],
  ['Hello world, the leaf in em, a newline under the old name', {type:  'paragraph', content:  [{type:  'text', value:  'Hello'}, {type:  'text', text:  '\n', marks:  [{type:  'em'}]}, {type:  'text', value:  'world'}]}, '<p>Hello<span>\n</span>world</p>', 'Hello\\\nworld\n', 'Hello\nworld\n'],
  ['Hello world, a newline under the current name', {type:  'paragraph', content:  [{type:  'text', value:  'Hello'}, {type:  'text', value:  '\n'}, {type:  'text', value:  'world'}]}, '<p>Hello\nworld</p>', 'Hello\\\nworld\n', 'Hello\nworld\n'],
  ['Hello world in a heading, a newline under the current name', {type:  'heading', level:  2, content:  [{type:  'text', value:  'Hello'}, {type:  'text', value:  '\n'}, {type:  'text', value:  'world'}]}, '<h2>Hello\nworld</h2>', '## Hello world\n', 'Hello world\n'],
  ['Hello world in a list item, a newline under the current name', {type:  'list', items:  [{content:  [{type:  'text', value:  'Hello'}, {type:  'text', value:  '\n'}, {type:  'text', value:  'world'}]}]}, '<ul><li><span>Hello\nworld</span></li></ul>', '- Hello\\\n  world\n', '- Hello\n  world\n'],
  ['Hello world in strong, a newline under the current name', {type:  'paragraph', content:  [{type:  'strong', children:  [{type:  'text', value:  'Hello'}, {type:  'text', value:  '\n'}, {type:  'text', value:  'world'}]}]}, '<p><span>Hello\nworld</span></p>', '**Hello\\\nworld**\n', 'Hello\nworld\n'],
  ['after inline code, a newline under the current name', {type:  'paragraph', content:  [{type:  'code', value:  'f()'}, {type:  'text', value:  '\n'}, {type:  'text', value:  'world'}]}, '<p><code>f()</code>\nworld</p>', '`f()`\\\nworld\n', 'f()\nworld\n'],
  ['Hello world, the leaf in em, a newline under the current name', {type:  'paragraph', content:  [{type:  'text', value:  'Hello'}, {type:  'text', value:  '\n', marks:  [{type:  'em'}]}, {type:  'text', value:  'world'}]}, '<p>Hello<span>\n</span>world</p>', 'Hello\\\nworld\n', 'Hello\nworld\n'],
  ['**Hello** then a leaf {value: \' \', text: \'X\'} then *world*', {type:  'paragraph', content:  [{type:  'text', value:  'Hello', marks:  [{type:  'strong'}]}, {type:  'text', value:  ' ', text:  'X'}, {type:  'text', value:  'world', marks:  [{type:  'em'}]}]}, '<p><span>Hello</span> <span>world</span></p>', '**Hello** *world*\n', 'Hello world\n'],
  ['Left Right, inline code children of a space', {type:  'paragraph', content:  [{type:  'text', value:  'Left'}, {type:  'code', children:  ' '}, {type:  'text', value:  'Right'}]}, '<p>Left<code> </code>Right</p>', 'Left Right\n', 'Left Right\n'],
  ['Left Right, inline code value of a space', {type:  'paragraph', content:  [{type:  'text', value:  'Left'}, {type:  'code', value:  ' '}, {type:  'text', value:  'Right'}]}, '<p>Left<code> </code>Right</p>', 'Left Right\n', 'Left Right\n'],
  ['Left Right, inline code children of a newline', {type:  'paragraph', content:  [{type:  'text', value:  'Left'}, {type:  'code', children:  '\n'}, {type:  'text', value:  'Right'}]}, '<p>Left<code>\n</code>Right</p>', 'Left\\\nRight\n', 'Left\nRight\n'],
  ['Left Right, inline code value of a newline', {type:  'paragraph', content:  [{type:  'text', value:  'Left'}, {type:  'code', value:  '\n'}, {type:  'text', value:  'Right'}]}, '<p>Left<code>\n</code>Right</p>', 'Left\\\nRight\n', 'Left\nRight\n'],
  ['inline code {value: \' \', children: [x]}', {type:  'paragraph', content:  [{type:  'code', value:  ' ', children:  [{type:  'text', value:  'x'}]}]}, '<p><code> </code></p>', '', ''],
];

test('whitespace between words, in a text leaf or an inline code node, under either name, shows as main shows it, in HTML, Markdown and text', () => {
  for (const [name, block, h, markdown, plain] of NEIGHBOURS) {
    assert.equal(html(block), h, name);
    assert.equal(md(block), markdown, name);
    assert.equal(text(block), plain, name);
  }
});

test('the round-trip canon keeps whitespace between words: a leaf under its old name compares as under its current name, and keeps its space', () => {
  const runText = (block) => JSON.stringify(canon(block));
  for (const [name, block] of NEIGHBOURS.filter(([n]) => n.includes('under the old name'))) {
    const current = JSON.parse(JSON.stringify(block).replace(/"text":("(?: |\\n)")/g, '"value":$1'));
    assert.deepEqual(canon(block), canon(current), name);
  }
  assert.match(runText({ type: 'paragraph', content: [...t('Hello'), { type: 'text', text: ' ' }] }), /"text":"Hello "/);
  assert.match(runText({ type: 'paragraph', content: [...t('Hello'), { type: 'text', text: ' ' }, ...t('world')] }), /"text":"Hello world"/);
  assert.match(runText({ type: 'paragraph', content: [...t('Hello'), { type: 'text', text: '\n' }, ...t('world')] }), /"text":"Hello\\nworld"/);
  // The current name's whitespace wins over a filled old name, in canon as in the renderers.
  assert.match(runText({ type: 'paragraph', content: [...t('a'), { type: 'text', value: ' ', text: 'X' }, ...t('b')] }), /"text":"a b"/);
});

test('an inline code node of only whitespace keeps it, with or without children beside it, as main shows it', () => {
  assert.deepEqual(readItem({ type: 'code', value: ' ' }, 'inline:code', 'value'), { name: 'value', value: ' ' });
  assert.deepEqual(readItem({ type: 'code', value: ' ', children: t('x') }, 'inline:code', 'value'), { name: 'value', value: ' ' });
  const both = { type: 'paragraph', content: [{ type: 'code', value: ' ', children: t('x') }] };
  assert.equal(html(both), '<p><code> </code></p>');
});

// Each item edge whose output changes under the rule, one per row and kind: the block, then the
// whole HTML, Markdown and text it shows now; what main showed is in each comment. Each adds
// characters where main showed none or an empty value: no character main shows is lost.
const CHANGED = [
  // steps: blocks [] used to win and leave the step empty; the children show now.
  [{ type: 'steps', steps: [{ title: 'S', blocks: [], children: [{ type: 'paragraph', content: [{ type: 'text', value: 'B' }] }] }] }, '<ol class="bp-steps"><li class="bp-steps__step"><div class="bp-steps__title">S</div><div class="bp-steps__body"><p>B</p></div></li></ol>', '1. **S**\n\n   B\n', '1. S\n\n   B\n'],
  // steps: blocks of a type the schema does not give them used to win; the children show now.
  [{ type: 'steps', steps: [{ title: 'S', blocks: 'A', children: [{ type: 'paragraph', content: [{ type: 'text', value: 'B' }] }] }] }, '<ol class="bp-steps"><li class="bp-steps__step"><div class="bp-steps__title">S</div><div class="bp-steps__body"><p>B</p></div></li></ol>', '1. **S**\n\n   B\n', '1. S\n\n   B\n'],
  // steps: children that are inlines, not blocks, now show as an unsupported block where blocks [] showed nothing.
  [{ type: 'steps', steps: [{ title: 'S', blocks: [], children: [{ type: 'text', value: 'B' }] }] }, '<ol class="bp-steps"><li class="bp-steps__step"><div class="bp-steps__title">S</div><div class="bp-steps__body"><div class="bp-unknown-block">Unsupported block: text</div></div></li></ol>', '1. **S**\n', '1. S\n'],
  // code-tabs: a blank value used to win and leave the tab empty; the code shows now.
  [{ type: 'code-tabs', tabs: [{ label: 'L', value: '', code: 'B' }] }, '<div class="bp-code-tabs"><div class="bp-code-tabs__strip" role="tablist"><button type="button" class="bp-code-tabs__tab bp-code-tabs__tab--active" role="tab" aria-selected="true" data-lang="">L</button></div><div class="bp-code-tabs__panels"><div class="bp-code-tabs__panel" data-lang=""><pre class="bp-codeblock">B</pre></div></div></div>', '**L**\n\n```\nB\n```\n', 'L\n\nB\n'],
  // code-tabs: a value that is not text (an inline array) used to win and show nothing; the code shows now.
  [{ type: 'code-tabs', tabs: [{ label: 'L', value: [{ type: 'text', value: 'A' }], code: 'B' }] }, '<div class="bp-code-tabs"><div class="bp-code-tabs__strip" role="tablist"><button type="button" class="bp-code-tabs__tab bp-code-tabs__tab--active" role="tab" aria-selected="true" data-lang="">L</button></div><div class="bp-code-tabs__panels"><div class="bp-code-tabs__panel" data-lang=""><pre class="bp-codeblock">B</pre></div></div></div>', '**L**\n\n```\nB\n```\n', 'L\n\nB\n'],
  // code-tabs: a value [] used to win; the code's spaces show now.
  [{ type: 'code-tabs', tabs: [{ label: 'L', value: [], code: '  ' }] }, '<div class="bp-code-tabs"><div class="bp-code-tabs__strip" role="tablist"><button type="button" class="bp-code-tabs__tab bp-code-tabs__tab--active" role="tab" aria-selected="true" data-lang="">L</button></div><div class="bp-code-tabs__panels"><div class="bp-code-tabs__panel" data-lang=""><pre class="bp-codeblock">  </pre></div></div></div>', '**L**\n', 'L\n'],
  // columns: a blank text used to win and leave the head empty; the label shows now.
  [{ type: 'table', columns: [{ key: 'k', text: '', label: 'B' }], rows: [{ k: 1 }] }, '<table role="presentation" class="bp-table"><thead><tr><th class="bp-table__th"><span>B</span></th></tr></thead><tbody><tr><td class="bp-table__td"><span>1</span></td></tr></tbody></table>', '| B |\n| --- |\n| 1 |\n', 'B\n-\n1\n'],
  // columns: text {} used to win and show an empty inline object; the label shows now.
  [{ type: 'table', columns: [{ key: 'k', text: { }, label: 'B' }], rows: [{ k: 1 }] }, '<table role="presentation" class="bp-table"><thead><tr><th class="bp-table__th"><span>B</span></th></tr></thead><tbody><tr><td class="bp-table__td"><span>1</span></td></tr></tbody></table>', '| B |\n| --- |\n| 1 |\n', 'B\n-\n1\n'],
  // columns: text true used to win; the label shows now.
  [{ type: 'table', columns: [{ key: 'k', text: true, label: 'B' }], rows: [{ k: 1 }] }, '<table role="presentation" class="bp-table"><thead><tr><th class="bp-table__th"><span>B</span></th></tr></thead><tbody><tr><td class="bp-table__td"><span>1</span></td></tr></tbody></table>', '| B |\n| --- |\n| 1 |\n', 'B\n-\n1\n'],
  // columns: text true alone used to show nothing; the key shows now.
  [{ type: 'table', columns: [{ key: 'k', text: true }], rows: [{ k: 1 }] }, '<table role="presentation" class="bp-table"><thead><tr><th class="bp-table__th"><span>k</span></th></tr></thead><tbody><tr><td class="bp-table__td"><span>1</span></td></tr></tbody></table>', '| k |\n| --- |\n| 1 |\n', 'k\n-\n1\n'],
  // columns: label true alone used to show nothing; the key shows now.
  [{ type: 'table', columns: [{ key: 'k', label: true }], rows: [{ k: 1 }] }, '<table role="presentation" class="bp-table"><thead><tr><th class="bp-table__th"><span>k</span></th></tr></thead><tbody><tr><td class="bp-table__td"><span>1</span></td></tr></tbody></table>', '| k |\n| --- |\n| 1 |\n', 'k\n-\n1\n'],
];

test('each item edge whose behaviour changes under the rule shows the same winner in HTML, Markdown and text', () => {
  for (const [block, h, markdown, plain] of CHANGED) {
    const label = JSON.stringify(block);
    assert.equal(html(block), h, label);
    assert.equal(md(block), markdown, label);
    assert.equal(text(block), plain, label);
  }
});
