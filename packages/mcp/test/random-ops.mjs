import { tableSafety } from '../ops/intents.js';
import { RAISED, normalizeRenderShapes } from '../ops/persist.js';
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

  const grid = () => [[pick(INLINE)]];
  const NOISE = [
    () => ({ type: 'table', rows: grid() }),
    () => ({ id: 'n', type: 'table', content: [[{ type: 'paragraph', content: pick(INLINE) }]] }),
    () => ({ id: 'n', type: 'table', content: { head: [pick(INLINE)], rows: grid() } }),
    () => ({ id: 'n', type: 'table', rows: grid(), headers: [pick(INLINE)] }),
    () => ({ id: 'n', type: 'table', rows: [{ k: 'v' }], columns: [{ key: 'k', label: pick(['K', null]) }] }),
    () => ({ id: 'n', type: 'table', rows: grid(), columns: pick([[{ text: 'c' }], ['c', 1], [{ text: 'c', x: 1 }], []]) }),
    () => ({ id: 'n', type: 'table', rows: [[pick(INLINE)], [pick(INLINE)]], header: pick([true, false, null]) }),
    () => ({ id: 'n', type: 'table', rows: [{ header: true, cells: [pick(INLINE)] }, [pick(INLINE)]] }),
    () => ({ id: 'n', type: 'table', rows: [{ cells: [{ header: true, content: pick(INLINE) }] }, [pick(INLINE)]] }),
    () => ({ id: 'n', type: 'table', rows: [[pick(['s', { text: 's' }, { content: pick(INLINE) }, 3])]] }),
    () => ({ id: 'n', type: 'table', rows: grid(), blocks: [{ type: 'paragraph' }] }),
    () => ({ id: 'n', type: 'paragraph', junk: { id: 'q', type: 'table', rows: pick(['x', grid(), [[{ type: 'text', text: 't' }]]]) } }),
    () => ({ id: 'n', type: 'paragraph', content: [{ type: 'table', id: 'q', children: [{ type: 'text', text: 't' }] }] }),
    () => ({ id: 'n', type: 'list', items: [pick(['plain', '[{"type":"table","id":"q","rows":[]}]', 4, null, [{ type: 'paragraph', content: [{ type: 'text', text: 't' }] }]])] }),
    () => ({ id: 'n', type: pick(['bulletList', 'list']), content: [{ type: 'listItem', content: [{ type: 'paragraph', content: pick(INLINE.slice(0, 5)) }] }] }),
    () => ({ id: 'n', type: pick(['notes', 'pipeline']), [pick(['items', 'nodes'])]: [pick(['s', pick(INLINE), { type: 'table', id: 'q', rows: [] }])] }),
    () => ({ id: 'n', type: 'callout', text: pick(['hi', ' ', '']), ...(chance(0.5) ? { content: [] } : {}) }),
    () => ({ id: 'n', type: 'section', blocks: [{ type: 'table', rows: grid() }] }),
  ];
  const noise = () => pick(NOISE)();
  const wrap = (b) => pick([
    () => ({ id: 'w', type: 'section', blocks: [b] }),
    () => ({ id: 'w', type: 'steps', steps: [{ id: 'w-s', blocks: [b] }] }),
    () => ({ id: 'w', type: 'tabs', tabs: [{ id: 'w-t', blocks: [b] }] }),
    () => ({ id: 'w', type: 'columns', columns: [[b]] }),
    () => ({ id: 'w', type: 'expandable', children: [b] }),
    () => ({ id: 'w', type: 'figure', child: b }),
    () => ({ id: 'w', type: 'paragraph', opaque: [b] }),
  ])();

  function shapeOf(doc, id) {
    const found = [];
    JSON.stringify(doc, (_k, v) => (v?.id === id && v.type === 'table' && found.push(v), v));
    return project(found[0])?.shape ?? {};
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
    const doc = { blocks: ids.filter(() => chance(0.7)).map((id) => (chance(0.15) ? wrap(block(id)) : block(id))) };
    if (chance(0.1)) doc.blocks.push(block(pick(ids)));
    if (chance(0.3)) doc.blocks.splice(int(doc.blocks.length + 1), 0, chance(0.2) ? wrap(noise()) : noise());
    return { doc, op: op(doc) };
  };
}

