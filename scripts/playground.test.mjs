import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validate } from '@portable-doc/validate';
import { bundlePlayground } from './playground/build.mjs';
import { playgroundExamples } from './playground/examples.mjs';
import { parseJson } from './playground/parse.js';
import { decodeShare, encodeShare } from './playground/share.js';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

test('the playground bundle is byte-identical across builds and carries no paths or source map', () => {
  const first = bundlePlayground();
  assert.ok(first.equals(bundlePlayground()), 'two builds differ');
  const text = first.toString('utf8');
  assert.ok(first.length > 100_000, `${first.length} bytes: React or the renderer is missing`);
  assert.doesNotMatch(text, /sourceMappingURL|\/Users\/|\/Volumes\/|[A-Z]:\\\\/);
  assert.doesNotMatch(text, /\bprocess\.env\b/, 'NODE_ENV was not defined for the browser');
});

test('the example menu opens on the starter doc and covers every golden block type', () => {
  const examples = playgroundExamples();
  const types = fs.readdirSync(path.join(root, 'goldens', 'blocks')).filter((file) => file.endsWith('.golden.json')).map((file) => file.replace('.golden.json', '')).sort();
  assert.ok(types.length >= 80, `${types.length} goldens`);
  assert.deepEqual(examples.filter((example) => example.group === 'Block types').map((example) => example.doc.blocks[0].type).sort(), types);
  assert.equal(new Set(examples.map((example) => example.id)).size, examples.length, 'example ids repeat');
  const [starter] = examples;
  assert.equal(starter.id, 'starter');
  assert.deepEqual(validate(starter.doc), { ok: true });
  const blocks = starter.doc.blocks;
  for (const type of ['heading', 'paragraph', 'list', 'callout', 'code', 'table']) assert.ok(blocks.some((block) => block.type === type), `starter has no ${type}`);
  const marks = blocks.filter((block) => block.type === 'paragraph').flatMap((block) => block.content).flatMap((node) => node.marks ?? []).map((mark) => mark.type);
  for (const mark of ['bold', 'italic', 'code', 'link']) assert.ok(marks.includes(mark), `starter has no ${mark} mark`);
  assert.equal(validate(examples.find((example) => example.id === 'three-mistakes').doc).ok, false);
});

test('share links round-trip a doc, compressed or not, and bad JSON says its line and column', async () => {
  const text = JSON.stringify({ blocks: [{ type: 'heading', level: 2, text: 'Blåbær ✓ 🐕' }, ...Array.from({ length: 30 }, (_, i) => ({ type: 'paragraph', content: `line ${i}` }))] });
  const packed = await encodeShare(text);
  assert.match(packed, /^#doc=deflate\.[A-Za-z0-9_-]+$/);
  assert.equal(await decodeShare(packed), text);
  const plain = await encodeShare(text, { compress: false });
  assert.match(plain, /^#doc=json\.[A-Za-z0-9_-]+$/);
  assert.equal(await decodeShare(plain), text);
  assert.equal(await decodeShare('#blocks'), null);
  await assert.rejects(decodeShare('#doc=zip.AAAA'), /unknown link format/);
  assert.deepEqual(parseJson('{\n  "blocks": [\n    { "type": "x", }\n  ]\n}').error, { line: 3, column: 20, message: 'unexpected "}"' });
  assert.deepEqual(parseJson('[1, 2').error, { line: 1, column: 6, message: 'the text ends too early' });
  assert.equal(parseJson('['.repeat(50_000) + ']'.repeat(50_000)).ok, true);
});
