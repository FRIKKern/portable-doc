import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { applyOp, applyOps } from './ops/apply.js';
import { applyPatch } from './ops/patch.js';
import { project } from './ops/table.js';
import { digest } from './test/digest.mjs';
import { generator, intentGenerator } from './test/random-ops.mjs';

const recorded = JSON.parse(fs.readFileSync(new URL('./test/patch-elixir.json', import.meta.url), 'utf8'));

const dir = new URL('../../goldens/ops/', import.meta.url);
const goldens = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  .map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8')) }));

const text = (value) => [{ type: 'text', value }];
const para = (id, value = id) => ({ id, type: 'paragraph', content: text(value) });
const doc = (...blocks) => ({ title: 'T', blocks });
const ok = (r) => {
  assert.ok(r.ok, JSON.stringify(r.error));
  return r.value;
};
const refused = (r, code, target) => {
  assert.equal(r.ok, false, 'expected a refusal');
  assert.equal(r.error.code, code);
  if (target !== undefined) assert.deepEqual(r.error.target, target);
};

test('every op golden: before plus op gives exactly after, one golden per edit verb', () => {
  assert.deepEqual(goldens.map((g) => g.op.op).sort(), [
    'append-block', 'insert-after', 'move-block', 'patch-block', 'patch-card-body',
    'patch-table-cells', 'patch-table-structure', 'remove-block', 'replace-block',
  ]);
  for (const g of goldens) assert.deepEqual(ok(applyOp(g.before, g.op)), g.after, g.file);
});

test('every op golden also lands through a one-op batch, and the input is not mutated', () => {
  for (const g of goldens) {
    const before = structuredClone(g.before);
    assert.deepEqual(ok(applyOps(g.before, [g.op])), g.after, g.file);
    assert.deepEqual(g.before, before, g.file);
  }
});

test('a batch is all or nothing: the first refused op names its index and nothing applies', () => {
  const d = doc(para('a'), para('b'));
  const r = applyOps(d, [{ op: 'remove-block', id: 'a' }, { op: 'patch-block', id: 'nope', patch: {} }, { op: 'remove-block', id: 'b' }]);
  assert.deepEqual(r, { ok: false, index: 1, error: { code: 'block_not_found', target: 'nope', op: 'patch-block' } });
  assert.equal(d.blocks.length, 2);
  assert.deepEqual(ok(applyOps(d, [])), d);
});

test('ops thread: each op sees the result of the one before', () => {
  const r = ok(applyOps(doc(para('a')), [{ op: 'append-block', block: para('b') }, { op: 'move-block', id: 'b', after: null }]));
  assert.deepEqual(r.blocks.map((b) => b.id), ['b', 'a']);
});

test('a bare blocks array works like a doc', () => {
  assert.deepEqual(ok(applyOp([para('a')], { op: 'append-block', block: para('b') })).map((b) => b.id), ['a', 'b']);
});

test('ids resolve at any depth, through every container Patch walks', () => {
  const nested = doc(
    { id: 's', type: 'section', blocks: [para('in-section')] },
    { id: 'x', type: 'expandable', children: [para('in-expandable')] },
    { id: 'st', type: 'steps', steps: [{ id: 'row', blocks: [para('in-step')] }] },
    { id: 'tb', type: 'tabs', tabs: [{ label: 'a', blocks: [para('in-tab')] }] },
    { id: 'co', type: 'columns', columns: [[para('in-column')]] },
    { id: 'tm', type: 'terminal', children: [para('in-terminal')] },
    { id: 'fg', type: 'figure', child: { id: 'fc', type: 'section', blocks: [para('in-figure')] } },
  );
  for (const id of ['in-section', 'in-expandable', 'in-step', 'in-tab', 'in-column', 'in-terminal', 'in-figure']) {
    const after = ok(applyOp(nested, { op: 'patch-block', id, patch: { tone: 'x' } }));
    assert.match(JSON.stringify(after), new RegExp(`"id":"${id}","type":"paragraph","content":\\[[^\\]]*\\],"tone":"x"`), id);
  }
});

