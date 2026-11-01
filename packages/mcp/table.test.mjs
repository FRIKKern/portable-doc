import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAction, project, stable } from './ops/table.js';

const text = (value) => [{ type: 'text', value }];
const table = (extra) => ({ id: 'tb', type: 'table', rows: [[text('a'), text('b')]], ...extra });

test('project reads every carrier and head state into its shape', () => {
  assert.deepEqual(project(table()).shape, { v: 1, head: { state: 'absent' }, rows: [{ kind: 'array', cells: ['inline-array', 'inline-array'] }] });
  assert.deepEqual(project(table({ head: null })).shape.head, { state: 'null' });
  assert.deepEqual(project(table({ head: [] })).shape.head, { state: 'empty' });
  assert.deepEqual(project(table({ head: [text('x'), []] })).shape.head, { state: 'row', row: { kind: 'array', cells: ['inline-array', 'inline-array'] } });
  const mixed = project(table({ rows: [{ id: 'r', cells: [{ id: 'c', content: text('a') }, text('b')] }] }));
  assert.deepEqual(mixed.shape.rows, [{ kind: 'cells-map', cells: ['content-map', 'inline-array'] }]);
  assert.deepEqual(mixed.rows, [[text('a'), text('b')]]);
});

test('project refuses every shape outside the strict editable grammar', () => {
  for (const t of [
    null, [], table({ type: 'list' }), table({ id: '' }), table({ id: 'tb ' }), table({ id: 7 }),
    table({ rows: [] }), table({ rows: 'x' }), table({ rows: [[]] }), table({ rows: [[text('a')], [text('a'), text('b')]] }),
    table({ head: [text('x')] }), table({ head: 'x' }), table({ head: [['bad']] }),
    table({ content: [] }), table({ header: true }), table({ headers: [] }), table({ columns: [] }), table({ blocks: [] }), table({ children: [] }),
    table({ rows: [{ cells: [text('a'), text('b')] }] }), table({ rows: [{ id: 'r', header: false, cells: [text('a'), text('b')] }] }),
    table({ rows: [{ id: 'r' }] }), table({ rows: ['row'] }),
    table({ rows: [[{ content: text('a') }, text('b')]] }), table({ rows: [[{ content: text('a'), header: true, id: 'c' }, text('b')]] }),
    table({ rows: [[{ content: text('a'), type: 'tableHeader' }, text('b')]] }), table({ rows: [[{ content: text('a'), type: 'table_header' }, text('b')]] }),
    table({ rows: [[{ id: 'c', content: 'x' }, text('b')]] }), table({ rows: [['bare', text('b')]] }), table({ rows: [[null, text('b')]] }), table({ rows: [[{ id: 'c', note: 1 }, text('b')]] }),
  ]) assert.equal(project(t), null, JSON.stringify(t));
  assert.ok(project(table({ blocks: 'opaque', children: null })));
});

test('stable: a table the write normalizer would leave alone; a table with no rows is stable, rows that are not a list are not', () => {
  assert.equal(stable(table()), true);
  assert.equal(stable({ id: 'tb', type: 'table' }), true);
  assert.equal(stable(table({ rows: [[text('a')], [text('a'), text('b')]] })), true);
  assert.equal(stable(table({ head: null })), true);
  assert.equal(stable(table({ head: [] })), true);
  assert.equal(stable(table({ head: [text('x')] })), true);
  for (const t of [
    table({ id: '' }), { type: 'table', rows: [] }, table({ rows: 'x' }), table({ head: 'x' }), table({ head: [['bad']] }),
    table({ columns: [] }), table({ children: [] }), table({ rows: [{ cells: [text('a')] }] }), table({ rows: [[{ content: text('a') }]] }),
    table({ rows: [[[{ type: 'text', text: 'tiptap' }]]] }),
  ]) assert.equal(stable(t), false, JSON.stringify(t));
});

test('parseAction: plain names, kind:index with a canonical safe index of at most 16 digits', () => {
  for (const a of ['add-row', 'add-column', 'add-header', 'remove-header']) assert.deepEqual(parseAction(a), { kind: a, index: null });
  assert.deepEqual(parseAction('remove-row:0'), { kind: 'remove-row', index: 0 });
  assert.deepEqual(parseAction('right-column:12'), { kind: 'right-column', index: 12 });
  assert.deepEqual(parseAction('up-row:1234567890123456'), { kind: 'up-row', index: 1234567890123456 });
  for (const a of ['add-row:1', 'remove-row', 'remove-row:', 'remove-row:01', 'remove-row:-1', 'remove-row:1.5', 'remove-row: 1', 'remove-row:12345678901234567', 'remove-row:9999999999999999', 'nope:1', ':1', 1, null, ['add-row']]) {
    assert.equal(parseAction(a), null, String(a));
  }
});
