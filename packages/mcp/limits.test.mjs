import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DEPTH, MAX_NODES, measure } from './limits.js';
import { applyOps } from './ops/apply.js';
import { project } from './ops/table.js';
import { callTool } from './tools.js';

const nest = (levels) => Array.from({ length: levels - 1 }).reduce((v) => [v], 0);

test(`measure: ${MAX_NODES} JSON values and ${MAX_DEPTH} levels are in, one more is over`, () => {
  assert.equal(measure(Array(MAX_NODES - 1).fill(0)).over, null);
  assert.equal(measure(Array(MAX_NODES).fill(0)).over, 'nodes');
  assert.deepEqual(measure(nest(MAX_DEPTH)), { nodes: MAX_DEPTH, depth: MAX_DEPTH, over: null });
  assert.equal(measure(nest(MAX_DEPTH + 1)).over, 'depth');
});

const TEXT = [{ type: 'text', value: 'x' }];
const SHAPE = { v: 1, head: { state: 'absent' }, rows: [{ kind: 'array', cells: ['inline-array'] }] };
const TABLE = { id: 't', type: 'table', rows: [[TEXT]] };
const sections = (levels, blocks) => Array.from({ length: levels }).reduce((inner) => [{ type: 'section', blocks: inner }], blocks);
const repeat = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const wrap = (levels, blocks, key = 'o', type = 'paragraph') => Array.from({ length: levels }).reduce((inner) => [{ type, [key]: inner }], blocks);
const markChain = (levels) => Array.from({ length: levels }).reduce((inner) => ({ type: 'strong', children: [inner] }), { type: 'text', value: 'end' });
const wrapperChain = (levels) => Array.from({ length: levels }).reduce((inner) => ({ content: [inner, { type: 'text', text: 'w' }] }), { type: 'text', text: 'end' });
const WIDE = { ...TABLE, rows: [[TEXT, []]] };
const columnFlips = repeat(100, (i) => ({ op: 'patch-table-structure', id: 't', shape: project(i % 2 ? WIDE : TABLE).shape, action: i % 2 ? 'remove-column:1' : 'add-column' }));

const WORST = {
  'wide locked blocks': [{ blocks: repeat(60_000, (i) => ({ id: `b${i}`, locked: true })) }, repeat(5, (i) => ({ op: 'append-block', block: { id: `n${i}` } }))],
  'opaque tables that share the target id': [
    { blocks: [{ type: 'paragraph', junk: repeat(25_000, () => ({ id: 't', type: 'table', rows: [] })) }, ...repeat(45_000, (i) => ({ id: `p${i}` })), TABLE] },
    repeat(5, (i) => ({ op: 'patch-table-cells', id: 't', shape: SHAPE, cells: [{ area: 'body', row: 0, column: 0, content: [{ type: 'text', value: `v${i}` }] }] })),
  ],
  'many deep tables under every table edit': [{ blocks: [TABLE, ...wrap(480, repeat(60_000, (i) => ({ id: `q${i}`, type: 'table' })))] }, columnFlips],
  'many tables 480 sections deep under table edits': [{ blocks: [TABLE, ...wrap(480, repeat(60_000, (i) => ({ id: `q${i}`, type: 'table' })), 'blocks', 'section')] }, columnFlips.slice(0, 6)],
  'mark chains in tables, both 240 deep, under table edits': [{ blocks: [TABLE, ...wrap(240, repeat(240, (i) => ({ id: `q${i}`, type: 'table', rows: [[[markChain(240)]]] })), 'blocks', 'section')] }, columnFlips.slice(0, 6)],
  'wrapper chains in list items, both 240 deep, under table edits': [{ blocks: [TABLE, ...wrap(240, repeat(120, () => ({ type: 'list', items: [[wrapperChain(240)]] })), 'children', 'x')] }, columnFlips.slice(0, 6)],
  'a deep section chain': [{ blocks: sections(495, repeat(90_000, (i) => ({ id: `q${i}` }))) }, repeat(5, (i) => ({ op: 'remove-block', id: `q${i}` }))],
};