const SHAPE_TYPES = ['list', 'bulletList', 'bullet_list', 'bullet-list', 'bulletedList', 'bulleted_list', 'bulleted-list', 'orderedList', 'ordered_list', 'ordered-list', 'table', 'table', 'callout', 'notes', 'cards', 'pipeline', 'section', 'steps', 'tabs', 'columns', 'expandable', 'figure', 'terminal', 'paragraph', 'text', 'listItem', 'list_item', 'tableCell', 'table_cell', 'tableHeader', 'table_header', 'heading', 'strong', '', 7];
const SHAPE_KEYS = ['content', 'items', 'children', 'blocks', 'rows', 'rows', 'head', 'header', 'headers', 'columns', 'cells', 'text', 'value', 'style', 'listStyle', 'ordered', 'slots', 'nodes', 'label', 'key', 'title', 'inline', 'steps', 'tabs', 'child', 'x'];
const SHAPE_SCALARS = [null, true, false, 0, 3, -1.5, 0.000123, 2.5e-8, 123456.789, 1.5e21, '', ' ', 'a', 'b c', 'ordered', 'Number', 'DECIMAL', '[]', '[{"type":"text","value":"j"}]', '{"type":"text","text":"m"}', '[1]', '{bad', '"q"'];
const SHAPE_LISTS = SHAPE_TYPES.filter((t) => /list/i.test(t) && !/item/i.test(t) && t !== 'list');
const INLINE_WRAPPERS = ['paragraph', 'listItem', 'list_item', 'tableCell', 'table_cell', 'tableHeader', 'table_header'];
const WORDS = ['a', 'b c', '', ' ', 'Number', 'ordered', '[]', '[{"type":"text","value":"j"}]', '{"type":"text","text":"m"}', '[1]', '{bad', '[{"x":1}]'];
const STYLES = ['ordered', '', 0, 'Decimal', 'bullet', true, 3, 1.5, [111, 114, 100, 101, 114, 101, 100], ['Num', ['ber']], [55296], [1.5], [-1], { x: 1 }, [], null, false];

