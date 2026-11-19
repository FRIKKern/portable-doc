import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { blockSchema, validate } from '@portable-doc/validate';
import { proseHandlers } from './blocks-prose.js';
import { FENCE_TYPES } from './from-markdown.js';
import { canon, goldenBlocks } from './golden-reads.mjs';
import { fromMarkdown, toMarkdown } from './index.js';

// The rule: a block the author made survives a round trip, empty or not.
// toMarkdown, then fromMarkdown, gives the same block back (canon: ids dropped,
// inline content compared as text runs with their marks).
//
// One row per block type: every type a ```portabledoc fence may hold, and every
// schema type the prose writer handles. A row's filled form is its type's golden;
// `empty` is the form with nothing in it, where the type has one. A row marked
// `not` says why the type cannot round-trip through Markdown.
const ROWS = {
  action: { not: 'a call-to-action button; Markdown has only a link, and import reads it as one' },
  asciicast: { not: 'a terminal recording; Markdown has only a link to it' },
  blockquote: { empty: { type: 'blockquote', content: [] } },
  byline: { not: 'author and date metadata; Markdown has no form for it, so it is written as a line of text' },
  callout: { empty: { type: 'callout', tone: 'info', content: [] } },
  chart: {},
  code: { empty: { type: 'code', value: '' } },
  diagram: { empty: { type: 'diagram', source: '' } },
  divider: {},
  eyebrow: { empty: { type: 'eyebrow', text: '' } },
  figure: { not: 'a captioned group of blocks; Markdown writes its body and caption as paragraphs' },
  heading: { empty: { type: 'heading', level: 2, text: '' } },
  heatmap: {},
  image: { not: 'import reads a Markdown image as a link to it (Barkpark\'s chat rule), never as an image block' },
  ingress: { not: 'a lead paragraph; Markdown has only paragraphs' },
  list: { empty: { type: 'list', ordered: false, items: [] } },
  paragraph: { empty: { type: 'paragraph', content: [] } },
  'pre-gate-badge': { not: 'a notice the renderer adds to old docs; Markdown writes it as a line of text' },
  pullquote: { empty: { type: 'pullquote', content: [] } },
  stat: {},
  stats: { empty: { type: 'stats', items: [] } },
  table: { empty: { type: 'table', rows: [] } },
  video: { not: 'Markdown has only a link to the video' },
};

// Forms that should round-trip and do not today, each with what goes wrong. Only shrinks:
// a form that round-trips now must leave it.
const FAILS_TODAY = {
  'blockquote empty': 'toMarkdown writes nothing, so it comes back as no block',
  'callout filled': 'toMarkdown writes a quote with a bold label, which imports as a blockquote; a [!tone] quote would import as the callout',
  'callout empty': 'toMarkdown writes "> **Info**", which imports as a blockquote',
  'chart filled': 'toMarkdown writes its title and a table of its data; a portabledoc fence would carry the chart',
  'eyebrow filled': 'toMarkdown writes a paragraph, which imports as one; a portabledoc fence would carry the eyebrow',
  'eyebrow empty': 'toMarkdown writes nothing, so it comes back as no block',
  'heading empty': 'toMarkdown writes nothing, so it comes back as no block',
  'heatmap filled': 'toMarkdown writes a table of its values; a portabledoc fence would carry the heatmap',
  'list empty': 'toMarkdown writes nothing, so it comes back as no block',
  'paragraph empty': 'toMarkdown writes nothing, so it comes back as no block',
  'pullquote filled': 'toMarkdown writes a quote, which imports as a blockquote; a portabledoc fence would carry the pullquote',
  'pullquote empty': 'toMarkdown writes nothing, so it comes back as no block',
  'stat filled': 'toMarkdown writes its parts as paragraphs; a portabledoc fence would carry the stat',
  'stats filled': 'toMarkdown writes a list and a paragraph; a portabledoc fence would carry the stats',
  'stats empty': 'toMarkdown writes "stats — no data", which imports as a paragraph',
  'table empty': 'toMarkdown writes nothing, so it comes back as no block',
};

const schemaTypes = new Set(Object.keys(blockSchema.definitions.blocks));
const TYPES = [...new Set([...FENCE_TYPES, ...Object.keys(proseHandlers).filter((type) => schemaTypes.has(type))])].sort();

/** Each round-trippable form as [name, block]: the type's own golden, and its empty form. */
function forms() {
  const out = [];
  for (const [type, row] of Object.entries(ROWS)) {
    if (row.not) continue;
    const goldens = goldenBlocks(new Set([type]));
    const golden = (goldens.find((g) => g.file === `${type}.golden.json`) ?? goldens[0])?.block;
    assert.ok(golden, `${type}: no golden to take the filled form from`);
    out.push([`${type} filled`, golden]);
    if (row.empty) out.push([`${type} empty`, row.empty]);
  }
  return out;
}

test('every block type a fence or the prose writer takes has a round-trip row, and every row is such a type', () => {
  assert.deepEqual(Object.keys(ROWS), TYPES, 'ROWS lists exactly these types, sorted: add a row for a new type');
  for (const [type, row] of Object.entries(ROWS)) {
    assert.ok(!(row.not && row.empty), `${type}: a row that cannot round-trip has no empty form to test`);
    if (row.empty) assert.equal(row.empty.type, type, `${type}: its empty form is a ${type}`);
  }
});

test('a block survives toMarkdown then fromMarkdown, filled and empty, except the rows marked not and the forms in FAILS_TODAY', () => {
  const names = forms().map(([name]) => name);
  assert.deepEqual(Object.keys(FAILS_TODAY).filter((name) => !names.includes(name)), [], 'FAILS_TODAY names a form no row has');
  const start = process.cpuUsage();
  for (const [name, block] of forms()) {
    assert.deepEqual(validate({ blocks: [block] }), { ok: true }, `${name}: the form is not a valid block`);
    const back = fromMarkdown(toMarkdown([block]));
    const same = isDeepStrictEqual(back.map(canon), [block].map(canon));
    if (Object.hasOwn(FAILS_TODAY, name)) assert.ok(!same, `${name} round-trips now: take it off FAILS_TODAY`);
    else assert.deepEqual(back.map(canon), [block].map(canon), `${name}: not the same block after toMarkdown then fromMarkdown`);
  }
  const used = process.cpuUsage(start);
  assert.ok((used.user + used.system) / 1000 < 2000, 'the matrix takes under 2 s of CPU');
});
