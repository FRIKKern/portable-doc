import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { buildSync } from 'esbuild';
import { validate } from '@portable-doc/validate';
import { bundlePlayground } from './playground/build.mjs';
import { playgroundExamples } from './playground/examples.mjs';
import { parseJson, prettyBytes, tidyJson } from './playground/parse.js';
import { decodeShare, encodeShare, MAX_DOC_BYTES, utf8Length } from './playground/share.js';
import { docFromMarkdown, outputsOf } from './playground/outputs.js';
import { toMarkdown, toPlainText } from '@portable-doc/text';

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
  await assert.rejects(decodeShare('#doc=zip.AAAA'), /unknown format "zip"/);
  assert.deepEqual(parseJson('{\n  "blocks": [\n    { "type": "x", }\n  ]\n}').error, { line: 3, column: 20, message: 'unexpected "}"' });
  assert.deepEqual(parseJson('[1, 2').error, { line: 1, column: 6, message: 'the text ends too early' });
  assert.equal(parseJson('['.repeat(50_000) + ']'.repeat(50_000)).ok, true);
});

test('a share link refuses a doc too big to open, packed or plain, and a damaged link says so', async () => {
  const huge = `{"blocks":[{"type":"paragraph","content":"${'a'.repeat(20_000_000)}"}]}`;
  const bomb = `#doc=deflate.${zlib.deflateRawSync(Buffer.from(huge), { level: 9 }).toString('base64url')}`;
  assert.ok(bomb.length < 40_000, `${bomb.length} chars`);
  await assert.rejects(decodeShare(bomb), /^Error: This link holds a doc too big to open \(over 2 MB\)$/);
  const over = 'a'.repeat(MAX_DOC_BYTES + 1);
  await assert.rejects(decodeShare(`#doc=json.${Buffer.from(over).toString('base64url')}`), /too big to open/);
  await assert.rejects(decodeShare(`#doc=deflate.${zlib.deflateRawSync(Buffer.from(over)).toString('base64url')}`), /too big to open/);
  await assert.rejects(encodeShare(over), /too big to share/);
  const fits = 'a'.repeat(MAX_DOC_BYTES);
  assert.equal(await decodeShare(await encodeShare(fits)), fits);
  await assert.rejects(decodeShare(`#doc=deflate.${Buffer.from('not deflate at all, just text').toString('base64url')}`), /^Error: This link is damaged: its compressed doc does not unpack$/);
  await assert.rejects(decodeShare(`#doc=json.${Buffer.from([0xff, 0xfe]).toString('base64url')}`), /not valid UTF-8/);
});

test('a doc from a link is pretty-printed only while the laid-out text stays under the cap', () => {
  for (const { doc } of playgroundExamples()) assert.equal(prettyBytes(doc), Buffer.byteLength(JSON.stringify(doc, null, 2)));
  const nest = (depth) => '['.repeat(depth) + ']'.repeat(depth);
  assert.equal(tidyJson(nest(1000), MAX_DOC_BYTES).length, 2_000_000, 'depth 1000 lays out to exactly the cap');
  assert.equal(tidyJson(nest(1001), MAX_DOC_BYTES), nest(1001));
  const started = performance.now();
  assert.equal(tidyJson(nest(50_000), MAX_DOC_BYTES), nest(50_000), 'deep nesting kept as sent, not 5 GB of spaces or a stack overflow');
  assert.ok(performance.now() - started < 500, 'the size check is cheap');
  assert.equal(tidyJson('{"blocks":[]}', MAX_DOC_BYTES), '{\n  "blocks": []\n}');
  assert.equal(tidyJson('{"blocks":', MAX_DOC_BYTES), '{"blocks":');
});

test('the layout cap counts UTF-8 bytes, not characters, for pasted Markdown and links alike', () => {
  for (const odd of ['', 'a', 'é', '漢', '😀', '\0', '\u2028', '\ud800', 'x\udc00y', 'ø漢😀é\ud83d']) {
    assert.equal(utf8Length(odd), Buffer.byteLength(odd), JSON.stringify(odd));
  }
  const doc = { blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'ø漢😀 '.repeat(40) }] }] };
  assert.equal(prettyBytes(doc), Buffer.byteLength(JSON.stringify(doc, null, 2)));
  const md = 'ø漢😀 '.repeat(40) + '\n\n' + '- 漢字 😀\n'.repeat(20);
  const compact = JSON.stringify({ blocks: JSON.parse(docFromMarkdown(md).text).blocks });
  const laid = JSON.stringify(JSON.parse(compact), null, 2);
  assert.ok(laid.length < Buffer.byteLength(laid));
  const limit = laid.length + Math.floor((Buffer.byteLength(laid) - laid.length) / 2);
  assert.ok(Buffer.byteLength(compact) <= limit && laid.length <= limit && Buffer.byteLength(laid) > limit);
  assert.equal(docFromMarkdown(md, limit).text, compact, 'laid out only while its UTF-8 bytes fit');
  assert.equal(tidyJson(compact, limit), compact);
  assert.equal(tidyJson(compact, Buffer.byteLength(laid)), laid);
});

