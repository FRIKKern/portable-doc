import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_ARGS_DEPTH, MAX_NODES, measure } from './limits.js';
import { MAX_ERRORS, MAX_VALUE_DEPTH, validate, walkDepth } from '@portable-doc/validate';
import { applyOps } from './ops/apply.js';
import { ensureIds, normalizeRenderShapes } from './ops/persist.js';
import { project } from './ops/table.js';
import { callTool } from './tools.js';

const nest = (levels) => Array.from({ length: levels }).reduce((v) => [v], 0);

// CPU time, not wall time: on a loaded machine wall time measures the queue. 3656 ms of wall was 656 of CPU.
function underBudget(limitMs, work) {
  const started = process.cpuUsage();
  const result = work();
  const { user, system } = process.cpuUsage(started);
  const used = Math.round((user + system) / 1000);
  assert.ok(used < limitMs, `${used} ms of CPU, budget ${limitMs} ms`);
  return result;
}

test('the budget fails on work that burns CPU and ignores time spent waiting', () => {
  const spin = (ms) => { const started = process.cpuUsage(); while (process.cpuUsage(started).user < ms * 1000); };
  assert.throws(() => underBudget(50, () => spin(100)), /ms of CPU, budget 50 ms/);
  underBudget(50, () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100));
});

test(`measure: ${MAX_NODES} JSON values and ${MAX_ARGS_DEPTH} levels are in, one more is over`, () => {
  assert.equal(measure(Array(MAX_NODES - 1).fill(0)).over, null);
  assert.equal(measure(Array(MAX_NODES).fill(0)).over, 'nodes');
  assert.deepEqual(measure(nest(MAX_ARGS_DEPTH)), { nodes: MAX_ARGS_DEPTH + 1, depth: MAX_ARGS_DEPTH, over: null });
  assert.equal(measure(nest(MAX_ARGS_DEPTH + 1)).over, 'depth');
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
    const result = underBudget(3000, () => applyOps(doc, ops));
    assert.ok(result.ok, JSON.stringify(result.error));
  });
}

test('a doc nested exactly MAX_VALUE_DEPTH levels fits the argument limit of render and apply_ops; one level more does not', async () => {
  // The deepest container sits at level n of the doc; it holds a scalar, or a {k: "v"}, or nothing.
  const leaves = { empty: [], number: [1], string: ['s'], object: [{ k: 'v' }] };
  const deep = (n, leaf) => Array.from({ length: n - 6 }).reduce((v) => [v], leaf);
  const doc = (n, leaf) => ({ blocks: [{ type: 'chart', series: [{ x: deep(n, leaf) }] }] });
  for (const [name, leaf] of Object.entries(leaves)) {
    const at = name === 'object' ? MAX_VALUE_DEPTH - 1 : MAX_VALUE_DEPTH;
    assert.equal(validate(doc(at, leaf)).ok, true, name);
    assert.equal(measure(doc(at, leaf)).depth, MAX_VALUE_DEPTH, name);
    const text = await callTool({}, 'render', { doc: doc(at, leaf), format: 'text' });
    assert.equal(text.isError, undefined, name);
    const ops = await callTool({}, 'apply_ops', { doc: doc(at, leaf), ops: [] });
    assert.equal(ops.isError, undefined, name);
    assert.equal(validate(doc(at + 1, leaf)).ok, false, name);
    await assert.rejects(callTool({}, 'render', { doc: doc(at + 1, leaf), format: 'text' }), /nest deeper/, name);
    await assert.rejects(callTool({}, 'apply_ops', { doc: doc(at + 1, leaf), ops: [] }), /nest deeper/, name);
  }
});

test('a table edit counts the JSON inside strings, which the normalizer decodes, against the limits; other ops do not', async () => {
  const json = (n) => `[${repeat(n, () => '{"type":"text","value":"v"}').join(',')}]`;
  const call = (string, op) => callTool({}, 'apply_ops', { doc: { blocks: [TABLE, { id: 'l', type: 'bulletList', content: [string] }] }, ops: [op] });
  const edit = { op: 'patch-table-structure', id: 't', shape: SHAPE, action: 'add-row' };
  const patch = { op: 'patch-block', id: 'l', patch: { tone: 'x' } };
  await assert.rejects(call(json(70_000), edit), /reads the JSON inside strings, and with it the arguments hold more than 200000 JSON values/);
  await assert.rejects(call(`${'['.repeat(MAX_ARGS_DEPTH)}${']'.repeat(MAX_ARGS_DEPTH)}`, edit), new RegExp(`reads the JSON inside strings, and with it the arguments nest deeper than ${MAX_ARGS_DEPTH} JSON levels`));
  await assert.rejects(call(` \n${'['.repeat(MAX_ARGS_DEPTH)}${']'.repeat(MAX_ARGS_DEPTH)}`, edit), /nest deeper/);
  assert.equal((await call(JSON.stringify(`${'['.repeat(MAX_ARGS_DEPTH)}${']'.repeat(MAX_ARGS_DEPTH)}`), edit)).isError, undefined, 'a JSON string literal stays a string');
  assert.equal((await call(json(60_000), edit)).isError, undefined);
  assert.equal((await call(json(70_000), patch)).isError, undefined);
  assert.equal((await call(`x${'['.repeat(MAX_ARGS_DEPTH)}`, edit)).isError, undefined);
  assert.equal(measure({ s: json(3) }, { strings: true }).nodes, measure({ s: JSON.parse(json(3)) }).nodes + 1);
  assert.equal(measure({ s: json(3) }).nodes, 2);
  assert.equal(measure({ s: '[[1]]' }, { strings: true }).depth, 3, 'the decoded value takes the string\'s place');
  assert.equal(measure({ s: '[[1]]' }).depth, 1);
});