test('a hidden alias is not walked: an expandable with truthy children hides blocks, a terminal with blocks hides children', () => {
  const d = doc({ id: 'x', type: 'expandable', children: 'opaque', blocks: [para('hidden')] }, { id: 't', type: 'terminal', blocks: [], children: [para('hidden2')] });
  refused(applyOp(d, { op: 'patch-block', id: 'hidden', patch: {} }), 'block_not_found', 'hidden');
  refused(applyOp(d, { op: 'patch-block', id: 'hidden2', patch: {} }), 'block_not_found', 'hidden2');
});

test('patch-block merges shallowly and pins id and type; a different type is a mismatch; locked and role are dropped', () => {
  const after = ok(applyOp(doc(para('a')), { op: 'patch-block', id: 'a', patch: { id: 'z', content: text('new'), locked: true, role: 'title' } }));
  assert.deepEqual(after.blocks[0], { id: 'a', type: 'paragraph', content: text('new') });
  refused(applyOp(doc(para('a')), { op: 'patch-block', id: 'a', patch: { type: 'heading' } }), 'type_mismatch', 'a');
  assert.ok(applyOp(doc(para('a')), { op: 'patch-block', id: 'a', patch: { type: null } }).ok);
});

test('field patches coerce like Barkpark: boolean text, number text and range, select options', () => {
  const bool = ok(applyOp(doc({ id: 'f', type: 'field-boolean', value: false }), { op: 'patch-block', id: 'f', patch: { value: 'true' } }));
  assert.equal(bool.blocks[0].value, true);
  assert.equal(ok(applyOp(doc({ id: 'f', type: 'field-boolean', value: true }), { op: 'patch-block', id: 'f', patch: { value: 'false' } })).blocks[0].value, false);
  const num = { id: 'n', type: 'field-number', value: 2, min: 0, max: 10 };
  assert.deepEqual(ok(applyOp(doc(num), { op: 'patch-block', id: 'n', patch: { value: ' 7 ' } })).blocks[0], { ...num, value: 7 });
  assert.equal(ok(applyOp(doc(num), { op: 'patch-block', id: 'n', patch: { value: '2.5e0' } })).blocks[0].value, 2.5);
  assert.equal(ok(applyOp(doc(num), { op: 'patch-block', id: 'n', patch: { value: '' } })).blocks[0].value, null);
  for (const patch of [{ value: 0 }, { value: 10 }, { min: 2, max: 2 }, { value: '', min: 4, max: 4 }]) assert.ok(applyOp(doc(num), { op: 'patch-block', id: 'n', patch }).ok, JSON.stringify(patch));
  for (const patch of [{ value: 11 }, { value: 'seven' }, { min: 3 }, { max: 1 }, { step: 0 }, { value: '.5' }, { value: [] }, { value: '', min: 5, max: 3 }]) {
    refused(applyOp(doc(num), { op: 'patch-block', id: 'n', patch }), 'invalid_op');
  }
  refused(applyOp(doc({ id: 'n', type: 'field-number' }), { op: 'patch-block', id: 'n', patch: { value: 'seven' } }), 'invalid_op');
  const select = { id: 's', type: 'field-select' };
  assert.ok(applyOp(doc(select), { op: 'patch-block', id: 's', patch: { options: [{ value: 'a' }, { value: 'b', label: 'B' }] } }).ok);
  for (const options of [[{ value: 'a' }, { value: 'a' }], [{ value: '' }], [{ value: 'a', extra: 1 }], [{ value: 'a', label: null }], 'a']) {
    refused(applyOp(doc(select), { op: 'patch-block', id: 's', patch: { options } }), 'invalid_op');
  }
});

test('append and insert refuse an id already in the tree, nested included', () => {
  const d = doc({ id: 's', type: 'section', blocks: [para('deep')] });
  refused(applyOp(d, { op: 'append-block', block: para('deep') }), 'duplicate_id', 'deep');
  refused(applyOp(d, { op: 'insert-after', afterId: 's', block: para('deep') }), 'duplicate_id', 'deep');
  refused(applyOp(d, { op: 'insert-after', afterId: 'absent', block: para('new') }), 'block_not_found', 'absent');
  assert.deepEqual(ok(applyOp(d, { op: 'insert-after', afterId: 'deep', block: para('new') })).blocks[0].blocks.map((b) => b.id), ['deep', 'new']);
});