for (const [name, [doc, ops]] of Object.entries(WORST)) {
  test(`worst shape inside the limits answers in time: ${name}`, () => {
    const size = measure({ doc, ops });
    assert.equal(size.over, null);
    assert.ok(size.nodes > 140_000, `${size.nodes} values`);
    const started = Date.now();
    const result = applyOps(doc, ops);
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.ok(Date.now() - started < 3000, `${Date.now() - started} ms for ${ops.length} ops`);
  });
}

test('a table edit counts the JSON inside strings, which the normalizer decodes, against the limits; other ops do not', async () => {
  const json = (n) => `[${repeat(n, () => '{"type":"text","value":"v"}').join(',')}]`;
  const call = (string, op) => callTool({}, 'apply_ops', { doc: { blocks: [TABLE, { id: 'l', type: 'bulletList', content: [string] }] }, ops: [op] });
  const edit = { op: 'patch-table-structure', id: 't', shape: SHAPE, action: 'add-row' };
  const patch = { op: 'patch-block', id: 'l', patch: { tone: 'x' } };
  await assert.rejects(call(json(70_000), edit), /reads the JSON inside strings, and with it the arguments hold more than 200000 JSON values/);
  await assert.rejects(call(`${'['.repeat(MAX_DEPTH)}${']'.repeat(MAX_DEPTH)}`, edit), /reads the JSON inside strings, and with it the arguments nest deeper than 1000 JSON levels/);
  await assert.rejects(call(` \n${'['.repeat(MAX_DEPTH)}${']'.repeat(MAX_DEPTH)}`, edit), /nest deeper/);
  assert.equal((await call(`${'['.repeat(994)}${']'.repeat(994)}`, edit)).isError, undefined);
  await assert.rejects(call(`${'['.repeat(995)}${']'.repeat(995)}`, edit), /nest deeper than 1000/);
  assert.equal((await call(JSON.stringify(`${'['.repeat(MAX_DEPTH)}${']'.repeat(MAX_DEPTH)}`), edit)).isError, undefined, 'a JSON string literal stays a string');
  assert.equal((await call(json(60_000), edit)).isError, undefined);
  assert.equal((await call(json(70_000), patch)).isError, undefined);
  assert.equal((await call(`x${'['.repeat(MAX_DEPTH)}`, edit)).isError, undefined);
  assert.equal(measure({ s: json(3) }, { strings: true }).nodes, measure({ s: JSON.parse(json(3)) }).nodes + 1);
  assert.equal(measure({ s: json(3) }).nodes, 2);
});

const nearJson = (count, length) => Array.from({ length: count }, (_, i) => `[${'1,'.repeat((length - 12) / 2)}x${String(i).padStart(10, '0')}`);

for (const [name, block] of [
  ['one 10 MB string', { id: 'l', type: 'bulletList', content: nearJson(1, 10_000_012) }],
  ['700 same-length 20,000-char list items', { id: 'l', type: 'list', items: nearJson(700, 20_000) }],
  ['700 same-length 20,000-char legacy rows before a bad row', { id: 'l', type: 'table', content: [...nearJson(700, 20_000).map((s) => [s]), 5] }],
  ['700 same-length 20,000-char legacy head cells before a bad cell', { id: 'l', type: 'table', content: { head: [...nearJson(700, 20_000), {}], rows: [] } }],
  ['700 same-length 20,000-char cells in a declared header row', { id: 'l', type: 'table', header: true, rows: [{ content: [...nearJson(700, 20_000), {}], x: 1 }] }],
]) {
  test(`a JSON-looking string is read once per call, not once per table edit: ${name}`, () => {
    const doc = { blocks: [TABLE, block] };
    const started = Date.now();
    const result = applyOps(doc, columnFlips);
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.ok(Date.now() - started < 3000, `${Date.now() - started} ms for ${columnFlips.length} ops`);
  });
}
