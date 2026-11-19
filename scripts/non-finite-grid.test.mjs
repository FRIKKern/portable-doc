// A number that is not finite shows nothing, in every writer: no output holds "NaN" or "Infinity",
// as text or inside an attribute or a style. Every value of every base form (each scalar, array and
// object) is set in turn to NaN, Infinity, -Infinity, 0, -0, [NaN] and [Infinity], and each writer
// in the registry writes the block; none may throw. No base form's input holds either word.
//
// The editor's two writers are left out: packages/editor is written only by the sync from
// Barkpark's paper editor, so what they write is fixed there. Finite digits are pinned elsewhere,
// by the goldens and the pinned writer cases.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allForms } from '../packages/text/block-forms.mjs';
import { WRITERS } from './lib/writers.mjs';

const VALUES = [NaN, Infinity, -Infinity, 0, -0, [NaN], [Infinity]];
const WORD = /NaN|Infinity/;
const shown = (v) => (Object.is(v, -0) ? '-0' : Array.isArray(v) ? `[${v}]` : String(v));
const writers = WRITERS.filter((w) => w.package !== '@portable-doc/editor');

/** The path of every value in a block, `type` aside. */
function paths(v, at = [], out = []) {
  if (v && typeof v === 'object') {
    if (at.length) out.push(at);
    for (const [k, x] of Object.entries(v)) if (k !== 'type') paths(x, [...at, k], out);
  } else if (at.length) out.push(at);
  return out;
}

function setAt(block, at, value) {
  const copy = structuredClone(block);
  let o = copy;
  for (const k of at.slice(0, -1)) o = o[k];
  o[at.at(-1)] = value;
  return copy;
}

test('no writer shows a number that is not finite, over every value of every base form', () => {
  const forms = allForms().filter(([name]) => !name.includes(' in a '));
  assert.deepEqual(forms.filter(([, block]) => WORD.test(JSON.stringify(block))).map(([name]) => name), [], 'a base form whose input holds the word');
  assert.ok(writers.length >= 5, `${writers.length} writers`);
  let blocks = 0;
  const wrong = new Map();
  for (const [name, block] of forms) {
    for (const at of paths(block)) {
      for (const value of VALUES) {
        const b = setAt(block, at, value);
        blocks++;
        for (const writer of writers) {
          let output;
          try {
            output = writer.write([b]).output;
          } catch (e) {
            output = `throws ${e.constructor.name}`;
          }
          if (!WORD.test(output) && !output.startsWith('throws ')) continue;
          const key = `${writer.name} ${output.startsWith('throws ') ? output : 'shows the word'}: ${b.type}.${at.filter((k) => !/^\d+$/.test(k)).join('.')} = ${shown(value)}`;
          if (!wrong.has(key)) wrong.set(key, `${name} ${at.join('.')}`);
        }
      }
    }
  }
  assert.ok(blocks > 39_000, `${blocks} blocks`);
  assert.deepEqual([...wrong].map(([key, first]) => `${key} (first: ${first})`), []);
});

test('a digit string too large for a number is no number: a grid span or order is left out, and tracks fall back, as when missing', () => {
  const big = '9'.repeat(400);
  const grid = (child, layout = {}) => [{ type: 'section', layout: { mode: 'grid', ...layout }, blocks: [{ type: 'paragraph', text: 'x', ...child }] }];
  // The HTML writers only: a Markdown writer that keeps the block as data keeps the string too.
  for (const writer of writers.filter((w) => w.writes === 'html')) {
    const out = (blocks) => writer.write(blocks).output;
    assert.equal(out(grid({ span: big })), out(grid({})), `${writer.name}: span`);
    assert.equal(out(grid({ order: big })), out(grid({})), `${writer.name}: order`);
    assert.equal(out(grid({ order: `-${big}` })), out(grid({})), `${writer.name}: order below`);
    assert.equal(out(grid({}, { tracks: big })), out(grid({})), `${writer.name}: tracks`);
  }
  const html = writers.find((w) => w.name === 'HTML').write(grid({ span: '3', order: '2' }, { tracks: '4' })).output;
  for (const shown of ['grid-column:span 3', 'order:2', '--bp-tracks:4']) assert.ok(html.includes(shown), `a digit string that fits is read: ${shown}`);
});

test('a form scale bound given as a digit string too large for a number shows no Infinity in text', { todo: 'the text writers parse it to -Infinity and write it; the forms-scale fix makes this a real test' }, () => {
  const block = { type: 'form', questions: [{ prompt: 'How sure?', type: 'scale', scale: { min: `-${'9'.repeat(400)}` } }] };
  for (const writer of writers.filter((w) => w.package === '@portable-doc/text')) assert.doesNotMatch(writer.write([block]).output, WORD, writer.name);
});
