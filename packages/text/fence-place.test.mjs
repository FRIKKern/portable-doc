// A ```portabledoc fence anywhere but at block level. In a list item it is read where it sits, as a
// block-level fence is: spliced into the item's children when its blocks fit there, else inline
// code in the item with one FENCE_KEPT_AS_CODE notice. A plain quote holds no blocks, so a fence in
// it is inline code with a `place` notice. A fence in text the import keeps flat (a quote in a list
// item, a list in a quote, lists past MAX_DEPTH) is read as that text, with one notice saying why.
// No portabledoc fence becomes text or code without a notice.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DEPTH, MAX_VALUE_DEPTH, validate, walkDepth } from '@portable-doc/validate';
import { CASES as HEADINGS } from '../../fixtures/headings/cases.mjs';
import { CASES as LIST_SPLIT } from '../../fixtures/list-split/cases.mjs';
import { CASES as NESTING } from '../../fixtures/nesting/cases.mjs';
import { parser } from './from-markdown-inline.js';
import { FENCE_KEPT_AS_CODE, readMarkdown } from './index.js';

const t = (value) => ({ type: 'text', value });
const P = [{ type: 'paragraph', content: [t('in fence')] }];
const PJ = JSON.stringify(P);
const NOT_JSON = '[nope';
const INVALID = JSON.stringify([{ type: 'heading', level: 9, content: [] }]);
const fence = (json, pad = '') => ['```portabledoc', json, '```'].map((l) => `${pad}${l}`).join('\n');
const notice = (reason, path, line) => ({ code: FENCE_KEPT_AS_CODE[reason].code, path, line, lines: 3, fix: FENCE_KEPT_AS_CODE[reason].fix });
// `inner` in the item of the n-th list, each list in the item before it; the fence's first line is n + 2.
const lists = (n, inner) => `${Array.from({ length: n }, (_, i) => `${'  '.repeat(i)}- l${i}`).join('\n')}\n\n${inner.split('\n').map((l) => `${'  '.repeat(n)}${l}`).join('\n')}`;
const itemPath = (n) => `/blocks/0${'/items/0/children/0'.repeat(n - 1)}/items/0`;
// The deepest item of `lists(n, …)`.
const deepest = (blocks, n) => Array.from({ length: n - 1 }).reduce((list) => list.items[0].children[0], blocks[0]).items[0];
// n callouts, each in the body of the one before, `inner` in the body of the last.
const callouts = (n, inner) =>
  `${Array.from({ length: n }, (_, i) => `${'> '.repeat(i + 1)}[!info] c${i}\n${'> '.repeat(i + 1).trimEnd()}`).join('\n')}\n${inner.split('\n').map((l) => `${'> '.repeat(n)}${l}`).join('\n')}`;
const read = (md) => {
  const doc = readMarkdown(md);
  assert.deepEqual(validate({ blocks: doc.blocks }), { ok: true }, 'the import never writes a doc validate refuses');
  return doc;
};
const SOURCES = []; // every Markdown this file reads, for the sweep
// Whether a notice's path names a value in the doc's { blocks }.
const resolves = (doc, path) => path.split('/').slice(1).reduce((v, k) => (v === null || typeof v !== 'object' ? undefined : v[k]), { blocks: doc.blocks }) !== undefined;
const readAll = (md) => (SOURCES.push(md), read(md));

test('a fence in a list item that the import splices goes into its children, as a nested list does', () => {
  const doc = readAll(`- item\n\n${fence(PJ, '  ')}`);
  assert.deepEqual(doc, { blocks: [{ type: 'list', ordered: false, items: [{ content: [t('item')], children: P }] }], notices: [], work: doc.work });
});

test('text after a fence in a list item starts a new item, as after a nested list', () => {
  const doc = readAll(`- item\n\n${fence(PJ, '  ')}\n\n  after`);
  assert.deepEqual(doc.blocks[0].items, [{ content: [t('item')], children: P }, [t('after')]]);
  assert.deepEqual(doc.notices, [{ code: 'list_item_split', path: '/blocks/0/items/1', line: 7, lines: 1 }]);
});

test('a fence in a list item the import refuses is inline code in the item, with one notice naming the item and why', () => {
  for (const [reason, json] of [['json', NOT_JSON], ['invalid', INVALID]]) {
    const doc = readAll(`- item\n\n${fence(json, '  ')}`);
    assert.deepEqual(doc.blocks[0].items, [[t('item '), { type: 'code', value: json }]], reason);
    assert.deepEqual(doc.notices, [notice(reason, '/blocks/0/items/0', 3)], reason);
  }
});

test('a fence in an item claims its block ids, as a block-level fence does; a refused one claims none', () => {
  const D = JSON.stringify([{ type: 'divider', id: 'd' }]);
  const doc = readAll(`- item\n\n${fence(D, '  ')}\n\n${fence(D)}`);
  assert.deepEqual(doc.notices, [notice('id', '/blocks/1', 7)]);
  const refused = readAll(`- item\n\n${fence(`${D.slice(0, -1)},{"type":"heading","level":9}]`, '  ')}\n\n${fence(D)}`);
  assert.deepEqual(refused.notices.map((n) => n.code), ['fence_invalid']);
});