test('remove and move of an absent block are no-ops; move to an absent anchor is refused; move is top-level only', () => {
  const d = doc(para('a'), para('b'), { id: 's', type: 'section', blocks: [para('in')] });
  assert.deepEqual(ok(applyOp(d, { op: 'remove-block', id: 'gone' })), d);
  assert.deepEqual(ok(applyOp(d, { op: 'move-block', id: 'gone', after: 'a' })), d);
  assert.deepEqual(ok(applyOp(d, { op: 'move-block', id: 'in', after: 'a' })), d);
  assert.deepEqual(ok(applyOp(d, { op: 'move-block', id: 'a', after: 'a' })), d);
  refused(applyOp(d, { op: 'move-block', id: 'a', after: 'gone' }), 'block_not_found', 'gone');
  assert.deepEqual(ok(applyOp(d, { op: 'move-block', id: 'b' })).blocks.map((b) => b.id), ['b', 'a', 's']);
  assert.deepEqual(ok(applyOp(d, { op: 'move-block', id: 'a', after: 's' })).blocks.map((b) => b.id), ['b', 's', 'a']);
});

test('locked blocks hold: no remove, move, replace or displacement', () => {
  const d = doc({ ...para('title'), locked: true }, para('a'));
  refused(applyOp(d, { op: 'remove-block', id: 'title' }), 'locked_block', 'title');
  refused(applyOp(d, { op: 'move-block', id: 'title', after: 'a' }), 'locked_block', 'title');
  refused(applyOp(d, { op: 'replace-block', id: 'title', block: para('t2') }), 'locked_block', 'title');
  refused(applyOp(d, { op: 'move-block', id: 'a', after: null }), 'locked_block', 'title');
  refused(applyOp(doc(para('a'), { ...para('l'), locked: true }), { op: 'insert-after', afterId: 'a', block: para('n') }), 'locked_block', 'l');
  assert.ok(applyOp(d, { op: 'insert-after', afterId: 'a', block: para('n') }).ok);
  refused(applyOp(doc({ id: 's', type: 'section', blocks: [{ ...para('in'), locked: true }] }), { op: 'remove-block', id: 'in' }), 'locked_block', 'in');
  const pair = doc({ ...para('a'), locked: true }, { ...para('b'), locked: true }, para('c'));
  assert.ok(applyOp(pair, { op: 'patch-block', id: 'c', patch: { tone: 'x' } }).ok);
  refused(applyOp(pair, { op: 'insert-after', afterId: 'a', block: para('n') }), 'locked_block', 'b');
  const nested = doc(para('a'), { id: 's', type: 'section', blocks: [para('x')] }, { ...para('l'), locked: true });
  refused(applyOp(nested, { op: 'insert-after', afterId: 'a', block: para('x') }), 'duplicate_id', 'x');
});

test('a figure keeps exactly one child', () => {
  const d = doc({ id: 'f', type: 'figure', child: para('c') });
  refused(applyOp(d, { op: 'remove-block', id: 'c' }), 'constraint');
  refused(applyOp(d, { op: 'insert-after', afterId: 'c', block: para('n') }), 'constraint');
  refused(applyOp(d, { op: 'replace-block', id: 'c', block: 'text' }), 'constraint');
  assert.equal(ok(applyOp(d, { op: 'replace-block', id: 'c', block: para('c2') })).blocks[0].child.id, 'c2');
});

test('the duplicate ratchet refuses a replace that adds a second copy of an id anywhere', () => {
  const d = doc(para('a'), { id: 'st', type: 'steps', steps: [{ id: 'row' }] });
  refused(applyOp(d, { op: 'replace-block', id: 'a', block: para('row') }), 'duplicate_id', 'row');
  const legacy = doc(para('dup'), para('dup'));
  assert.ok(applyOp(legacy, { op: 'patch-block', id: 'dup', patch: { tone: 'x' } }).ok, 'existing duplicates stay editable');
});

