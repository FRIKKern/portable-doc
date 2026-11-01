import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MIN_BLOCK_GOLDENS } from '../../scripts/lib/pack.mjs';
import { CODES, compile, validate } from './index.js';

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
  assert.throws(() => compile(block({ properties: { text: { type: 'string', pattern: '^a' } } })), /unsupported schema keyword pattern at #\/definitions\/blocks\/note\/properties\/text/);
  for (const key of ['items', 'not', 'if', 'then']) {
    assert.throws(() => compile(block({ [key]: { format: 'uri' } })), new RegExp(`unsupported schema keyword format at #/definitions/blocks/note/${key}`));
  }
  assert.throws(() => compile(block({ anyOf: [{ type: 'string' }, { format: 'uri' }] })), /unsupported schema keyword format at #\/definitions\/blocks\/note\/anyOf\/1/);
  assert.throws(() => compile(block({ properties: { text: true } })), /schema at #\/definitions\/blocks\/note\/properties\/text is not an object/);
  assert.throws(() => compile({ ...tiny, allOf: [{ $ref: '#/definitions/blocks/missing' }] }), /\$ref #\/definitions\/blocks\/missing does not resolve/);
  assert.doesNotThrow(() => compile(schema));
});