test('in the deepest list validate allows, an item holds no blocks: a fence there is inline code, fence_too_deep; one list up it is spliced, as deep as its blocks fit', () => {
  const deep = readAll(lists(MAX_DEPTH, fence(PJ)));
  assert.deepEqual(deepest(deep.blocks, MAX_DEPTH), [t(`l${MAX_DEPTH - 1} `), { type: 'code', value: PJ }]);
  assert.deepEqual(deep.notices, [notice('depth', itemPath(MAX_DEPTH), MAX_DEPTH + 2)]);
  const edge = readAll(lists(MAX_DEPTH - 1, fence(PJ)));
  assert.deepEqual(deepest(edge.blocks, MAX_DEPTH - 1), { content: [t(`l${MAX_DEPTH - 2}`)], children: P });
  assert.deepEqual(edge.notices, []);
  // At the edge a fence of a list holding a block nests one block too deep.
  const LIST = JSON.stringify([{ type: 'list', items: [{ content: [t('x')], children: P }] }]);
  const over = readAll(lists(MAX_DEPTH - 1, fence(LIST)));
  assert.deepEqual(deepest(over.blocks, MAX_DEPTH - 1), [t(`l${MAX_DEPTH - 2} `), { type: 'code', value: LIST }]);
  assert.deepEqual(over.notices, [notice('depth', itemPath(MAX_DEPTH - 1), MAX_DEPTH + 1)]);
});

test('a fence in a list item counts its JSON levels where it sits: the deepest an item holds is spliced, one level more is code there and spliced at the top', () => {
  const ems = (k) => [{ type: 'paragraph', content: [Array.from({ length: k - 1 }).reduce((kid) => ({ type: 'em', children: [kid] }), { type: 'em', children: [t('deep')] })] }];
  // An item's children are four levels below a top-level block's place: list, items, item, children.
  let k = 1;
  while (walkDepth({ blocks: ems(k + 1) }) + 4 <= MAX_VALUE_DEPTH) k++;
  const fits = readAll(`- item\n\n${fence(JSON.stringify(ems(k)), '  ')}`);
  assert.deepEqual([fits.blocks[0].items[0].children, fits.notices], [ems(k), []]);
  const over = JSON.stringify(ems(k + 1));
  const deeper = readAll(`- item\n\n${fence(over, '  ')}`);
  assert.deepEqual([deeper.blocks[0].items, deeper.notices], [[[t('item '), { type: 'code', value: over }]], [notice('depth', '/blocks/0/items/0', 3)]]);
  assert.deepEqual(readAll(fence(over)).blocks, ems(k + 1));
});

test('a fence in a plain quote is inline code in the quote, valid or not, with one place notice; the quote stays whole', () => {
  for (const json of [PJ, NOT_JSON]) {
    const doc = readAll(`> q\n>\n${fence(json, '> ')}\n>\n> after`);
    assert.deepEqual(doc.blocks, [{ type: 'blockquote', content: [t('q '), { type: 'code', value: json }, t(' after')] }], json);
    assert.deepEqual(doc.notices, [notice('place', '/blocks/0', 3)], json);
  }
  const only = readAll(fence(PJ, '> '));
  assert.deepEqual([only.blocks, only.notices], [[{ type: 'blockquote', content: [{ type: 'code', value: PJ }] }], [notice('place', '/blocks/0', 1)]]);
});

test('a fence in the body of a callout as deep as validate allows, whose body is its text, is inline code with fence_too_deep', () => {
  const doc = readAll(callouts(MAX_DEPTH, fence(PJ)));
  const path = `/blocks/0${'/slots/body/0'.repeat(MAX_DEPTH - 1)}`;
  const last = Array.from({ length: MAX_DEPTH - 1 }).reduce((c) => c.slots.body[0], doc.blocks[0]);
  assert.ok(last.content.some((n) => n.type === 'code' && n.value === PJ));
  assert.deepEqual(doc.notices.filter((n) => n.code.startsWith('fence_')), [notice('depth', path, 2 * MAX_DEPTH + 1)]);
});

test('a fence in a callout body counts where it sits: one that would nest past MAX_DEPTH there is a code block with fence_too_deep, not a doc validate refuses', () => {
  const D = MAX_DEPTH - 5;
  const chain = (n) => [Array.from({ length: n - 1 }).reduce((kid) => ({ type: 'list', items: [{ content: [t('x')], children: [kid] }] }), P[0])];
  // In the body of the D-th callout, blocks sit D deep: a chain of 100 - D blocks fits, one more does not.
  const fits = JSON.stringify(chain(MAX_DEPTH - D));
  const over = JSON.stringify(chain(MAX_DEPTH - D + 1));
  const ok = readAll(callouts(D, fence(fits)));
  assert.deepEqual(ok.notices, []);
  const doc = readAll(callouts(D, fence(over)));
  const last = Array.from({ length: D - 1 }).reduce((c) => c.slots.body[0], doc.blocks[0]);
  assert.deepEqual(last.slots.body, [{ type: 'code', value: over }]);
  assert.deepEqual(doc.notices, [notice('depth', `/blocks/0${'/slots/body/0'.repeat(D - 1)}/slots/body/0`, 2 * D + 1)]);
});