test('the bundle carries the HTML, Markdown and text views, and pasted Markdown becomes a valid doc', () => {
  const text = bundlePlayground().toString('utf8');
  for (const label of ['Render', 'HTML', 'Markdown', 'Text', 'Paste Markdown', 'Make a doc']) assert.ok(text.includes(`"${label}"`), `bundle has no "${label}"`);
  const [starter] = playgroundExamples();
  const out = outputsOf(starter.doc);
  assert.deepEqual([out.markdown, out.text], [toMarkdown(starter.doc), toPlainText(starter.doc)]);
  assert.ok(out.markdown.includes('**') && !out.text.includes('**'), 'Markdown has marks, text has none');
  const made = docFromMarkdown('## Plan\n\nShip **it** with [docs](https://example.com).\n\n- [x] parse\n- [ ] render\n\n| a | b |\n| - | - |\n| 1 | 2 |\n');
  const parsed = parseJson(made.text);
  assert.ok(parsed.ok);
  assert.deepEqual(validate(parsed.value), { ok: true });
  assert.deepEqual(parsed.value.blocks.map((b) => b.type), ['heading', 'paragraph', 'list', 'table']);
  assert.equal(made.blocks, 4);
  assert.equal(made.text, JSON.stringify(parsed.value, null, 2));
  for (const odd of ['', '<script>alert(1)</script>', '>'.repeat(5000)]) assert.deepEqual(validate(parseJson(docFromMarkdown(odd).text).value), { ok: true }, odd.slice(0, 20));
});

test('a doc made from pasted Markdown takes the share-link path: laid out only under the cap, and refused past it', () => {
  const markdown = Array.from({ length: 300 }, (_, i) => `- item ${i}\n  - nested ${i}`).join('\n');
  const compact = JSON.stringify({ blocks: (() => { const { text } = docFromMarkdown(markdown); return JSON.parse(text).blocks; })() });
  const laidOut = JSON.stringify(JSON.parse(compact), null, 2);
  // A cap between the compact and laid-out sizes: the doc fits, but only as sent.
  const cap = Math.floor((compact.length + laidOut.length) / 2);
  const fits = docFromMarkdown(markdown, cap);
  assert.equal(fits.text, tidyJson(compact, cap));
  assert.equal(fits.text, compact);
  assert.equal(fits.blocks, 1);
  assert.equal(docFromMarkdown(markdown, laidOut.length).text, laidOut, 'laid out when that fits');
  const over = docFromMarkdown(markdown, compact.length - 1);
  assert.equal(over.text, undefined);
  assert.match(over.error, /^The Markdown makes a doc too big for the editor \(over /);
  assert.equal(docFromMarkdown('# Hi').text, tidyJson(JSON.stringify(JSON.parse(docFromMarkdown('# Hi').text)), MAX_DOC_BYTES), 'the default cap is the share links\' MAX_DOC_BYTES');
});

test('the "last good render" note sits outside the tablist, which holds only tabs', async () => {
  const { outputFiles } = buildSync({
    absWorkingDir: root,
    stdin: {
      contents: "import { createElement } from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { Outputs } from './scripts/playground/panes.jsx'; export const render = (view) => renderToStaticMarkup(createElement(Outputs, { view, onRenderClick() {} }));",
      resolveDir: root,
      loader: 'jsx',
    },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    write: false,
    logLevel: 'silent',
  });
  // The panes, React and its server renderer in one file, so they share one React.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-doc-playground-'));
  const file = path.join(dir, 'panes.cjs');
  fs.writeFileSync(file, outputFiles[0].contents);
  const { render } = createRequire(import.meta.url)(file);
  fs.rmSync(dir, { recursive: true, force: true });
  const html = render({ html: '<p>x</p>', markdown: 'x', text: 'x', stale: true });
  const tablist = /<div[^>]*role="tablist"[^>]*>(.*?)<\/div>/.exec(html)?.[1];
  assert.ok(tablist, 'a tablist');
  assert.deepEqual(tablist.replace(/<button[^>]*role="tab"[^>]*>[^<]*<\/button>/g, ''), '', 'nothing in the tablist but tabs');
  assert.ok(html.includes('last good render'), 'the note is still shown');
  assert.ok(!render({ html: '', markdown: '', text: '', stale: false }).includes('last good render'));
});
