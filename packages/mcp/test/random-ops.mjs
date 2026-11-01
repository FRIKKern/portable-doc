import { project } from '../ops/table.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const LEAVES = ['paragraph', 'heading', 'divider', 'callout', 'field-number', 'field-boolean', 'field-select', 'table'];
const CONTAINERS = ['section', 'expandable', 'steps', 'tabs', 'columns', 'figure', 'terminal'];
const OPS = ['append-block', 'insert-after', 'patch-block', 'replace-block', 'remove-block', 'move-block'];

export function generator(seed) {
  const rand = mulberry32(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const chance = (p) => rand() < p;
  const int = (n) => Math.floor(rand() * n);

  const id = () => (chance(0.08) ? pick([null, 7, '']) : pick(IDS));
  const withId = (block) => (chance(0.1) ? block : { id: id(), ...block });

  function leaf() {
    const type = pick(LEAVES);
    const block = { type };
    if (type === 'paragraph') block.content = [{ type: 'text', value: pick(['one', 'two']) }];
    if (type === 'field-number') Object.assign(block, pick([{ value: 3, min: 0, max: 10 }, { value: '4', step: 1 }, {}]));
    if (type === 'field-boolean') block.value = pick([true, 'true', false]);
    if (type === 'table') block.rows = [[[{ type: 'text', value: 'x' }]]];
    if (chance(0.1)) block.locked = true;
    return withId(block);
  }

  function container(depth) {
    const type = pick(CONTAINERS);
    const list = () => blocks(depth + 1, 1 + int(3));
    const block = { type };
    if (type === 'section') block.blocks = list();
    if (type === 'expandable') Object.assign(block, pick([{ children: list() }, { blocks: list() }, { children: false, blocks: list() }, { children: 'x', blocks: list() }]));
    if (type === 'steps') block.steps = [withId({ title: 's', ...pick([{ blocks: list() }, { children: list() }]) }), 'opaque'];
    if (type === 'tabs') block.tabs = [withId({ label: 't', blocks: list() }), withId({ label: 'u' })];
    if (type === 'columns') block.columns = [list(), list(), 'opaque'];
    if (type === 'figure') block.child = chance(0.85) ? leaf() : 'not-a-map';
    if (type === 'terminal') Object.assign(block, pick([{ children: list() }, { children: list(), blocks: [] }]));
    if (chance(0.1)) block.locked = true;
    return withId(block);
  }

  function blocks(depth, n) {
    return Array.from({ length: n }, () => (chance(0.03) ? pick(['str', 1, null]) : depth < 3 && chance(0.35) ? container(depth) : leaf()));
  }

  function patch() {
    return pick([
      { content: [{ type: 'text', value: 'patched' }] },
      { type: pick(['paragraph', 'heading', null]), tone: 'info' },
      { value: pick(['5', 'x', 20, '', null, 'true', 'false', ' 2.5 ', '1e3']) },
      { min: pick([0, 6, '9']), max: pick([10, 1]) },
      { step: pick([0, 1, '-1']) },
      { options: pick([[{ value: 'a' }, { value: 'b', label: 'B' }], [{ value: 'a' }, { value: 'a' }], [{ value: '' }], 'x']) },
      { locked: false, role: 'x', id: 'zz' },
    ]);
  }

  function op() {
    const kind = chance(0.04) ? pick(['unknown', null]) : pick(OPS);
    const o = { op: kind };
    if (kind === 'append-block' || kind === 'insert-after' || kind === 'replace-block') o.block = chance(0.9) ? leaf() : pick(['x', null]);
    if (kind === 'insert-after') o.afterId = id();
    if (kind === 'patch-block') o.patch = chance(0.92) ? patch() : pick(['x', [], null]);
    if (['patch-block', 'replace-block', 'remove-block', 'move-block'].includes(kind)) o.id = id();
    if (kind === 'move-block' && chance(0.8)) o.after = chance(0.2) ? null : id();
    if (chance(0.05)) delete o[pick(Object.keys(o))];
    return o;
  }

  return () => {
    const doc = { title: 'Synthetic', blocks: blocks(0, 1 + int(5)) };
    return { doc, op: op() };
  };
}

const INLINE = [
  [{ type: 'text', value: 'x' }],
  [{ type: 'text', value: 'x' }, { type: 'text', value: 'y' }],
  [{ type: 'strong', children: [{ type: 'text', value: 'b' }] }],
  [{ type: 'em', children: [{ type: 'strong', children: [{ type: 'text', value: 'b' }] }] }],
  [{ type: 'text', text: 'tiptap' }],
  [],
  'not-inline',
];

export function intentGenerator(seed) {
  const rand = mulberry32(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const chance = (p) => rand() < p;
  const int = (n) => Math.floor(rand() * n);

  const cell = () => (chance(0.9) ? pick([INLINE[0], INLINE[2], INLINE[5]]) : chance(0.5) ? pick(INLINE) : pick([{ content: pick(INLINE), id: 'c' }, { content: pick(INLINE) }, { content: [], header: true }]));
  const row = (w) => {
    const cells = Array.from({ length: w }, cell);
    return chance(0.85) ? cells : pick([{ cells, id: 'r' }, { cells }, { cells, header: false }]);
  };

  function table(id) {
    const w = 1 + int(3);
    const t = { id, type: 'table', rows: Array.from({ length: int(4) }, () => row(chance(0.95) ? w : w + 1)) };
    if (chance(0.5)) t.head = pick([null, [], Array.from({ length: w }, cell), [cell()]]);
    if (chance(0.05)) t[pick(['columns', 'header', 'blocks'])] = [];
    return t;
  }

  function card(id) {
    const slots = {};
    if (chance(0.8)) slots.title = pick([[{ type: 'heading', text: 'T' }], [], [{ type: 'paragraph' }]]);
    if (chance(0.8)) slots.body = pick([[{ type: 'paragraph', content: pick(INLINE) }], [{ type: 'paragraph' }], [], [{ type: 'heading' }]]);
    if (chance(0.3)) slots.media = pick([[{ type: 'image', src: 's' }], [{ src: 1 }]]);
    if (chance(0.3)) slots.action = pick([[{ type: 'action', label: 'Go' }], [{ type: 'action', href: 2 }]]);
    return { id, type: 'card', ...(chance(0.9) ? { slots } : {}), ...(chance(0.2) ? { tone: pick(['info', 3]) } : {}) };
  }

  const ids = ['t1', 't2', 'k1', 'k2'];
  const block = (id) => (id.startsWith('t') ? (chance(0.9) ? table(id) : card(id)) : chance(0.9) ? card(id) : table(id));

  function shapeOf(doc, id) {
    return project(doc.blocks.find((b) => b.id === id))?.shape ?? {};
  }

  function op(doc) {
    const id = chance(0.9) ? pick(ids) : pick([null, '', ' t1']);
    const kind = pick(['patch-card-body', 'patch-table-cells', 'patch-table-structure']);
    const o = { op: kind, id };
    if (kind === 'patch-card-body') o.content = pick(INLINE);
    if (kind === 'patch-table-cells') o.cells = pick([[{ area: 'body', row: 0, column: 0, content: pick(INLINE) }], [{ area: 'head', row: 0, column: 0, content: pick(INLINE) }], [{ area: 'body', row: 1, column: 0, content: [] }, { area: 'body', row: 0, column: 0, content: [] }], 'x']);
    if (kind === 'patch-table-structure') o.action = pick(['add-row', 'add-column', 'add-header', 'remove-header', 'remove-row:0', 'up-row:1', 'down-row:0', 'remove-column:1', 'left-column:1', 'right-column:0', 'remove-row:01', 'nope', 3]);
    if (kind !== 'patch-card-body') o.shape = chance(0.6) ? shapeOf(doc, id) : pick([{}, 'x', null]);
    if (chance(0.05)) o.extra = true;
    return o;
  }

  return () => {
    const doc = { blocks: ids.filter(() => chance(0.7)).map(block) };
    if (chance(0.1)) doc.blocks.push(block(pick(ids)));
    return { doc, op: op(doc) };
  };
}
