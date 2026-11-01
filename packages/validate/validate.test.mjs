import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MIN_BLOCK_GOLDENS } from '../../scripts/lib/pack.mjs';
import { CODES, MAX_DEPTH, compile, validate } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const jsonIn = (dir) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.json')).sort().map((f) => `${dir}/${f}`);
const byPath = (a, b) => `${a.path} ${a.code}`.localeCompare(`${b.path} ${b.code}`);

const broken = jsonIn('fixtures/broken').map((file) => ({ file, ...read(file) }));
const schema = read('spec/blocks.schema.json');

function gaps(codes, fixtures) {
  const used = new Set(fixtures.flatMap((f) => f.expect.map((e) => e.code)));
  return [
    ...codes.filter((c) => !used.has(c)).map((c) => `${c}: no fixture`),
    ...[...used].filter((c) => !codes.includes(c)).map((c) => `${c}: not a code`),
  ];
}

for (const { file, expect, doc } of broken) {
  test(`${file} is refused with exactly its expected codes and paths`, () => {
    const result = validate(doc);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map(({ code, path }) => ({ code, path })).sort(byPath), [...expect].sort(byPath));
    for (const e of result.errors) assert.ok(typeof e.message === 'string' && e.message.length > 0, `${e.code} has no message`);
  });
}

test('every code has a fixture and every fixture names a known code', () => {
  assert.ok(broken.length >= CODES.length, `${broken.length} broken fixtures for ${CODES.length} codes`);
  assert.deepEqual(gaps(CODES, broken), []);
});

test('a new code without a fixture fails, and a fixture with an unknown code fails', () => {
  assert.deepEqual(gaps([...CODES, 'brand_new'], broken), ['brand_new: no fixture']);
  assert.deepEqual(gaps(CODES, [...broken, { expect: [{ code: 'made_up', path: '' }] }]), ['made_up: not a code']);
});

test('CODES.md lists exactly the codes, in order, with their fixture counts', () => {
  const table = fs.readFileSync(path.join(here, 'CODES.md'), 'utf8').split('\n## ')[0];
  const rows = [...table.matchAll(/^\| `([a-z_]+)` \|[^|]*\|[^|]*\| (\d+) \|/gm)].map((m) => [m[1], Number(m[2])]);
  const count = (code) => broken.filter((f) => f.expect.some((e) => e.code === code)).length;
  assert.deepEqual(rows, CODES.map((code) => [code, count(code)]));
});

test('every valid fixture passes', () => {
  const files = jsonIn('fixtures/valid');
  assert.ok(files.length > 0, 'no valid fixtures');
  for (const file of files) assert.deepEqual(validate(read(file)), { ok: true }, file);
});

test('every block golden input passes as a one-block doc', () => {
  const files = jsonIn('goldens/blocks');
  assert.ok(files.length >= MIN_BLOCK_GOLDENS, `${files.length} block goldens, need ${MIN_BLOCK_GOLDENS}`);
  for (const file of files) assert.deepEqual(validate({ blocks: [read(file).input] }), { ok: true }, file);
});

test('the nested-list golden and every ops golden doc pass', () => {
  assert.deepEqual(validate(read('goldens/nested-list-carriers.json')), { ok: true });
  const ops = jsonIn('goldens/ops');
  assert.ok(ops.length > 0, 'no ops goldens');
  for (const file of ops) {
    const { before, after } = read(file);
    assert.deepEqual(validate(before), { ok: true }, `${file} before`);
    assert.deepEqual(validate(after), { ok: true }, `${file} after`);
  }
});

test('ids inside list item children and card media count, though Elixir skips them', () => {
  const paragraph = (id) => ({ id, type: 'paragraph', text: id });
  const paths = (doc) => validate(doc).errors.map((e) => `${e.code} ${e.path}`);
  assert.deepEqual(paths({ blocks: [paragraph('x'), { type: 'list', items: [{ text: 'item', children: [paragraph('x')] }] }] }), ['duplicate_block_id /blocks/1/items/0/children/0/id']);
  assert.deepEqual(paths({ blocks: [paragraph('x'), { type: 'card', slots: { media: [{ id: 'x', type: 'image', src: 'https://example.com/a.png' }] } }] }), ['duplicate_block_id /blocks/1/slots/media/0/id']);
  assert.deepEqual(paths({ blocks: [paragraph('x'), { type: 'card', slots: { media: [{ id: 'x', type: 'image', src: 5 }] } }] }), ['wrong_field_type /blocks/1/slots/media/0/src', 'duplicate_block_id /blocks/1/slots/media/0/id']);
});