test('a table edit whose decoded string\'s deepest container lands exactly at the argument limit, counted at the string\'s place, is accepted, and one level more is refused', async () => {
  // The string sits at level 6: arguments 1, doc 2, blocks 3, the list 4, content 5, the item 6.
  // The normalizer puts the decoded value in the string's place, so n brackets reach level 5 + n.
  const n = MAX_ARGS_DEPTH - 5;
  const call = (levels) => callTool({}, 'apply_ops', {
    doc: { blocks: [TABLE, { id: 'l', type: 'bulletList', content: [`${'['.repeat(levels)}${']'.repeat(levels)}`] }] },
    ops: [{ op: 'patch-table-structure', id: 't', shape: SHAPE, action: 'add-row' }],
  });
  assert.equal((await call(n)).isError, undefined);
  await assert.rejects(call(n + 1), new RegExp(`nest deeper than ${MAX_ARGS_DEPTH}`));
});

test('a decoded map string counts one level down, where the normalizer wraps it: its deepest container exactly at the argument limit is accepted, one level more is refused', async () => {
  // The string sits at level 6. The normalizer swaps it for [map]: the list at 6, the map at 7, so k arrays in x reach 7 + k.
  const k = MAX_ARGS_DEPTH - 7;
  const blocks = (levels) => [TABLE, { id: 'l', type: 'bulletList', content: [`{"type":"text","value":"v","x":${'['.repeat(levels)}${']'.repeat(levels)}}`] }];
  const call = (levels) => callTool({}, 'apply_ops', { doc: { blocks: blocks(levels) }, ops: [{ op: 'patch-table-structure', id: 't', shape: SHAPE, action: 'add-row' }] });
  assert.equal((await call(k)).isError, undefined);
  await assert.rejects(call(k + 1), new RegExp(`nest deeper than ${MAX_ARGS_DEPTH}`));
  // What the normalizer builds at the boundary, in argument terms, stays within the limit.
  assert.equal(walkDepth({ doc: { blocks: normalizeRenderShapes(ensureIds(blocks(k))) } }, { limit: MAX_ARGS_DEPTH }), MAX_ARGS_DEPTH);
  assert.equal(measure({ s: '{"a":1}' }, { strings: true }).depth, 3, 'a map string: the object, the list around it, the map');
  assert.equal(measure({ s: '[1]' }, { strings: true }).depth, 2, 'a list string takes the string\'s place');
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
    const result = underBudget(3000, () => applyOps(doc, columnFlips));
    assert.ok(result.ok, JSON.stringify(result.error));
  });
}

test('validate and render return the first MAX_ERRORS errors and how many more; explain takes at most MAX_ERRORS', async () => {
  const doc = { blocks: Array(MAX_ERRORS + 5).fill(5) };
  const checked = (await callTool({}, 'validate', { doc })).structuredContent;
  assert.deepEqual([checked.ok, checked.errors.length, checked.more], [false, MAX_ERRORS, 5]);
  const rendered = await callTool({}, 'render', { doc, format: 'text' });
  assert.equal(rendered.isError, true);
  assert.match(rendered.structuredContent.error, new RegExp(`\\(${MAX_ERRORS + 5} errors\\)`));
  assert.deepEqual([rendered.structuredContent.errors.length, rendered.structuredContent.more], [MAX_ERRORS, 5]);
  const error = { code: 'too_deep', path: '/blocks/0' };
  assert.equal((await callTool({}, 'explain', { errors: Array(MAX_ERRORS).fill(error) })).isError, undefined);
  await assert.rejects(callTool({}, 'explain', { errors: Array(MAX_ERRORS + 1).fill(error) }), new RegExp(`errors holds more than ${MAX_ERRORS} entries`));
});
