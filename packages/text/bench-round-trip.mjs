// What round-trip mode costs against readable mode, in CPU per block, over the block goldens.
// Run: node packages/text/bench-round-trip.mjs [runs]
// Cold is each mode's first call in this process; warm is the median of `runs` (default 7)
// runs of 10 calls each, after 30 calls to warm up. CPU is process.cpuUsage, user + system.
import { SCHEMA_TYPES } from './block-forms.mjs';
import { goldenBlocks } from './golden-reads.mjs';
import { toMarkdown } from './index.js';

const RUNS = Number(process.argv[2] ?? 7);
const REP = 10;
const blocks = goldenBlocks(new Set(SCHEMA_TYPES)).map(({ block }) => block);
const MODES = { readable: undefined, 'round-trip': { mode: 'round-trip' } };

/** CPU milliseconds `fn` takes, averaged over `times` calls. */
function cpu(fn, times = 1) {
  const start = process.cpuUsage();
  for (let k = 0; k < times; k++) fn();
  const d = process.cpuUsage(start);
  return (d.user + d.system) / 1000 / times;
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const perBlock = (ms) => (ms / blocks.length >= 0.1 ? `${(ms / blocks.length).toFixed(3)} ms` : `${((ms / blocks.length) * 1000).toFixed(1)} µs`);

console.log(`${blocks.length} block goldens, node ${process.version}`);

// Cold: the first call of each mode, the whole doc at once.
const cold = {};
for (const [name, opts] of Object.entries(MODES)) cold[name] = cpu(() => toMarkdown(blocks, opts));
console.log(`cold, first call: readable ${perBlock(cold.readable)} a block, round-trip ${perBlock(cold['round-trip'])} a block`);

// Warm: the whole doc in one call, and each block alone.
const SHAPES = {
  'whole doc': (opts) => () => toMarkdown(blocks, opts),
  'each block alone': (opts) => () => {
    for (const b of blocks) toMarkdown([b], opts);
  },
};
for (const [shape, make] of Object.entries(SHAPES)) {
  const runs = Object.fromEntries(Object.entries(MODES).map(([name, opts]) => [name, make(opts)]));
  for (let i = 0; i < 30; i++) for (const fn of Object.values(runs)) fn();
  const ms = { readable: [], 'round-trip': [] };
  for (let i = 0; i < RUNS; i++) for (const [name, fn] of Object.entries(runs)) ms[name].push(cpu(fn, REP));
  const r = median(ms.readable);
  const t = median(ms['round-trip']);
  console.log(`warm, ${shape}: readable ${perBlock(r)} a block, round-trip ${perBlock(t)} a block, ${(t / r).toFixed(1)} times readable`);
}
