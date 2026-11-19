import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderPortableDocument } from '@portable-doc/react';
import { canon } from './golden-reads.mjs';
import { toMarkdown, toPlainText } from './index.js';
import { TABLE, absent, readField } from './read-aliases.js';

// One table, one rule: every renderer and the round-trip canon read an aliased field through
// read-aliases.js. These cases are the shared ones (the same blocks and reads go to Barkpark's
// reader); the HTML, Markdown and text columns are what this repo's renderers show.

const html = (block) => renderPortableDocument([block], {}).replace(/ style="[^"]*"/g, '');
const md = (block) => toMarkdown([block]);
const text = (block) => toPlainText([block]);
const t = (value) => [{ type: 'text', value }];
const kid = [{ type: 'paragraph', content: t('kid') }];

test('one table in the pack file\'s shape: 15 rows, sorted, each old name and its current name on one block type', () => {
  assert.deepEqual(Object.keys(TABLE), ['_comment', 'aliases']);
  const rows = Object.entries(TABLE.aliases);
  assert.equal(rows.length, 15);
  assert.deepEqual(rows.map(([from]) => from), rows.map(([from]) => from).sort());
  for (const [from, row] of rows) {
    assert.equal(row.to.split('.')[0], from.split('.')[0], from);
    assert.deepEqual(Object.keys(row).filter((k) => !['to', 'reason', 'convert'].includes(k)), [], from);
    assert.ok([undefined, 'inline-from-string', 'columns-from-cols', 'head-from-header'].includes(row.convert), from);
  }
  assert.ok(Object.isFrozen(TABLE.aliases['code.code']));
});

test('the rule: absent is undefined, null, a blank string or an empty array; the first name not absent wins, current name first; all absent reads the current name as stored', () => {
  for (const value of [undefined, null, '', '  \n\t', []]) assert.equal(absent(value), true, JSON.stringify(value));
  for (const value of ['a', 0, false, {}, [''], t(' ')]) assert.equal(absent(value), false, JSON.stringify(value));
  assert.deepEqual(readField({ type: 'code', value: 'v', code: 'c' }, 'value'), { name: 'value', value: 'v' });
  assert.deepEqual(readField({ type: 'code', value: ' ', content: [], text: 't' }, 'value'), { name: 'text', value: 't' });
  assert.deepEqual(readField({ type: 'code', value: '  ', code: '' }, 'value'), { name: 'value', value: '  ' });
  assert.deepEqual(readField({ type: 'code', code: '  ' }, 'value'), { name: 'value', value: undefined });
  // A field with no old names, and a block type with none, read the field alone.
  assert.deepEqual(readField({ type: 'code', footer: ' ' }, 'footer'), { name: 'footer', value: ' ' });
  assert.deepEqual(readField({ type: 'note', text: 't' }, 'content'), { name: 'content', value: undefined });
});

test('a block with two old names for one field reads and compares as the first old name in table order: code { code: a, text: b } is a', () => {
  const two = { type: 'code', code: 'a', text: 'b' };
  assert.equal(readField(two, 'value').value, 'a');
  assert.match(html(two), /<pre class="bp-codeblock">a<\/pre>/);
  assert.equal(md(two), '```\na\n```\n');
  assert.equal(text(two), 'a\n');
  // The round-trip canon used to let the last name win, so this compared equal to value b.
  assert.deepEqual(canon(two), canon({ type: 'code', value: 'a' }));
  assert.notDeepEqual(canon(two), canon({ type: 'code', value: 'b' }));
});