test('the ratchet counts an id that is new and doubled inside one block; a displaced locked block is named before a duplicate', () => {
  const twins = { id: 's', type: 'section', blocks: [para('n'), para('n')] };
  refused(applyOp(doc(para('a')), { op: 'append-block', block: twins }), 'duplicate_id', 'n');
  const both = doc(para('a'), { ...para('l'), locked: true });
  refused(applyOp(both, { op: 'insert-after', afterId: 'a', block: { id: 's', type: 'section', blocks: [para('a')] } }), 'locked_block', 'l');
});

test('a doc without a blocks array is invalid_doc for every op; a bare blocks array is a doc', () => {
  const body = text('x');
  for (const d of [{}, { blocks: 'x' }, { blocks: null }]) {
    for (const op of [{ op: 'remove-block', id: 'a' }, { op: 'patch-card-body', id: 'k', content: body }, { op: 'patch-table-cells', id: 'tb', shape: {}, cells: [] }]) {
      assert.deepEqual(applyOp(d, op), { ok: false, error: { code: 'invalid_doc', target: null, op: op.op } });
    }
  }
  assert.deepEqual(ok(applyOp([{ id: 'k', type: 'card' }], { op: 'patch-card-body', id: 'k', content: body }))[0].slots.body, [{ type: 'paragraph', content: body }]);
});

test('a malformed op is invalid_op and echoes the op', () => {
  for (const op of [null, 'x', [], {}, { op: 'nope' }, { op: 'append-block' }, { op: 'insert-after', block: {} }, { op: 'patch-block', id: 'a', patch: 'x' }, { op: 'patch-block', patch: {} }, { op: 'replace-block', id: 'a' }, { op: 'remove-block' }, { op: 'move-block' }]) {
    const r = applyOp(doc(para('a')), op);
    refused(r, 'invalid_op');
    assert.deepEqual(r.error.op, op);
  }
});

test('a patch-block that lands on a non-object block is refused (Barkpark raises here)', () => {
  refused(applyOp(doc('stray'), { op: 'patch-block', id: null, patch: {} }), 'invalid_op');
});

const card = (slots) => ({ id: 'k', type: 'card', slots });

test('patch-card-body lowers to a patch-block of the body slot', () => {
  const body = [{ type: 'strong', children: text('bold') }];
  assert.deepEqual(ok(applyOp(doc(card({})), { op: 'patch-card-body', id: 'k', content: body })).blocks[0].slots, { body: [{ type: 'paragraph', content: body }] });
  const kept = card({ body: [{ type: 'paragraph', content: text('old'), align: 'left' }], title: [{ type: 'heading', text: 'T' }] });
  assert.deepEqual(ok(applyOp(doc(kept), { op: 'patch-card-body', id: 'k', content: body })).blocks[0].slots.body, [{ type: 'paragraph', content: body, align: 'left' }]);
  refused(applyOp(doc(card({})), { op: 'patch-card-body', id: 'nope', content: body }), 'block_not_found', 'nope');
  refused(applyOp(doc(para('k')), { op: 'patch-card-body', id: 'k', content: body }), 'type_mismatch', 'k');
  refused(applyOp(doc(card({}), card({})), { op: 'patch-card-body', id: 'k', content: body }), 'duplicate_id', 'k');
  for (const op of [
    { op: 'patch-card-body', id: 'k', content: [{ type: 'text', value: '' }] },
    { op: 'patch-card-body', id: 'k', content: [{ type: 'em', children: [{ type: 'strong', children: text('x') }] }] },
    { op: 'patch-card-body', id: 'k', content: body, extra: 1 },
    { op: 'patch-card-body', id: 'k', content: [{ type: 'valueref', target: 't', field: 'f', as: null }] },
    { op: 'patch-card-body', id: '', content: body },
    { op: 'patch-card-body', id: 'k' },
  ]) refused(applyOp(doc(card({})), op), 'invalid_op');
  refused(applyOp(doc(card({ media: [{ type: 'video' }] })), { op: 'patch-card-body', id: 'k', content: body }), 'invalid_op');
  refused(applyOp(doc(card('slots')), { op: 'patch-card-body', id: 'k', content: body }), 'invalid_op');
});

