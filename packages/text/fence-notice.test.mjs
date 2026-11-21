// A ```portabledoc fence the import does not splice stays a code block of its source, and
// readMarkdown says why with one notice: `{ code, path, line, lines, fix }`, the code block's path,
// the fence's first line (from 1) and how many lines it spans, and what to change. One code for
// each reason checkFence gives, and one for a fence that is not JSON (FENCE_KEPT_AS_CODE).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DEPTH, MAX_VALUE_DEPTH, blockSchema, validate, walkDepth } from '@portable-doc/validate';
import { TABLE } from './alias-table.js';
import { currentNames } from './current-names.js';
import { FENCE_KEPT_AS_CODE, readMarkdown } from './index.js';

const fence = (json) => `\`\`\`portabledoc\n${json}\n\`\`\``;
const t = (value) => ({ type: 'text', value });
const divider = (id) => ({ type: 'divider', id });
const ems = (k) => [Array.from({ length: k - 1 }).reduce((kids) => ({ type: 'em', children: [kids] }), { type: 'em', children: [t('deep')] })];

// Each reason: the fence's JSON, and the source before it.
const REFUSED = {
  json: { json: '[{"type": "divider"' },
  count: { json: JSON.stringify(Array.from({ length: 51 }, () => ({ type: 'divider' }))) },
  // 498 em under a paragraph: a valid doc as an array, MAX_VALUE_DEPTH deep; the fence counts its
  // blocks inside { blocks }, one level more.
  depth: { json: JSON.stringify([{ type: 'paragraph', content: ems(498) }]) },
  type: { json: JSON.stringify([{ type: 'image', src: 'https://a.example/x.png' }]) },
  address: { json: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', value: 'x', marks: [{ type: 'link', href: 'javascript:alert(1)' }] }] }]) },
  invalid: { json: JSON.stringify([{ type: 'heading', level: 9, content: [] }]) },
  // A second fence reusing a block id of the first.
  id: { json: JSON.stringify([divider('d')]), before: `${fence(JSON.stringify([divider('d')]))}\n\n` },
};

test('one code a reason, each with its fix, and no code twice', () => {
  assert.deepEqual(Object.keys(FENCE_KEPT_AS_CODE), Object.keys(REFUSED));
  const codes = Object.values(FENCE_KEPT_AS_CODE).map((r) => r.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const [reason, { code, fix }] of Object.entries(FENCE_KEPT_AS_CODE)) assert.ok(/^fence_[a-z_]+$/.test(code) && fix.trim() !== '', reason);
});

for (const [reason, { json, before = '' }] of Object.entries(REFUSED)) {
  test(`a fence refused for ${reason} stays a code block of its source, with one ${FENCE_KEPT_AS_CODE[reason].code} notice naming its line and the fix`, () => {
    if (reason === 'depth') assert.deepEqual([validate(JSON.parse(json)).ok, walkDepth(JSON.parse(json)), walkDepth({ blocks: JSON.parse(json) })], [true, MAX_VALUE_DEPTH, MAX_VALUE_DEPTH + 1]);
    const { blocks, notices } = readMarkdown(`${before}${fence(json)}\n`);
    const at = blocks.length - 1;
    assert.deepEqual(blocks.at(-1), { type: 'code', value: json });
    const line = before.split('\n').length;
    assert.deepEqual(notices, [{ code: FENCE_KEPT_AS_CODE[reason].code, path: `/blocks/${at}`, line, lines: 3, fix: FENCE_KEPT_AS_CODE[reason].fix }]);
  });
}

test('a refused fence in a callout body names the code block there', () => {
  const { blocks, notices } = readMarkdown(`> [!info] A\n>\n> ${fence('nope').replace(/\n/g, '\n> ')}\n`);
  assert.deepEqual(blocks[0].slots.body, [{ type: 'code', value: 'nope' }]);
  assert.deepEqual(notices.map((n) => [n.code, n.path, n.line, n.lines]), [['fence_not_json', '/blocks/0/slots/body/0', 3, 3]]);
});

// checkFence counts a fence's depth twice: as written, and with old names under their current
// names. The second can refuse only a fence the first lets through, which needs a fold that
// reaches MAX_VALUE_DEPTH. A fold turns a block's old `text` string into inline content, two
// levels below where the string sat; it folds only where the schema puts blocks, not in open
// fields. So the deepest folded level is the deepest a valid block sits, plus the fold's levels:
// read here from the schema and the alias table. While that stays under MAX_VALUE_DEPTH no fence
// reaches the second count, and its notice (fence_too_deep, as the first) has no row of its own.
test('no valid fence is too deep only once its old names fold: the bound stays under MAX_VALUE_DEPTH', () => {
  const resolve = (ref) => ref.slice(2).split('/').reduce((n, k) => n[k], blockSchema);
  // The most JSON levels from a value `node` matches down to a block (a `#` ref).
  const longest = (node, seen = new Set()) => {
    if (!node || typeof node !== 'object') return -Infinity;
    if (node.$ref === '#') return 0;
    let best = -Infinity;
    if (node.$ref) {
      assert.ok(!seen.has(node.$ref), `${node.$ref}: the schema refers to itself; count its levels another way`);
      best = longest(resolve(node.$ref), new Set([...seen, node.$ref]));
    }
    for (const child of Object.values(node.properties ?? {})) best = Math.max(best, 1 + longest(child, seen));
    for (const item of [node.items, node.additionalProperties].flat()) best = Math.max(best, 1 + longest(item, seen));
    for (const branch of [...(node.allOf ?? []), ...(node.anyOf ?? []), ...(node.oneOf ?? []), node.then, node.else]) best = Math.max(best, longest(branch, seen));
    return best;
  };
  const perBlock = Math.max(...blockSchema.allOf.map((b) => longest(b.then)));
  // In { blocks }: the doc 1, blocks 2, a top-level block 3, then perBlock more a block level.
  const deepestBlock = 3 + (MAX_DEPTH - 1) * perBlock;
  // The converts the fold has: only inline-from-string adds levels (a string to a list of one text node).
  const converts = new Set(Object.values(TABLE.aliases).map((a) => a.convert).filter(Boolean));
  assert.deepEqual([...converts].sort(), ['columns-from-cols', 'head-from-header', 'inline-from-string', 'text-from-inline'], 'a new convert: count its levels here');
  // From the block to the string's object: two for each list of items on the way; then the list and its node.
  const foldLevels = Math.max(...Object.entries(TABLE.aliases).filter(([, a]) => a.convert === 'inline-from-string').map(([key]) => 2 * (key.split('[]').length - 1) + 2));
  // The schema walk meets the doc it bounds: a list chain MAX_DEPTH deep whose deepest item has an old `text`.
  const chain = Array.from({ length: MAX_DEPTH - 1 }).reduce((b) => ({ type: 'list', items: [{ content: [t('x')], children: [b] }] }), { type: 'list', items: [{ text: 'deep' }] });
  assert.equal(validate([chain]).ok, true);
  assert.equal(walkDepth({ blocks: currentNames([chain]) }), deepestBlock + foldLevels);
  assert.ok(deepestBlock + foldLevels <= MAX_VALUE_DEPTH, `a fold now reaches ${deepestBlock + foldLevels} levels: add a row for a fence too deep only once its old names fold`);
});
