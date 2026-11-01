import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DEPTH, MAX_NODES, measure } from './limits.js';
import { applyOps } from './ops/apply.js';

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

const WORST = {
  'wide locked blocks': [{ blocks: repeat(60_000, (i) => ({ id: `b${i}`, locked: true })) }, repeat(5, (i) => ({ op: 'append-block', block: { id: `n${i}` } }))],
  'opaque tables that share the target id': [
    { blocks: [{ type: 'paragraph', junk: repeat(25_000, () => ({ id: 't', type: 'table', rows: [] })) }, ...repeat(45_000, (i) => ({ id: `p${i}` })), TABLE] },
    repeat(5, (i) => ({ op: 'patch-table-cells', id: 't', shape: SHAPE, cells: [{ area: 'body', row: 0, column: 0, content: [{ type: 'text', value: `v${i}` }] }] })),
  ],
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