test('a Portable Text block is refused in inline content too', () => {
  const pt = { _type: 'block', children: [{ _type: 'span', text: 'Pasted.' }] };
  assert.deepEqual(validate({ blocks: [{ type: 'paragraph', content: [{ type: 'text', value: 'Fine.' }, pt] }] }).errors.map((e) => `${e.code} ${e.path}`), ['portable_text_block /blocks/0/content/1']);
});

const nest = (depth, wrap) => {
  let block = { type: 'paragraph', text: 'Deep.' };
  for (let i = 1; i < depth; i++) block = wrap(block);
  return { blocks: [block] };
};
const wraps = {
  section: (b) => ({ type: 'section', blocks: [b] }),
  'list children': (b) => ({ type: 'list', items: [{ text: 'item', children: [b] }] }),
  'figure child': (b) => ({ type: 'figure', child: b }),
  'card media': (b) => ({ type: 'card', slots: { media: [b] } }),
};

for (const [name, wrap] of Object.entries(wraps)) {
  test(`${name}: ${MAX_DEPTH} levels pass, ${MAX_DEPTH + 1} and 5000 are too_deep, nothing throws`, () => {
    assert.deepEqual(validate(nest(MAX_DEPTH, wrap)), { ok: true });
    for (const depth of [MAX_DEPTH + 1, 5000]) assert.deepEqual(validate(nest(depth, wrap)).errors.map((e) => e.code), ['too_deep']);
  });
}

test('past MAX_DEPTH a block gets only too_deep: not block_not_object, and its id does not count', () => {
  const under = (inner) => {
    let block = inner;
    for (let i = 0; i < MAX_DEPTH; i++) block = wraps.section(block);
    return block;
  };
  const codes = (doc) => validate(doc).errors.map((e) => e.code);
  assert.deepEqual(codes({ blocks: [under(7)] }), ['too_deep']);
  assert.deepEqual(codes({ blocks: [{ id: 'x', type: 'paragraph', text: 'x' }, under({ id: 'x', type: 'paragraph' })] }), ['too_deep']);
  assert.deepEqual(codes({ blocks: [under({ _type: 'block', children: [] })] }), ['portable_text_block']);
});

test('a thrown or odd call leaves nothing behind for the next', () => {
  const throwing = nest(30, wraps.section);
  let inner = throwing.blocks[0];
  while (inner.type === 'section') inner = inner.blocks[0];
  Object.defineProperty(inner, 'text', { enumerable: true, get() { throw new Error('getter'); } });
  assert.throws(() => validate(throwing), /getter/);
  assert.deepEqual(validate({ blocks: [{ type: 'heading', level: 1n }] }).errors.map((e) => `${e.code} ${e.message}`), ['wrong_field_type no allowed shape takes 1n']);
  assert.deepEqual(validate(nest(MAX_DEPTH, wraps.section)), { ok: true });
});

const wellFormed = (r) =>
  r.ok === true ? Object.keys(r).length === 1
    : r.ok === false && r.errors.length > 0 && r.errors.every((e) => CODES.includes(e.code) && /^(\/.*)?$/.test(e.path) && typeof e.message === 'string' && e.message.length > 0);

test('validate returns a well-formed result for any value put at any node of any golden', () => {
  const odd = [null, 0, -1, 1.5, NaN, Infinity, '', 'x', true, false, [], {}, [null], { type: 'nope' }, { _type: 'block', children: [] }, 1n];
  const nodes = (v, at = []) => (v && typeof v === 'object' ? [at, ...Object.keys(v).flatMap((k) => nodes(v[k], [...at, k]))] : [at]);
  const put = (v, at, x) => {
    if (!at.length) return x;
    const copy = Array.isArray(v) ? [...v] : { ...v };
    copy[at[0]] = put(v[at[0]], at.slice(1), x);
    return copy;
  };
  let runs = 0;
  for (const file of jsonIn('goldens/blocks')) {
    const doc = { blocks: [read(file).input] };
    for (const at of nodes(doc)) {
      for (const x of odd) {
        runs++;
        assert.ok(wellFormed(validate(put(doc, at, x))), `${file} /${at.join('/')} = ${typeof x === 'bigint' ? `${x}n` : JSON.stringify(x)}`);
      }
    }
  }
  assert.ok(runs > 10000, `${runs} runs`);
});