test('patch-card-body reads the card the strict way (each slot holds at most one element of its kind, text fields are text or null) and finds it in every container', () => {
  const body = text('new');
  const run = (c) => applyOp(doc(c), { op: 'patch-card-body', id: 'k', content: body });
  for (const slots of [
    { body: [{ type: 'paragraph' }] },
    { body: [{ type: 'paragraph', content: null }] },
    { body: [{ type: 'paragraph', content: [{ type: 'text', value: '' }] }] },
    { body: null, title: [], media: [{ src: 's', alt: null }], action: [{ type: 'action', label: 'Go', href: null, priority: 'high' }] },
    { title: [{ type: 'heading', text: null }], media: [{ type: null }] },
  ]) assert.ok(run(card(slots)).ok, JSON.stringify(slots));
  assert.ok(run({ id: 'k', type: 'card', slots: null, tone: null }).ok);
  assert.ok(run({ id: 'k', type: 'card' }).ok);
  assert.ok(applyOp(doc({ id: 'e', type: 'expandable', children: [card({})] }), { op: 'patch-card-body', id: 'k', content: body }).ok);
  for (const children of [null, false, undefined]) {
    const box = { id: 'e', type: 'expandable', ...(children === undefined ? {} : { children }), blocks: [card({})] };
    assert.ok(applyOp(doc(box), { op: 'patch-card-body', id: 'k', content: body }).ok, String(children));
  }
  refused(applyOp(doc({ id: 'e', type: 'expandable', children: 'x', blocks: [card({})] }), { op: 'patch-card-body', id: 'k', content: body }), 'block_not_found', 'k');
  assert.ok(applyOp(doc({ id: 'cols', type: 'columns', columns: ['x', [card({})]] }), { op: 'patch-card-body', id: 'k', content: body }).ok);
  for (const box of [
    { id: 'b', type: 'section', blocks: [card({})] },
    { id: 'b', type: 'steps', steps: [{ id: 's1', children: [card({})] }] },
    { id: 'b', type: 'tabs', tabs: [{ id: 't1', blocks: [card({})] }] },
    { id: 'b', type: 'figure', child: card({}) },
  ]) assert.ok(applyOp(doc(null, box), { op: 'patch-card-body', id: 'k', content: body }).ok, box.type);
  for (const c of [
    card({ body: [{ type: 'paragraph', content: [{ type: 'text', value: 'a', marks: [] }] }] }),
    card({ body: [{ type: 'paragraph', content: 'x' }] }),
    card({ body: [{ type: 'paragraph' }, { type: 'paragraph' }] }),
    card({ body: ['x'] }),
    card({ body: 'x' }),
    card({ title: [{ type: 'heading', text: 5 }] }),
    card({ title: [{ type: 'paragraph' }] }),
    card({ media: [{ type: 'image', alt: 1 }] }),
    card({ action: [{ type: 'action', priority: 2 }] }),
    card({ action: [{ type: 'link' }] }),
    { ...card({}), tone: 3 },
  ]) refused(run(c), 'invalid_op');
});

const grid = (rows, extra = {}) => ({ id: 'tb', type: 'table', rows, ...extra });
const shapeOf = (table) => project(table).shape;

