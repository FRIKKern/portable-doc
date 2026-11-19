import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { validate } from '@portable-doc/validate';
import { SCHEMA_TYPES, allForms, contexts, formsOf } from './block-forms.mjs';
import { FENCE_TYPES, checkFence } from './from-markdown.js';
import { READ_ALIASES } from './golden-reads.mjs';
import { fromMarkdown, toMarkdown } from './index.js';
import { keptTypes, readme } from './readme.mjs';

// The rule: a block the author made survives a round trip, empty or not. In round-trip mode,
// toMarkdown then fromMarkdown gives back exactly the block (ids, inline shapes, every
// field) when import accepts it: its own Markdown reads back as it, or import splices a
// portabledoc fence of it (checkFence, the importer's own rule). Any other block is written
// readably and reported in `lost`, never dropped in silence. No list of exceptions: the
// forms come from every type the schema names (block-forms.mjs), and which can be kept is
// derived, so a new type is checked the day it is added.

const ROUND_TRIP = { mode: 'round-trip' };
const FORMS = allForms();
const native = (block) => isDeepStrictEqual(fromMarkdown(toMarkdown([block])), [block]);
/** Can import bring `block` back: its readable Markdown reads back as it, or import splices a fence of it? */
const keepable = (block) => native(block) || !checkFence([block], new Set()).reason;

test('the forms cover every schema type, vary values past the golden, write no alias, and sit bare, in a list item and in a callout (a Markdown quote)', () => {
  const types = new Set(FORMS.map(([, block]) => block.type));
  for (const type of SCHEMA_TYPES) assert.ok(types.has(type), `${type}: no form`);
  const names = new Set(FORMS.map(([name]) => name));
  for (const level of [1, 3, 4, 5, 6]) assert.ok(names.has(`heading value level=${level}`), `heading level ${level} is a form`);
  for (const name of ['heading filled', 'heading filled with an alias', 'paragraph empty content', 'paragraph whitespace', 'paragraph whitespace, no address', 'list empty items', 'callout whitespace in a callout (a Markdown quote)', 'code filled in a list item']) assert.ok(names.has(name), `${name} is a form`);
  for (const type of SCHEMA_TYPES) for (const [form, block] of formsOf(type)) {
    if (form === 'filled with an alias') continue;
    for (const key of Object.keys(block)) assert.ok(!Object.hasOwn(READ_ALIASES, `${type}.${key}`), `${type} ${form}: writes the alias ${key}`);
  }
  assert.deepEqual(Object.keys(contexts), ['in a list item', 'in a callout (a Markdown quote)']);
});

test('a paragraph of whitespace comes back in round-trip mode, bare and in each context; with a blank link address it is reported lost', () => {
  const rows = FORMS.filter(([name]) => name.startsWith('paragraph whitespace'));
  assert.equal(rows.length, 6);
  for (const [name, block] of rows) {
    const { markdown, lost } = toMarkdown([block], ROUND_TRIP);
    if (name.startsWith('paragraph whitespace, no address')) {
      assert.deepEqual([lost, fromMarkdown(markdown)], [[], [block]], name);
    } else assert.deepEqual(lost.map((l) => l.reason), ['address'], name);
  }
});

// The quote context: a callout, written as `> [!tone]`, whose body holds the form.
const QUOTED = Object.keys(contexts).find((where) => /quote|callout/.test(where));
const fenceReason = (block) => checkFence([block], new Set()).reason;

test('round-trip mode: each form import accepts comes back exactly; any other is written readably and reported with its reason', () => {
  for (const [name, block] of FORMS) {
    assert.deepEqual(validate({ blocks: [block] }), { ok: true }, `${name}: the form is not a valid block`);
    const { markdown, lost } = toMarkdown([block], ROUND_TRIP);
    // In a callout, the form is decided on its own inside the callout's quote: kept, or listed under its own path.
    if (name.endsWith(` ${QUOTED}`)) {
      const inner = block.slots.body[0];
      if (keepable(inner)) assert.deepEqual([lost, fromMarkdown(markdown)], [[], [block]], `${name}: import accepts it, so it comes back exactly`);
      else {
        assert.deepEqual(lost, [{ path: '/blocks/0/slots/body/0', id: inner.id ?? null, type: inner.type, reason: fenceReason(inner) }], `${name}: listed under its own path, with the fence's reason`);
        assert.match(markdown, /^> \[!info\] Note\n/, `${name}: the callout is still written in its own Markdown`);
      }
      continue;
    }
    // The allowlist rule, asserted on its own: a type a fence may not hold is kept only by its own Markdown.
    if (!FENCE_TYPES.has(block.type) && !native(block)) assert.equal(lost[0]?.reason, 'type', `${name}: a type outside the allowlist must not pass as kept`);
    if (keepable(block)) {
      assert.deepEqual(lost, [], `${name}: import accepts it, yet it is reported lost`);
      assert.deepEqual(fromMarkdown(markdown), [block], `${name}: not the same block after a round trip`);
    } else {
      assert.deepEqual(lost, [{ path: '/blocks/0', id: block.id ?? null, type: block.type, reason: fenceReason(block) }], `${name}: import cannot bring it back, so it is reported with the fence's reason`);
      assert.equal(markdown, toMarkdown([block]), `${name}: a block round-trip mode cannot keep is written readably`);
    }
  }
});