test('validate returns a well-formed result for 2000 seeded random docs that reach every code', () => {
  let seed = 42;
  const rand = (n) => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) % n;
  };
  const types = schema.properties.type.enum;
  const common = ['heading', 'section', 'list', 'paragraph', 'columns', 'card', 'figure', 'tabs'];
  const typeOf = () => (rand(2) === 0 ? common[rand(common.length)] : types[rand(types.length)]);
  const keys = ['id', 'text', 'level', 'blocks', 'children', 'items', 'content', 'columns', 'child', 'slots', 'tabs', 'media', 'rows', 'title'];
  const scalar = () => [null, rand(10) - 3, 1.5, '', 'x', true, typeOf(), 'nope'][rand(8)];
  const value = (depth) => {
    const pick = rand(depth > 6 ? 3 : 10);
    if (pick < 3) return scalar();
    if (pick < 5) return Array.from({ length: rand(4) }, () => value(depth + 1));
    const node = Object.fromEntries(Array.from({ length: rand(4) }, () => [keys[rand(keys.length)], value(depth + 1)]));
    const kind = rand(10);
    if (kind < 7) node.type = typeOf();
    else if (kind === 7) node.type = 'nope';
    else if (kind === 8) Object.assign(node, { _type: 'block', children: [] });
    if (rand(3) === 0) node.id = ['a', 'b', 'c'][rand(3)];
    return node;
  };
  const depthOf = (v) => (v && typeof v === 'object' ? 1 + Math.max(0, ...Object.values(v).map(depthOf)) : 0);
  const docs = new Set();
  const seen = new Set();
  let deepest = 0;
  for (let i = 0; i < 2000; i++) {
    const doc = rand(10) === 0 ? value(0) : { blocks: Array.from({ length: 1 + rand(4) }, () => value(1)) };
    const result = validate(doc);
    assert.ok(wellFormed(result), JSON.stringify(doc));
    docs.add(JSON.stringify(doc));
    deepest = Math.max(deepest, depthOf(doc));
    if (!result.ok) for (const e of result.errors) seen.add(e.code);
  }
  assert.ok(docs.size >= 1500, `${docs.size} distinct docs`);
  assert.deepEqual(CODES.filter((c) => !seen.has(c) && c !== 'too_deep'), []);
  assert.ok(deepest >= 5, `deepest doc is ${deepest}`);
});

test('a cycle through blocks stops at MAX_DEPTH', () => {
  const loop = { type: 'section', blocks: [] };
  loop.blocks.push(loop);
  assert.deepEqual(validate({ blocks: [loop] }).errors.map((e) => e.code), ['too_deep']);
});

test('every type the schema names passes as a bare block', () => {
  assert.ok(schema.properties.type.enum.length >= 80);
  for (const type of schema.properties.type.enum) assert.deepEqual(validate({ blocks: [{ type }] }), { ok: true }, type);
});

const tiny = {
  type: 'object',
  required: ['type'],
  properties: { type: { enum: ['note', 'pair'] }, id: { type: 'string' } },
  allOf: [
    { if: { properties: { type: { const: 'note' } }, required: ['type'] }, then: { $ref: '#/definitions/blocks/note' } },
    { if: { properties: { type: { const: 'pair' } }, required: ['type'] }, then: { $ref: '#/definitions/blocks/pair' } },
  ],
  definitions: {
    blocks: {
      note: {
        'x-tier': 'element',
        properties: {
          text: { type: 'string' },
          size: { type: 'integer', minimum: 1, maximum: 3 },
          kind: { const: 'plain' },
          tag: { not: { type: 'string' } },
          body: { type: 'array', items: { $ref: '#' } },
          ref: { anyOf: [{ type: 'string' }, { type: 'object', required: ['a'], properties: { a: { type: 'string' }, b: { type: 'string' } } }] },
          either: { anyOf: [{ type: 'string' }, { required: ['a'] }, { type: 'object', required: ['c'] }] },
          media: { type: 'array', items: { anyOf: [{ $ref: '#' }, { type: 'string' }] } },
        },
      },
      pair: { properties: { left: { $ref: '#' }, right: { $ref: '#' } } },
    },
    constraints: { additionalProperties: false },
  },
};

