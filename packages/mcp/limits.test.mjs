import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DEPTH, MAX_NODES, measure } from './limits.js';

const nest = (levels) => Array.from({ length: levels - 1 }).reduce((v) => [v], 0);

test(`measure: ${MAX_NODES} JSON values and ${MAX_DEPTH} levels are in, one more is over`, () => {
  assert.equal(measure(Array(MAX_NODES - 1).fill(0)).over, null);
  assert.equal(measure(Array(MAX_NODES).fill(0)).over, 'nodes');
  assert.deepEqual(measure(nest(MAX_DEPTH)), { nodes: MAX_DEPTH, depth: MAX_DEPTH, over: null });
  assert.equal(measure(nest(MAX_DEPTH + 1)).over, 'depth');
});
