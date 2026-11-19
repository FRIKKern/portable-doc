import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderPortableDocument } from '@portable-doc/react';
import { canon } from './golden-reads.mjs';
import { toMarkdown, toPlainText } from './index.js';
import { TABLE, absent, namesOf, readField, typesOf } from './read-aliases.js';

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
  // A value of a type the schema does not give the name is absent too.
  assert.deepEqual(readField({ type: 'heading', content: 'Hi', text: 'Yo' }, 'content'), { name: 'text', value: 'Yo' });
  assert.deepEqual(readField({ type: 'heading', content: 'Hi' }, 'content'), { name: 'content', value: 'Hi' });
  assert.deepEqual(readField({ type: 'code', value: 7, code: 'x' }, 'value'), { name: 'code', value: 'x' });
  assert.deepEqual(readField({ type: 'code', code: 7 }, 'value'), { name: 'value', value: undefined });
});

test('each name\'s types are read from spec/blocks.schema.json: every name of every aliased field has some, and a name the schema leaves out takes those of its field\'s other names', () => {
  for (const { to } of Object.values(TABLE.aliases)) {
    const [type, field] = to.split('.');
    for (const name of namesOf(type, field)) assert.ok(typesOf(type, name)?.length, `${type}.${name}`);
  }
  assert.deepEqual(typesOf('heading', 'content'), ['array']);
  assert.deepEqual(typesOf('heading', 'text'), ['string']);
  assert.deepEqual(typesOf('table', 'header'), ['boolean', 'array']);
  // Not declared in the schema: posterAt (new) and language (never in the spec).
  assert.deepEqual(typesOf('asciicast', 'posterAt'), typesOf('asciicast', 'poster'));
  assert.deepEqual(typesOf('code', 'language'), typesOf('code', 'lang'));
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
  // The type clause: a value of a type the schema does not give the name is absent, so an old
  // name of the right type wins over it. blockquote cite 7 used to show 7.
  [{ type: 'blockquote', content: t('q'), cite: 7, attribution: 'Ann' }, '<cite class="bp-blockquote__cite">Ann</cite>', '> q\n>\n> — Ann\n', '“q”\n— Ann\n'],
  // code value 7 used to show 7.
  [{ type: 'code', value: 7, code: 'x' }, '<pre class="bp-codeblock">x</pre>', '```\nx\n```\n', 'x\n'],
  // code lang 7 used to name the fence 7.
  [{ type: 'code', value: 'x', lang: 7, language: 'py' }, '<pre class="bp-codeblock">x</pre>', '```py\nx\n```\n', 'x\n'],
  // expandable blocks 'x' used to leave the body empty.
  [{ type: 'expandable', summary: 'S', blocks: 'x', children: kid }, '<div class="bp-expandable__body"><p>kid</p></div>', '**S**\n\nkid\n', 'S\n\nkid\n'],
  // terminal children 'x' used to leave the body empty.
  [{ type: 'terminal', title: 'T', children: 'x', blocks: kid }, '<div class="bp-term__body"><p>kid</p></div>', '**T**\n\nkid\n', 'T\n\nkid\n'],
  // table head 'x' used to leave no head row.
  [{ type: 'table', head: 'x', header: [t('H')], rows: [[t('r')]] }, '<th class="bp-table__th"><span>H</span></th>', '| H |\n| --- |\n| r |\n', 'H\n-\nr\n'],
  // A number under an old name of string type, alone, is absent; renderers used to show its digits.
  [{ type: 'heading', text: 7 }, '<h2></h2>', '', ''],
  [{ type: 'code', code: 7 }, '', '```\n```\n', ''],
  [{ type: 'blockquote', content: t('q'), attribution: 7 }, '<blockquote class="bp-blockquote"><p>q</p></blockquote>', '> q\n', '“q”\n'],
  [{ type: 'code', value: 'x', language: 7 }, '<pre class="bp-codeblock">x</pre>', '```\nx\n```\n', 'x\n'],
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

test('a current name of a type the schema does not give it, read because no name holds a value of its type, shows what it showed before in every renderer and compares as it is', () => {
  // HTML, Markdown and text as main renders them; canon keeps the block as it is.
  const term = (body) => `<div class="bp-term"><div class="bp-term__bar"><span class="bp-term__dots"><i></i><i></i><i></i></span><span class="bp-term__title">T</span></div><div class="bp-term__body">${body}</div></div>`;
  const BEFORE = [
    [{ type: 'heading', content: 'Hi' }, '<h2></h2>', '', ''],
    [{ type: 'paragraph', content: 'Hi' }, '', '', ''],
    [{ type: 'callout', content: 'Hi' }, '<div class="bp-callout bp-callout--info"><span></span></div>', '> **Info**\n', 'Info\n'],
    [{ type: 'expandable', summary: 'S', blocks: 'x' }, '<details class="bp-expandable"><summary>S</summary><div class="bp-expandable__body"></div></details>', '**S**\n', 'S\n'],
    [{ type: 'terminal', title: 'T', children: 'x' }, term(''), '**T**\n', 'T\n'],
    [{ type: 'table', head: 'x', rows: [[t('r')]] }, '<table role="presentation" class="bp-table"><tbody><tr><td class="bp-table__td"><span>r</span></td></tr></tbody></table>', '| |\n| --- |\n| r |\n', 'r\n'],
    [{ type: 'code', value: 7 }, '<pre class="bp-codeblock">7</pre>', '```\n7\n```\n', '7\n'],
  ];
  for (const [block, h, markdown, plain] of BEFORE) {
    const label = JSON.stringify(block);
    assert.equal(html(block), h, label);
    assert.equal(md(block), markdown, label);
    assert.equal(text(block), plain, label);
    assert.deepEqual(canon(block), Object.fromEntries(Object.entries(block).map(([k, v]) => [k, Array.isArray(v) ? canon(v) : v])), label);
  }
});

test('a heading whose content is a string beside a text reads the text, as before, in every renderer and in canon', () => {
  const block = { type: 'heading', content: 'Hi', text: 'Yo' };
  assert.equal(html(block), '<h2>Yo</h2>');
  assert.equal(md(block), '## Yo\n');
  assert.equal(text(block), 'Yo\n');
  assert.deepEqual(canon(block), canon({ type: 'heading', content: t('Yo') }));
});