// The one context row whose container reads back in its own Markdown; every other kept one
// comes back only by a fence of the whole container.
const NATIVE_IN_CONTEXT = ['list filled in a list item'];

test('round-trip mode keeps a block in a list item or a callout by a portabledoc fence of the whole container, never in the container\'s own Markdown', () => {
  const contextual = FORMS.filter(([name]) => Object.keys(contexts).some((where) => name.endsWith(` ${where}`)));
  assert.equal(contextual.length, 602, 'every base form in each context');
  const native = [];
  let fenced = 0;
  for (const [name, block] of contextual) {
    if (!keepable(block)) continue;
    const { markdown, lost } = toMarkdown([block], ROUND_TRIP);
    assert.deepEqual(lost, [], name);
    if (NATIVE_IN_CONTEXT.includes(name)) {
      native.push(name);
      assert.equal(markdown, toMarkdown([block]), `${name}: written in its own Markdown`);
      continue;
    }
    // The route: exactly one fence holding the whole container, as the readable writer writes it.
    assert.equal(markdown, toMarkdown([{ type: 'code', lang: 'portabledoc', value: JSON.stringify([block]) }]), `${name}: not one fence of the whole container`);
    fenced++;
  }
  assert.deepEqual(native, NATIVE_IN_CONTEXT);
  assert.equal(fenced, 117, 'context rows kept by a fence of the whole container');
});

test('round-trip mode keeps a whole doc of every keepable form, in order, and fences a block its neighbour would change', () => {
  const ids = new Set();
  const blocks = FORMS.map(([, block]) => block).filter((block) => keepable(block) && (block.id === undefined || (!ids.has(block.id) && ids.add(block.id))));
  const { markdown, lost } = toMarkdown({ blocks }, ROUND_TRIP);
  assert.deepEqual(lost, []);
  assert.deepEqual(fromMarkdown(markdown), blocks);
  // Alone, each reads back; together, the emphasised paragraph reads as the diagram's caption.
  const pair = [{ type: 'diagram', source: 'graph TD; A-->B' }, { type: 'paragraph', content: [{ type: 'em', children: [{ type: 'text', value: 'Not a caption' }] }] }];
  const out = toMarkdown(pair, ROUND_TRIP);
  assert.deepEqual([out.lost, fromMarkdown(out.markdown)], [[], pair]);
  assert.match(out.markdown, /```portabledoc\n\[\{"type":"paragraph"/);
});

test('the README lists the types round-trip mode keeps as node packages/text/readme.mjs writes them today: the fence types and blockquote', () => {
  assert.equal(fs.readFileSync(new URL('README.md', import.meta.url), 'utf8'), readme(), 'stale: run node packages/text/readme.mjs');
  assert.deepEqual(keptTypes().fenced, [...FENCE_TYPES].sort());
  assert.ok(keptTypes().ownOnly.includes('blockquote'));
});

test('round-trip mode reports a fence import would keep back for a reused id, and anything that is not a block; readable mode is unchanged', () => {
  const doc = [{ type: 'heading', level: 1, text: 'a', id: 'x' }, 'not a block', { type: 'heading', level: 1, text: 'b', id: 'x' }];
  const { markdown, lost } = toMarkdown(doc, ROUND_TRIP);
  assert.deepEqual(lost, [
    { path: '/blocks/1', id: null, type: null, reason: 'not-a-block' },
    { path: '/blocks/2', id: 'x', type: 'heading', reason: 'id' },
  ]);
  assert.deepEqual(fromMarkdown(markdown), [doc[0], { type: 'heading', level: 1, content: [{ type: 'text', value: 'b' }] }]);
  assert.equal(toMarkdown(doc), '# a\n\n# b\n');
  assert.equal(toMarkdown(doc, { mode: 'readable' }), toMarkdown(doc));
});