test('patch-table-cells writes through the stored carriers and refuses a stale shape or a bad change list', () => {
  const t = grid([[text('a'), { content: text('b'), id: 'cb' }], { id: 'r2', cells: [text('c'), text('d')] }], { head: [text('H1'), text('H2')] });
  const cells = [{ area: 'head', row: 0, column: 1, content: text('H') }, { area: 'body', row: 0, column: 1, content: text('B') }, { area: 'body', row: 1, column: 0, content: [] }];
  const after = ok(applyOp(doc(t), { op: 'patch-table-cells', id: 'tb', shape: shapeOf(t), cells })).blocks[0];
  assert.deepEqual(after, grid([[text('a'), { content: text('B'), id: 'cb' }], { id: 'r2', cells: [[], text('d')] }], { head: [text('H1'), text('H')] }));
  const op = (over) => ({ op: 'patch-table-cells', id: 'tb', shape: shapeOf(t), cells, ...over });
  refused(applyOp(doc(t), op({ shape: { ...shapeOf(t), v: 2 } })), 'invalid_op');
  refused(applyOp(doc(t), op({ cells: [cells[1], cells[0]] })), 'invalid_op');
  refused(applyOp(doc(t), op({ cells: [cells[1], cells[1]] })), 'invalid_op');
  refused(applyOp(doc(t), op({ cells: [{ area: 'body', row: 2, column: 0, content: [] }] })), 'invalid_op');
  refused(applyOp(doc(t), op({ cells: [{ area: 'head', row: 1, column: 0, content: [] }] })), 'invalid_op');
  refused(applyOp(doc(t), op({ cells: [{ area: 'body', row: 0, column: 0, content: text('x'), extra: 1 }] })), 'invalid_op');
  refused(applyOp(doc(t), op({ cells: [{ area: 'body', row: 0, column: 0, content: [...text('x'), ...text('y')] }] })), 'invalid_op');
  for (const bad of [null, 5, 'x', [cells[1], null], [{ area: 'body', row: 0, column: -1, content: [] }], [{ area: 'body', row: 0, column: 0.5, content: [] }]]) {
    refused(applyOp(doc(t), op({ cells: bad })), 'invalid_op');
  }
  for (const change of [{ row: 0, column: '1' }, { row: '0', column: 1 }, { row: 0, column: 2 }]) {
    refused(applyOp(doc(t), op({ cells: [{ area: 'body', content: [], ...change }] })), 'invalid_op');
  }
  refused(applyOp(doc(t), op({ extra: 1 })), 'invalid_op');
});

test('a table intent leaves an absent head absent and a null head null', () => {
  for (const extra of [{}, { head: null }]) {
    const t = grid([[text('a')]], extra);
    const after = ok(applyOp(doc(t), { op: 'patch-table-cells', id: 'tb', shape: shapeOf(t), cells: [{ area: 'body', row: 0, column: 0, content: text('b') }] })).blocks[0];
    assert.deepEqual(after, grid([[text('b')]], extra));
  }
});

test('patch-table-structure runs every action and refuses one out of range', () => {
  const t = grid([[text('a'), text('b')], [text('c'), text('d')]], { head: [text('x'), text('y')] });
  const run = (action, table = t) => applyOp(doc(table), { op: 'patch-table-structure', id: 'tb', shape: shapeOf(table), action });
  const rows = (action, table) => ok(run(action, table)).blocks[0];
  assert.equal(rows('add-row').rows.length, 3);
  assert.deepEqual(rows('add-column').head, [text('x'), text('y'), []]);
  assert.deepEqual(rows('remove-row:0').rows, [[text('c'), text('d')]]);
  assert.deepEqual(rows('up-row:1').rows[0], [text('c'), text('d')]);
  assert.deepEqual(rows('down-row:0').rows[0], [text('c'), text('d')]);
  assert.deepEqual(rows('remove-column:0').rows, [[text('b')], [text('d')]]);
  assert.deepEqual(rows('left-column:1').head, [text('y'), text('x')]);
  assert.deepEqual(rows('right-column:0').rows[1], [text('d'), text('c')]);
  assert.deepEqual(rows('remove-header').head, []);
  assert.deepEqual(rows('add-header', grid([[text('a')]])).head, [[]]);
  for (const action of ['up-row:0', 'down-row:1', 'remove-row:2', 'left-column:0', 'right-column:1', 'remove-column:2', 'left-column:2', 'up-row:2', 'add-header', 'remove-row:01', 'remove-row:', 'nope', 3]) refused(run(action), 'invalid_op');
  refused(run('remove-header', grid([[text('a')]])), 'invalid_op');
  refused(run('remove-row:0', grid([[text('a')]])), 'invalid_op');
});