export function normalizeGenerator(seed) {
  const rand = mulberry32(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const chance = (p) => rand() < p;
  const int = (n) => Math.floor(rand() * n);
  let n = 0;

  function value(depth) {
    if (depth > 4 || chance(0.35)) return pick(SHAPE_SCALARS);
    if (chance(0.45)) return Array.from({ length: int(4) }, () => value(depth + 1));
    return node(depth + 1);
  }

  function node(depth) {
    const o = {};
    if (chance(0.85)) o.type = pick(SHAPE_TYPES);
    if (chance(0.5)) o.id = chance(0.9) ? `i${n++}` : pick(['', null, 3, 'dup']);
    for (let i = int(4); i > 0; i--) o[pick(SHAPE_KEYS)] = value(depth);
    if (chance(0.1)) o[pick(['style', 'listStyle'])] = pick(STYLES);
    return o;
  }

  const some = (make, max = 4) => Array.from({ length: int(max) }, make);
  const word = () => pick(WORDS);
  const id = () => (chance(0.9) ? `i${n++}` : pick(['', null, 3, 'dup']));
  const withId = (o) => (chance(0.6) ? { id: id(), ...o } : o);
  const jolt = (o) => (chance(0.15) ? { ...o, [pick(SHAPE_KEYS)]: value(3) } : o);
  const optional = (key, make) => (chance(0.5) ? { [key]: make() } : {});

  const inline = (d = 0) => pick([
    () => ({ type: 'text', value: word() }),
    () => ({ type: 'text', text: word() }),
    () => ({ type: 'text', text: word(), value: word() }),
    () => ({ type: 'text', text: word(), marks: [] }),
    () => ({ type: 'text', text: word(), [pick(['children', 'content'])]: inlines(d + 1), ...optional('value', word) }),
    () => ({ text: word() }),
    () => ({ content: inlines(d + 1) }),
    () => ({ type: pick(['strong', 'em', 'link']), [pick(['children', 'content'])]: inlines(d + 1) }),
    () => ({ type: pick(INLINE_WRAPPERS), content: inlines(d + 1) }),
    word,
    () => pick(SHAPE_SCALARS),
  ])();
  const inlines = (d = 0) => (d > 3 ? [] : some(() => inline(d), 3));
  const para = () => withId({ type: 'paragraph', content: inlines() });

  const listItem = () => pick([
    () => null, word, () => pick([3, -1.5, 0.000123, true]), inlines,
    () => ({ content: inlines() }), () => ({ text: word() }),
    () => ({ id: id(), content: inlines() }), () => ({ id: id(), text: word() }), () => ({ id: id(), content: inlines(), x: 1 }),
    () => ({ type: pick(['listItem', 'list_item']), content: [para()] }), para, inline,
  ])();
  const list = () => jolt(withId({
    type: pick([...SHAPE_LISTS, 'list', 'list']),
    [pick(['items', 'content', 'children'])]: some(listItem),
    ...(chance(0.3) ? { [pick(['style', 'listStyle'])]: pick(STYLES) } : {}),
    ...optional('ordered', () => pick([true, false, 'yes'])),
  }));

  const cell = () => pick([
    inlines, word, () => pick(SHAPE_SCALARS),
    () => ({ content: chance(0.5) ? [para(), ...inlines()] : inlines() }), () => ({ text: word() }),
    () => ({ header: pick([true, false]), content: chance(0.5) ? [para()] : inlines() }), () => ({ header: true, text: word() }),
    () => ({ type: pick(['tableHeader', 'table_header', 'tableCell']), content: inlines() }),
  ])();
  const cells = () => some(cell, 3);
  const row = () => pick([
    cells, cells,
    () => ({ cells: cells() }), () => ({ cells: cells(), header: pick([true, false, null, 'x']) }),
    () => ({ content: cells() }), () => ({ cells: cells(), header: true, x: 1 }), () => ({ cells: some(() => ({ header: true, content: inlines() }), 3) }),
  ])();
  const rows = () => some(row);
  const records = () => {
    const keys = pick([['k'], ['k', 'l'], ['k', 'k'], ['', 'k'], [3], ['k', 'l', 'm']]);
    const columns = keys.map((key) => ({ key, ...optional('label', () => pick(['K', null, 3, ''])) }));
    const record = () => Object.fromEntries([...keys.filter(() => chance(0.85)).map((k) => [k, pick([...SHAPE_SCALARS, true, false, { x: 1 }, [1]])]), ...(chance(0.15) ? [['z', 'a']] : [])]);
    return { columns: chance(0.1) ? [...columns, 'x'] : columns, rows: some(record) };
  };
  const table = () => jolt(withId(pick([
    () => ({ type: 'table', rows: rows() }),
    () => ({ type: 'table', rows: rows(), ...optional('head', () => pick([cells(), [], null, true, 'x'])), ...optional('header', () => pick([true, false, cells(), []])) }),
    () => ({ type: 'table', rows: rows(), headers: pick([cells(), [], 'x']), ...optional('head', () => pick([[], null, cells()])) }),
    () => ({ type: 'table', ...records() }),
    () => ({ type: 'table', rows: rows(), columns: pick([[{ text: 'a' }, { text: 'b' }], [{ text: 'a', x: 1 }], ['a', 3, true, null, 1.5], [{ x: 1 }], []]), ...optional('head', () => pick([[], null])) }),
    () => ({ type: 'table', content: rows() }),
    () => ({ type: 'table', content: { rows: rows(), ...optional(pick(['head', 'header']), () => pick([cells(), null, 'x', '', 0, [[{ x: 1 }]]])) } }),
  ])()));

  const blocks = (d) => some(() => block(d), 3);
  const body = (d) => ({ [pick(['children', 'blocks'])]: blocks(d), ...(chance(0.5) ? { children: pick([null, false, 'x', blocks(d)]), blocks: blocks(d) } : {}) });
  const container = (d) => jolt(withId(pick([
    () => ({ type: 'section', blocks: blocks(d) }),
    () => ({ type: 'terminal', children: blocks(d), ...optional('blocks', () => blocks(d)) }),
    () => ({ type: 'expandable', ...body(d) }),
    () => ({ type: 'steps', steps: some(() => withId(body(d)), 3) }),
    () => ({ type: 'tabs', tabs: some(() => withId({ blocks: blocks(d) }), 3) }),
    () => ({ type: 'columns', columns: some(() => blocks(d), 3) }),
    () => ({ type: 'figure', child: block(d) }),
    () => ({ type: 'callout', text: pick(['', ' ', 'x']), ...optional('content', () => pick([null, [], '', inlines()])), ...optional('slots', () => pick([null, {}, { a: 1 }])), ...optional('blocks', () => blocks(d)) }),
    () => ({ type: pick(['notes', 'cards']), items: some(() => pick([word, inlines, () => ({ text: word() })])()) }),
    () => ({ type: 'pipeline', nodes: some(() => pick([word, inlines, () => ({ title: word() })])()) }),
    () => ({ type: pick(['paragraph', 'quote', 'list']), content: inlines(), ...body(d) }),
  ])()));
  const block = (d) => (d > 3 ? pick([para, list, table])() : pick([para, list, table, table, () => container(d + 1), () => node(1)])());

  const passInline = (d) => {
    if (d > 6 || chance(0.2)) return pick([word, () => ({ type: 'text', value: word() }), () => ({ type: 'text', text: word() }), () => ({ type: 'text', text: word(), value: word() }), () => pick(SHAPE_SCALARS)])();
    const kids = () => some(() => passInline(d + 1), 3);
    return pick([
      () => ({ type: 'text', text: word(), [pick(['children', 'content'])]: kids() }),
      () => ({ type: 'text', text: word(), value: word(), content: kids() }),
      () => ({ content: kids() }),
      () => ({ type: pick(['strong', 'paragraph', 'x']), [pick(['children', 'content'])]: kids() }),
      () => withId({ type: 'table', rows: [[kids()]] }),
    ])();
  };
  const passInlines = () => some(() => passInline(0), 3);
  const passBlock = (d) => {
    if (d > 7 || chance(0.25)) {
      return pick([
        () => ({ type: 'list', items: some(() => (chance(0.8) ? passInlines() : word()), 3) }),
        () => withId({ type: 'table', rows: some(() => pick([passInlines, () => ({ cells: some(passInlines, 3) })])(), 3), ...optional('head', passInlines) }),
        () => ({ type: 'paragraph', content: passInlines() }),
        () => ({ type: pick(SHAPE_LISTS), content: some(word, 3), children: [passBlock(8)] }),
      ])();
    }
    const kids = () => some(() => passBlock(d + 1), 3);
    return pick([
      () => ({ type: 'section', blocks: kids(), content: passInlines() }),
      () => ({ type: 'expandable', children: kids(), blocks: kids() }),
      () => ({ type: 'x', children: kids() }),
      () => ({ type: 'steps', steps: [{ children: kids() }], blocks: kids() }),
      () => ({ type: 'tabs', tabs: [{ blocks: kids() }], children: kids() }),
      () => ({ type: 'columns', columns: [kids()], blocks: kids() }),
      () => ({ type: 'callout', text: 'c', blocks: kids() }),
      () => ({ type: 'table', rows: [], blocks: kids() }),
    ])();
  };

  return () => {
    if (chance(0.2)) return { blocks: some(() => passBlock(0), 3) };
    return { blocks: Array.from({ length: 1 + int(4) }, () => (chance(0.05) ? pick(SHAPE_SCALARS) : chance(0.5) ? block(0) : node(0))) };
  };
}

export function shapeAnswer({ blocks }) {
  const raised = (fun) => {
    try {
      return fun();
    } catch (e) {
      if (e === RAISED) return 'raised';
      throw e;
    }
  };
  return { norm: raised(() => normalizeRenderShapes(blocks)), safe: raised(() => tableSafety(blocks) ?? 'ok') };
}
