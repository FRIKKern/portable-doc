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

test('an inline code node of only whitespace, with no other name, keeps its whitespace; beside filled children, the children win', () => {
  const space = { type: 'paragraph', content: [t('a')[0], { type: 'code', value: ' ' }, t('b')[0]] };
  assert.equal(html(space), '<p>a<code> </code>b</p>');
  // Markdown writes a code span of only spaces as the spaces, as on main.
  assert.equal(md(space), 'a b\n');
  assert.equal(text(space), 'a b\n');
  assert.deepEqual(readItem({ type: 'code', value: ' ' }, 'inline:code', 'value'), { name: 'value', value: ' ' });
  // The one blank rule: a blank value means "look at the other name". Main showed ' ' here.
  const both = { type: 'paragraph', content: [{ type: 'code', value: ' ', children: t('x') }] };
  assert.equal(html(both), '<p><code>x</code></p>');
  assert.equal(md(both), '`x`\n');
  assert.equal(text(both), 'x\n');
});

// Each item edge whose output changes under the rule, one per row and kind: the block, then the
// whole HTML, Markdown and text it shows now. What main showed is in each comment. No word main
// shows is lost: a blank or [] current name, or one of a type it does not read, now falls to a
// filled old name; and spaces alone under an old name no longer show in HTML.
const CHANGED = [
  // steps: blocks [] used to win and leave the step empty; the children show now.
  [{ type: 'steps', steps: [{ title: 'S', blocks: [], children: [{ type: 'paragraph', content: [{ type: 'text', value: 'B' }] }] }] }, '<ol class="bp-steps"><li class="bp-steps__step"><div class="bp-steps__title">S</div><div class="bp-steps__body"><p>B</p></div></li></ol>', '1. **S**\n\n   B\n', '1. S\n\n   B\n'],
  // steps: blocks of a type the schema does not give it used to win; the children show now.
  [{ type: 'steps', steps: [{ title: 'S', blocks: 'A', children: [{ type: 'paragraph', content: [{ type: 'text', value: 'B' }] }] }] }, '<ol class="bp-steps"><li class="bp-steps__step"><div class="bp-steps__title">S</div><div class="bp-steps__body"><p>B</p></div></li></ol>', '1. **S**\n\n   B\n', '1. S\n\n   B\n'],
  // code-tabs: a blank value used to win and leave the tab empty; the code shows now.
  [{ type: 'code-tabs', tabs: [{ label: 'L', value: '', code: 'B' }] }, '<div class="bp-code-tabs"><div class="bp-code-tabs__strip" role="tablist"><button type="button" class="bp-code-tabs__tab bp-code-tabs__tab--active" role="tab" aria-selected="true" data-lang="">L</button></div><div class="bp-code-tabs__panels"><div class="bp-code-tabs__panel" data-lang=""><pre class="bp-codeblock">B</pre></div></div></div>', '**L**\n\n```\nB\n```\n', 'L\n\nB\n'],
  // code-tabs: spaces under code alone; HTML used to show them, it is empty now.
  [{ type: 'code-tabs', tabs: [{ label: 'L', code: '  ' }] }, '<div class="bp-code-tabs"><div class="bp-code-tabs__strip" role="tablist"><button type="button" class="bp-code-tabs__tab bp-code-tabs__tab--active" role="tab" aria-selected="true" data-lang="">L</button></div><div class="bp-code-tabs__panels"><div class="bp-code-tabs__panel" data-lang=""><pre class="bp-codeblock"></pre></div></div></div>', '**L**\n', 'L\n'],
  // columns: a blank text used to win and leave the head empty; the label shows now.
  [{ type: 'table', columns: [{ key: 'k', text: '', label: 'B' }], rows: [{ k: 1 }] }, '<table role="presentation" class="bp-table"><thead><tr><th class="bp-table__th"><span>B</span></th></tr></thead><tbody><tr><td class="bp-table__td"><span>1</span></td></tr></tbody></table>', '| B |\n| --- |\n| 1 |\n', 'B\n-\n1\n'],
  // columns: text [] used to win; the label, an inline array, shows now.
  [{ type: 'table', columns: [{ key: 'k', text: [], label: [{ type: 'text', value: 'B' }] }], rows: [{ k: 1 }] }, '<table role="presentation" class="bp-table"><thead><tr><th class="bp-table__th"><span>B</span></th></tr></thead><tbody><tr><td class="bp-table__td"><span>1</span></td></tr></tbody></table>', '| B |\n| --- |\n| 1 |\n', 'B\n-\n1\n'],
  // columns: a blank label alone used to give an empty head; the key shows now, as with no label.
  [{ type: 'table', columns: [{ key: 'k', label: '' }], rows: [{ k: 1 }] }, '<table role="presentation" class="bp-table"><thead><tr><th class="bp-table__th"><span>k</span></th></tr></thead><tbody><tr><td class="bp-table__td"><span>1</span></td></tr></tbody></table>', '| k |\n| --- |\n| 1 |\n', 'k\n-\n1\n'],
  // criteria: a text of spaces used to win; the criterion shows now.
  [{ type: 'task-detail', title: 'T', criteria: [{ text: '  ', criterion: 'B' }] }, '<div class="bp-tdetail"><div class="bp-tdetail__title">T</div><div class="bp-tdetail__meta"><span class="bp-g bp-g--open">○</span><span></span></div><div class="bp-tdetail__lbl">Criteria · 0/1</div><div class="bp-tdetail__crit"><div class="bp-crit"><span class="bp-g bp-g--ready">○</span><span class="bp-crit__t">B</span></div></div></div>', '**T**\n\nCriteria · 0/1\n\n- [ ] B\n', 'T\n\nCriteria · 0/1\n\n- [ ] B\n'],
  // criteria under task: a text of spaces used to win; the criterion shows now.
  [{ type: 'task-detail', task: { title: 'T', criteria: [{ text: '  ', criterion: 'B' }] } }, '<div class="bp-tdetail"><div class="bp-tdetail__title">T</div><div class="bp-tdetail__meta"><span class="bp-g bp-g--open">○</span><span></span></div><div class="bp-tdetail__lbl">Criteria · 0/1</div><div class="bp-tdetail__crit"><div class="bp-crit"><span class="bp-g bp-g--ready">○</span><span class="bp-crit__t">B</span></div></div></div>', '**T**\n\nCriteria · 0/1\n\n- [ ] B\n', 'T\n\nCriteria · 0/1\n\n- [ ] B\n'],
  // criteria: spaces under criterion alone; HTML used to show them, it is empty now.
  [{ type: 'task-detail', title: 'T', criteria: [{ criterion: '  ' }] }, '<div class="bp-tdetail"><div class="bp-tdetail__title">T</div><div class="bp-tdetail__meta"><span class="bp-g bp-g--open">○</span><span></span></div><div class="bp-tdetail__lbl">Criteria · 0/1</div><div class="bp-tdetail__crit"><div class="bp-crit"><span class="bp-g bp-g--ready">○</span><span class="bp-crit__t"></span></div></div></div>', '**T**\n\nCriteria · 0/1\n\n- [ ]\n', 'T\n\nCriteria · 0/1\n\n- [ ]\n'],
  // a text leaf: a value of spaces used to win; its text shows now.
  [{ type: 'paragraph', content: [{ type: 'text', value: '  ', text: 'B' }] }, '<p>B</p>', 'B\n', 'B\n'],
  // inline code: children of spaces alone; HTML used to show them, it is empty now.
  [{ type: 'paragraph', content: [{ type: 'code', children: '  ' }] }, '<p><code></code></p>', '', ''],
  // blockquote: spaces under text alone; HTML used to show them, it is empty now.
  [{ type: 'blockquote', text: '  ' }, '<blockquote class="bp-blockquote"><p></p></blockquote>', '', ''],
  // ingress: spaces under text alone; HTML used to show them, it is empty now.
  [{ type: 'ingress', text: '  ' }, '<p class="bp-role-ingress"></p>', '', ''],
  // note: spaces under text alone; HTML used to show them, it is empty now.
  [{ type: 'note', label: 'L', text: '  ' }, '<div class="bp-note"><span class="bp-note__k">L</span><div class="bp-note__d"></div></div>', '**L:**\n', 'L:\n'],
  // notes: spaces under an item's text alone; HTML used to show them, it is empty now.
  [{ type: 'notes', items: [{ label: 'L', text: '  ' }] }, '<div class="bp-notes"><div class="bp-note"><span class="bp-note__k">L</span><div class="bp-note__d"></div></div></div>', '- **L:**\n', '- L:\n'],
  // list: spaces under an item's text alone; HTML used to show them, it is empty now.
  [{ type: 'list', items: [{ text: '  ' }] }, '<ul><li><span></span></li></ul>', '-\n', '-\n'],
];

test('each item edge whose behaviour changes under the rule shows the same winner in HTML, Markdown and text', () => {
  for (const [block, h, markdown, plain] of CHANGED) {
    const label = JSON.stringify(block);
    assert.equal(html(block), h, label);
    assert.equal(md(block), markdown, label);
    assert.equal(text(block), plain, label);
  }
});
