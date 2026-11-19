import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { blockSchema, validate } from '@portable-doc/validate';
import { proseHandlers } from './blocks-prose.js';
import { FENCE_TYPES, checkFence } from './from-markdown.js';
import { goldenBlocks } from './golden-reads.mjs';
import { fromMarkdown, toMarkdown } from './index.js';

// The rule: a block the author made survives a round trip, empty or not. In lossless mode,
// toMarkdown then fromMarkdown gives back exactly the block (ids, inline shapes, every
// field) when import accepts it: its own Markdown reads back as it, or import splices a
// portabledoc fence of it (checkFence, the importer's own rule). Any other block is written
// readably and reported in `lost`, never dropped in silence. No list of exceptions: which
// blocks can be kept is derived, so a new type is checked the day it is added.
//
// One row per block type: every type a ```portabledoc fence may hold, and every schema type
// the prose writer handles. A row's filled form is its type's golden; `empty` is the form
// with nothing in it, where the type has one.
const ROWS = {
  action: { empty: { type: 'action' } },
  asciicast: {},
  blockquote: { empty: { type: 'blockquote', content: [] } },
  byline: { empty: { type: 'byline' } },
  callout: { empty: { type: 'callout', tone: 'info', content: [] } },
  chart: {},
  code: { empty: { type: 'code', value: '' } },
  diagram: { empty: { type: 'diagram', source: '' } },
  divider: {},
  eyebrow: { empty: { type: 'eyebrow', text: '' } },
  figure: { empty: { type: 'figure' } },
  heading: { empty: { type: 'heading', level: 2, text: '' } },
  heatmap: {},
  image: { empty: { type: 'image', src: '' } },
  ingress: { empty: { type: 'ingress', content: [] } },
  list: { empty: { type: 'list', ordered: false, items: [] } },
  paragraph: { empty: { type: 'paragraph', content: [] } },
  'pre-gate-badge': {},
  pullquote: { empty: { type: 'pullquote', content: [] } },
  stat: {},
  stats: { empty: { type: 'stats', items: [] } },
  table: { empty: { type: 'table', rows: [] } },
  video: {},
};

const LOSSLESS = { mode: 'lossless' };
const schemaTypes = new Set(Object.keys(blockSchema.definitions.blocks));
const TYPES = [...new Set([...FENCE_TYPES, ...Object.keys(proseHandlers).filter((type) => schemaTypes.has(type))])].sort();

/** Every form as [name, block]: each type's own golden, and its empty form. */
function forms() {
  const out = [];
  for (const [type, row] of Object.entries(ROWS)) {
    const goldens = goldenBlocks(new Set([type]));
    const golden = (goldens.find((g) => g.file === `${type}.golden.json`) ?? goldens[0])?.block;
    assert.ok(golden, `${type}: no golden to take the filled form from`);
    out.push([`${type} filled`, golden]);
    if (row.empty) out.push([`${type} empty`, row.empty]);
  }
  return out;
}

/** Can import bring `block` back: its readable Markdown reads back as it, or import splices a fence of it? */
const keepable = (block) => isDeepStrictEqual(fromMarkdown(toMarkdown([block])), [block]) || !checkFence([block], new Set()).reason;

test('every block type a fence or the prose writer takes has a row, and every row is such a type', () => {
  assert.deepEqual(Object.keys(ROWS), TYPES, 'ROWS lists exactly these types, sorted: add a row for a new type');
  for (const [type, row] of Object.entries(ROWS)) if (row.empty) assert.equal(row.empty.type, type, `${type}: its empty form is a ${type}`);
});

test('lossless mode: each form import accepts comes back exactly, filled and empty; any other is written readably and reported with its reason', () => {
  const start = process.cpuUsage();
  for (const [name, block] of forms()) {
    assert.deepEqual(validate({ blocks: [block] }), { ok: true }, `${name}: the form is not a valid block`);
    const { markdown, lost } = toMarkdown([block], LOSSLESS);
    if (keepable(block)) {
      assert.deepEqual(lost, [], `${name}: import accepts it, yet it is reported lost`);
      assert.deepEqual(fromMarkdown(markdown), [block], `${name}: not the same block after a lossless round trip`);
    } else {
      const reason = checkFence([block], new Set()).reason;
      assert.deepEqual(lost, [{ path: '/blocks/0', id: block.id ?? null, type: block.type, reason }], `${name}: import cannot bring it back, so it is reported with the fence's reason`);
      assert.equal(markdown, toMarkdown([block]), `${name}: a block lossless mode cannot keep is written readably`);
    }
  }
  const used = process.cpuUsage(start);
  assert.ok((used.user + used.system) / 1000 < 2000, 'the matrix takes under 2 s of CPU');
});

test('lossless mode keeps a whole doc of every keepable form, in order, and fences a block its neighbour would change', () => {
  const blocks = forms().map(([, block]) => block).filter(keepable);
  const { markdown, lost } = toMarkdown({ blocks }, LOSSLESS);
  assert.deepEqual(lost, []);
  assert.deepEqual(fromMarkdown(markdown), blocks);
  // Alone, each reads back; together, the emphasised paragraph reads as the diagram's caption.
  const pair = [{ type: 'diagram', source: 'graph TD; A-->B' }, { type: 'paragraph', content: [{ type: 'em', children: [{ type: 'text', value: 'Not a caption' }] }] }];
  const out = toMarkdown(pair, LOSSLESS);
  assert.deepEqual([out.lost, fromMarkdown(out.markdown)], [[], pair]);
  assert.match(out.markdown, /```portabledoc\n\[\{"type":"paragraph"/);
});

test('lossless mode reports a fence import would keep back for a reused id, and anything that is not a block; readable mode is unchanged', () => {
  const doc = [{ type: 'heading', level: 1, text: 'a', id: 'x' }, 'not a block', { type: 'heading', level: 1, text: 'b', id: 'x' }];
  const { markdown, lost } = toMarkdown(doc, LOSSLESS);
  assert.deepEqual(lost, [
    { path: '/blocks/1', id: null, type: null, reason: 'not-a-block' },
    { path: '/blocks/2', id: 'x', type: 'heading', reason: 'id' },
  ]);
  assert.deepEqual(fromMarkdown(markdown), [doc[0], { type: 'heading', level: 1, text: 'b' }]);
  assert.equal(toMarkdown(doc), '# a\n\n# b\n');
  assert.equal(toMarkdown(doc, { mode: 'readable' }), toMarkdown(doc));
});