test('a fence in text the import keeps flat is read as that text, with one notice: place in a quote or an item, depth past MAX_DEPTH', () => {
  const words = (doc) => JSON.stringify(doc.blocks).includes('in fence');
  // A quote in a list item, and a list in a quote: their text is the item's, the quote's.
  const inItem = readAll(`- item\n\n  > q\n  >\n${fence(PJ, '  > ')}`);
  assert.deepEqual([words(inItem), inItem.notices], [true, [notice('place', '/blocks/0/items/0', 5)]]);
  const inQuote = readAll(`> q\n>\n> - i\n>\n${fence(PJ, '>   ')}`);
  assert.deepEqual([words(inQuote), inQuote.notices], [true, [notice('place', '/blocks/0', 5)]]);
  // Lists past MAX_DEPTH are their text, in the deepest item; past what the parser builds, read from deep source.
  for (const n of [MAX_DEPTH + 1, MAX_DEPTH + 6]) {
    const doc = readAll(lists(n, fence(PJ)));
    assert.deepEqual([words(doc), doc.notices.filter((x) => x.code.startsWith('fence_'))], [true, [notice('depth', itemPath(MAX_DEPTH), n + 2)]], `${n} lists`);
  }
});

test('an empty or blank fence that is the whole of a list item, or of a quote, keeps that item or quote, so its one notice names a block that is there', () => {
  for (const md of [
    '- ```portabledoc\n  ```',
    '- ```portabledoc\n  ```\n- ```portabledoc\n  ```',
    '- ```portabledoc\n     \n  ```',
    '- > ```portabledoc\n  > ```',
    '> ```portabledoc\n> ```',
  ]) {
    const doc = readAll(md);
    assert.equal(doc.notices.filter((n) => n.code.startsWith('fence_')).length, fencesIn(md).length, md);
    for (const n of doc.notices) assert.ok(resolves(doc, n.path), `${md}: ${n.code} at ${n.path}`);
  }
});

test('a fence of another language in a list item or a quote reads as before, with no notice', () => {
  const item = readAll('- item\n\n  ```js\n  x()\n  ```');
  assert.deepEqual([item.blocks[0].items, item.notices], [[[t('item '), { type: 'code', value: 'x()' }]], []]);
  const quote = readAll('> q\n>\n> ```js\n> x()\n> ```');
  assert.deepEqual(quote.notices, []);
});

// Every ```portabledoc fence in a text, deep source too: [first line from 1, its JSON].
function fencesIn(md) {
  const out = [];
  const walk = (tokens, base) => {
    for (const tok of tokens) {
      if (tok.type === 'fence' && tok.info.trim().split(/\s+/)[0] === 'portabledoc') out.push([base + tok.map[0] + 1, tok.content.replace(/\n+$/, '')]);
      if (tok.type === 'deep_source') walk(parser.parse(tok.content, { base: tok.map[0] }), tok.map[0]);
    }
  };
  walk(parser.parse(md, {}), 0);
  return out;
}

test('every portabledoc fence in the shared cases and in this file either reads into blocks or has a notice on its line, and every notice names a value in the blocks', () => {
  const squeeze = (s) => s.replace(/\s+/g, '');
  const sources = [...Object.values(HEADINGS), ...Object.values(LIST_SPLIT), ...Object.values(NESTING), ...SOURCES];
  let fences = 0;
  for (const md of sources) {
    const doc = readMarkdown(md);
    const strings = [];
    JSON.stringify(doc.blocks, (k, v) => (typeof v === 'string' && strings.push(squeeze(v)), v));
    for (const n of doc.notices) assert.ok(resolves(doc, n.path), `${n.code} at ${n.path}, not in the blocks: ${md.slice(0, 80)}`);
    const lines = new Set(doc.notices.filter((n) => n.code.startsWith('fence_')).map((n) => n.line));
    // A fence read into blocks leaves no copy of its JSON; one kept as text or code does. Fences
    // with the same JSON are counted together: no more copies than fences with a notice.
    const byJson = new Map();
    for (const [line, json] of fencesIn(md)) {
      fences++;
      const key = squeeze(json);
      byJson.set(key, [...(byJson.get(key) ?? []), line]);
    }
    for (const [json, at] of byJson) {
      // An empty or blank fence is never read into blocks (it is not JSON): each has its notice.
      if (json === '') {
        assert.ok(at.every((l) => lines.has(l)), `empty fences on lines ${at} without a notice: ${md.slice(0, 80)}`);
        continue;
      }
      const copies = strings.filter((s) => s.includes(json)).length;
      assert.ok(copies <= at.filter((l) => lines.has(l)).length, `fences on lines ${at} kept as text or code without a notice: ${md.slice(0, 80)}`);
    }
  }
  assert.ok(fences >= 20, `the sweep saw ${fences} fences`);
});