// Each field whose behaviour changes under the rule: the block, then what HTML (a fragment),
// Markdown and text show now. The old behaviour is in each comment.
const CHANGED = [
  // table: head [] used to win and leave no head row; the header rows show now.
  [{ type: 'table', head: [], header: [t('H')], rows: [[t('r')]] }, '<th class="bp-table__th"><span>H</span></th>', '| H |\n| --- |\n| r |\n', 'H\n-\nr\n'],
  // expandable: blocks [] used to win and leave the body empty; the children show now.
  [{ type: 'expandable', summary: 'S', blocks: [], children: kid }, '<div class="bp-expandable__body"><p>kid</p></div>', '**S**\n\nkid\n', 'S\n\nkid\n'],
  // terminal: children [] used to win and leave the body empty; the old name blocks shows now.
  [{ type: 'terminal', title: 'T', children: [], blocks: kid }, '<div class="bp-term__body"><p>kid</p></div>', '**T**\n\nkid\n', 'T\n\nkid\n'],
  // code: an inline array of blank text under value is not absent, so it wins over code: x,
  // which used to show; the block is blank now.
  [{ type: 'code', value: t('  '), code: 'x' }, '', '```\n  \n```\n', ''],
  // code: spaces under an old name alone; the Markdown fence used to keep them, it is empty now.
  [{ type: 'code', code: '   ' }, '', '```\n```\n', ''],
  // code: a blank lang used to win over language; the fence names py now.
  [{ type: 'code', value: 'x', lang: '  ', language: 'py' }, '<pre class="bp-codeblock">x</pre>', '```py\nx\n```\n', 'x\n'],
  // blockquote: HTML showed a cite of spaces; Ann now, as Markdown and text already did.
  [{ type: 'blockquote', content: t('q'), cite: '  ', attribution: 'Ann' }, '<cite class="bp-blockquote__cite">Ann</cite>', '> q\n>\n> — Ann\n', '“q”\n— Ann\n'],
  // heading: a content string used to be skipped for text; it is the current name, so it shows.
  [{ type: 'heading', content: 'Hi', text: 'Yo' }, '<h2>Hi</h2>', '## Hi\n', 'Hi\n'],
  // asciicast: posterAt, the current name, is read before poster.
  [{ type: 'asciicast', src: 'https://e.example/c.cast', poster: 'npt:0:01', posterAt: 'npt:0:09' }, 'data-cast-poster="npt:0:09"', '[Terminal recording](https://e.example/c.cast)\n', 'Terminal recording: https://e.example/c.cast\n'],
];

test('each field whose behaviour changes under the rule shows the same winner in HTML, Markdown and text', () => {
  for (const [block, fragment, markdown, plain] of CHANGED) {
    const label = JSON.stringify(block);
    if (fragment === '') assert.equal(html(block), '', label);
    else assert.ok(html(block).includes(fragment), `${label}\n${html(block)}`);
    assert.equal(md(block), markdown, label);
    assert.equal(text(block), plain, label);
  }
});

test('a table\'s cols stands in for columns only as each column\'s type: beside columns it keeps the delta styling, and alone it builds no head row', () => {
  const both = { type: 'table', columns: [{ key: 'a', text: 'A' }], cols: [{ type: 'delta' }], rows: [{ a: 3 }] };
  assert.ok(html(both).includes('<th class="bp-table__th bp-table__th--num"><span>A</span></th>'), html(both));
  assert.ok(html(both).includes('<span>▲ 3</span>'), html(both));
  assert.equal(md(both), '| A |\n| --- |\n| ▲ 3 |\n');
  // A column's own type comes first.
  const own = { ...both, columns: [{ key: 'a', text: 'A', type: 'spark' }], rows: [{ a: [1, 2] }] };
  assert.equal(md(own), '| A |\n| --- |\n| 1 2 |\n');
  const alone = { type: 'table', cols: [{ type: 'delta' }], rows: [[3]] };
  assert.ok(!html(alone).includes('<thead>'), html(alone));
  assert.equal(text(alone), '▲ 3\n');
  // canon keeps cols as it is: it is never folded into columns.
  assert.deepEqual(canon(alone), { type: 'table', cols: [{ type: 'delta' }], rows: [[3]] });
});