test('table intents refuse a table outside the strict grammar, a duplicate id anywhere, or another table the write would migrate', () => {
  const t = grid([[text('a')]]);
  const run = (blocks, shape = shapeOf(t)) => applyOp(doc(...blocks), { op: 'patch-table-structure', id: 'tb', shape, action: 'add-row' });
  assert.ok(run([t]).ok);
  refused(run([t, para('p'), { id: 'st', type: 'steps', steps: [{ id: 'p' }] }]), 'duplicate_id', 'p');
  for (const box of [
    { id: 'x', type: 'tabs', tabs: [{ id: 'tab', blocks: [para('p')] }] },
    { id: 'x', type: 'expandable', children: [para('p')] },
    { id: 'x', type: 'terminal', children: [para('p')] },
    { id: 'x', type: 'columns', columns: [[para('p')]] },
    { id: 'x', type: 'figure', child: para('p') },
  ]) refused(run([t, para('p'), box]), 'duplicate_id', 'p');
  refused(run([t, { id: 'old', type: 'table', rows: [[{ type: 'text', text: 'tiptap' }]] }]), 'table_normalization_would_change_authored_data');
  refused(run([t, { type: 'table', rows: [[text('no id')]] }]), 'table_normalization_would_change_authored_data');
  refused(run([grid([[text('a')]], { columns: [] })], {}), 'table_normalization_would_change_authored_data');
  refused(run([grid([{ cells: [text('a')] }])], {}), 'table_normalization_would_change_authored_data');
  refused(run([grid([[{ content: text('a') }]])], {}), 'table_normalization_would_change_authored_data');
  refused(run([grid([[text('a')], [text('a'), text('b')]])], {}), 'invalid_op');
  refused(run([grid([[[{ type: 'text', value: 'a', note: 'opaque' }]]])], {}), 'table_normalization_would_change_authored_data');
  refused(run([{ ...t, id: ' tb' }]), 'invalid_op');
  refused(run([para('tb')]), 'invalid_op');
  refused(applyOp(doc(t, para('p')), { op: 'patch-table-structure', id: 'p', shape: shapeOf(t), action: 'add-row' }), 'invalid_op');
});

function sweep(next, n) {
  const outcomes = new Map();
  const docs = new Set();
  const cases = new Set();
  for (let i = 0; i < n; i++) {
    const { doc: d, op } = next();
    docs.add(JSON.stringify(d));
    cases.add(JSON.stringify([d, op]));
    const before = JSON.stringify(d);
    const r = applyOp(d, op);
    assert.equal(JSON.stringify(d), before, 'input mutated');
    assert.equal(typeof r.ok, 'boolean');
    const label = r.ok ? 'ok' : r.error.code;
    outcomes.set(label, (outcomes.get(label) ?? 0) + 1);
  }
  return { outcomes, docs: docs.size, cases: cases.size };
}

test('3000 random docs and Patch ops never throw or mutate, and reach every outcome', () => {
  const { outcomes, docs, cases } = sweep(generator(20261101), 3000);
  assert.ok(docs >= 2500 && cases >= 2950, `only ${docs} distinct docs, ${cases} distinct cases`);
  assert.deepEqual([...outcomes.keys()].sort(), ['block_not_found', 'constraint', 'duplicate_id', 'invalid_op', 'locked_block', 'ok', 'type_mismatch']);
});

test('3000 random cards, tables and editor intents never throw or mutate, and reach every outcome', () => {
  const { outcomes, docs, cases } = sweep(intentGenerator(20261101), 3000);
  assert.ok(docs >= 2500 && cases >= 2950, `only ${docs} distinct docs, ${cases} distinct cases`);
  assert.deepEqual([...outcomes.keys()].sort(), ['block_not_found', 'duplicate_id', 'invalid_op', 'ok', 'table_normalization_would_change_authored_data', 'type_mismatch']);
});

test(`${recorded.answers.length} seeded Patch cases answer what Barkpark's patch.ex (${recorded.barkpark}) answered; where it raised, invalid_op`, () => {
  const next = generator(recorded.seed);
  const misses = recorded.answers.flatMap((answer, i) => {
    const { doc, op } = next();
    const ours = applyPatch(doc, op);
    const got = answer === 'raised' ? (ours.ok ? 'ok' : ours.error.code) : digest(ours);
    return got === (answer === 'raised' ? 'invalid_op' : answer) ? [] : [i];
  });
  assert.deepEqual(misses.slice(0, 5), [], 'rerun differential.mjs with this seed to see the cases');
});