test('compile follows the schema it is given, keyword by keyword', () => {
  const check = compile(tiny);
  const codes = (doc) => {
    const r = check(doc);
    return r.ok ? [] : r.errors.map((e) => `${e.code} ${e.path}`);
  };
  assert.deepEqual(codes({ blocks: [{ type: 'note', text: 'ok', size: 2, kind: 'plain', tag: 1, ref: 'x' }] }), []);
  assert.deepEqual(codes({ blocks: [{ type: 'paragraph' }] }), ['unknown_block_type /blocks/0/type']);
  assert.deepEqual(codes({ blocks: [{ type: 'note', size: 4 }] }), ['value_not_allowed /blocks/0/size']);
  assert.deepEqual(codes({ blocks: [{ type: 'note', size: 1.5 }] }), ['wrong_field_type /blocks/0/size']);
  assert.deepEqual(codes({ blocks: [{ type: 'note', kind: 'fancy' }] }), ['value_not_allowed /blocks/0/kind']);
  assert.deepEqual(codes({ blocks: [{ type: 'note', tag: 'no' }] }), ['value_not_allowed /blocks/0/tag']);
  assert.deepEqual(codes({ blocks: [{ type: 'note', ref: { b: 1 } }] }), ['missing_required_field /blocks/0/ref/a', 'wrong_field_type /blocks/0/ref/b']);
  assert.deepEqual(codes({ blocks: [{ type: 'note', ref: 3 }] }), ['wrong_field_type /blocks/0/ref']);
  assert.deepEqual(codes({ blocks: [{ type: 'note', either: { b: 1 } }] }), ['missing_required_field /blocks/0/either/a']);
  assert.deepEqual(codes({ blocks: [{ type: 'note', media: ['ok', 5] }] }), ['wrong_field_type /blocks/0/media/1']);
  assert.deepEqual(codes({ blocks: [{ type: 'note', body: [{ type: 'note', text: 1 }] }] }), ['wrong_field_type /blocks/0/body/0/text']);
  assert.deepEqual(codes({ blocks: [{ type: 'pair', left: { id: 'x', type: 'note' }, right: { id: 'x', type: 'note' } }] }), ['duplicate_block_id /blocks/0/right/id']);
  assert.deepEqual(codes({ blocks: [{ type: 'note', 'a/b~c': 1 }] }), []);
});

test('ids count only where a block was accepted, and pointers escape ~ and /', () => {
  const check = compile({
    type: 'object',
    required: ['type'],
    properties: { type: { enum: ['box'] }, id: { type: 'string' }, 'a/b~c': { type: 'array', items: { anyOf: [{ $ref: '#' }, { type: 'object', properties: { id: { type: 'string' } } }] } } },
  });
  assert.deepEqual(check({ blocks: [{ id: 'x', type: 'box', 'a/b~c': [{ id: 'x' }] }] }), { ok: true });
  assert.deepEqual(check({ blocks: [{ id: 'x', type: 'box', 'a/b~c': [7] }] }).errors.map((e) => e.path), ['/blocks/0/a~1b~0c/0']);
});

test('compile refuses a schema it cannot follow', () => {
  const block = (extra) => ({ ...tiny, definitions: { ...tiny.definitions, blocks: { ...tiny.definitions.blocks, note: { ...tiny.definitions.blocks.note, ...extra } } } });
  assert.throws(() => compile(block({ additionalProperties: false })), /unsupported schema keyword additionalProperties at #\/definitions\/blocks\/note/);
  assert.throws(() => compile(block({ else: {} })), /unsupported schema keyword else/);
  assert.throws(() => compile(block({ type: 'date' })), /unsupported schema type date/);
  assert.throws(() => compile(block({ 'nox-tier': 1 })), /unsupported schema keyword nox-tier/);
  assert.throws(() => compile(block({ xtier: 1 })), /unsupported schema keyword xtier/);
  assert.throws(() => compile(block({ properties: { kind: { const: { a: 1 } } } })), /unsupported schema const or enum value \{"a":1\} at #\/definitions\/blocks\/note\/properties\/kind/);
  assert.throws(() => compile(block({ properties: { kind: { enum: ['a', ['b']] } } })), /unsupported schema const or enum value \["b"\]/);
  assert.throws(() => compile(block({ properties: { kind: { const: 'a', enum: ['a', { b: 1 }] } } })), /unsupported schema const or enum value \{"b":1\}/);
  assert.throws(() => compile(block({ properties: { kind: { enum: 'abc' } } })), /schema enum at #\/definitions\/blocks\/note\/properties\/kind is not an array/);
  assert.doesNotThrow(() => compile(block({ properties: { kind: { enum: ['a', 1, true, null] } } })));
  assert.throws(() => compile(block({ properties: { text: { type: 'string', pattern: '^a' } } })), /unsupported schema keyword pattern at #\/definitions\/blocks\/note\/properties\/text/);
  for (const key of ['items', 'not', 'if', 'then']) {
    assert.throws(() => compile(block({ [key]: { format: 'uri' } })), new RegExp(`unsupported schema keyword format at #/definitions/blocks/note/${key}`));
  }
  assert.throws(() => compile(block({ anyOf: [{ type: 'string' }, { format: 'uri' }] })), /unsupported schema keyword format at #\/definitions\/blocks\/note\/anyOf\/1/);
  assert.throws(() => compile(block({ properties: { text: true } })), /schema at #\/definitions\/blocks\/note\/properties\/text is not an object/);
  assert.throws(() => compile({ ...tiny, allOf: [{ $ref: '#/definitions/blocks/missing' }] }), /\$ref #\/definitions\/blocks\/missing does not resolve/);
  assert.doesNotThrow(() => compile(schema));
});
