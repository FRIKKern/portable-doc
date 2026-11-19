import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { parse as parseJs } from 'acorn';
import { buildSync, transformSync } from 'esbuild';
import { validate } from '@portable-doc/validate';
import { bundlePlayground } from './playground/build.mjs';
import { playgroundExamples } from './playground/examples.mjs';
import { parseJson, prettyBytes, tidyJson } from './playground/parse.js';
import { decodeShare, encodeShare, MAX_DOC_BYTES, overCap, utf8Length } from './playground/share.js';
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

// The size guard finds every <, <=, > or >= with a size on one side (.length,
// .byteLength, .size), and every comparison, == and != too, with a cap-like name
// (cap, max, limit, bytes, size, ...) or a number of 100,000 or more. It parses, so
// comments, strings and line breaks do not matter. A size rule belongs in overCap;
// any other match must be listed in SIZE_COMPARES on purpose.
const SIZE_WORDS = new Set(['cap', 'caps', 'max', 'limit', 'limits', 'stop', 'budget', 'bytes', 'byte', 'size', 'long', 'threshold']);
const isCapName = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').split('_').some((word) => SIZE_WORDS.has(word.toLowerCase()));

function sizeMarks(node, found = { size: false, cap: false, big: false }) {
  if (Array.isArray(node)) node.forEach((child) => sizeMarks(child, found));
  else if (node && typeof node === 'object') {
    if (node.type === 'Literal' && typeof node.value === 'number' && Math.abs(node.value) >= 100_000) found.big = true;
    if (node.type === 'Identifier' && isCapName(node.name)) found.cap = true;
    if (node.type === 'MemberExpression' && !node.computed) {
      if (['length', 'byteLength', 'size'].includes(node.property.name)) found.size = true;
      sizeMarks(node.object, found);
      if (!(node.object.type === 'Identifier' && node.object.name === 'Math')) sizeMarks(node.property, found);
    } else for (const [key, value] of Object.entries(node)) if (key !== 'type') sizeMarks(value, found);
  }
  return found;
}

function sizeCompares(source, loader = 'js') {
  const js = transformSync(source, { loader, format: 'esm' }).code;
  const hits = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (node.type === 'BinaryExpression' && /^(<|>|<=|>=|==|===|!=|!==)$/.test(node.operator)) {
      const marks = sizeMarks([node.left, node.right]);
      if (marks.cap || marks.big || (marks.size && /[<>]/.test(node.operator))) hits.push(js.slice(node.start, node.end));
    }
    for (const [key, value] of Object.entries(node)) if (key !== 'type') walk(value);
  };
  walk(parseJs(js, { ecmaVersion: 'latest', sourceType: 'module' }));
  return hits;
}

// Each compare the guard allows, by file and code, with how often it appears and why.
const SIZE_COMPARES = {
  'share.js: byteSize(x) > limit': [1, 'overCap itself, the one place a size meets a cap'],
  'share.js: i < text.length': [1, 'utf8Length walks the text'],
  'share.js: i + 1 < text.length': [1, 'utf8Length looks one unit ahead for a surrogate pair'],
  'share.js: i < bytes.length': [1, 'the base64 encoder walks the bytes in chunks'],
  'share.js: at >= bytes.length': [1, 'the inflate stream ends at the end of its input'],
  'share.js: packed.length < plain.length': [1, 'picks the shorter of two links to the same doc'],
  'parse.js: i < text.length': [2, "the JSON reader's cursor against the end of the text"],
  'main.jsx: url.length > LONG_LINK': [1, 'a note that a share link is long; a URL is ASCII and nothing is refused'],
};

test('every playground size rule counts UTF-8 bytes through overCap, and any other size compare is listed with a reason', () => {
  const dir = new URL('./playground/', import.meta.url);
  const found = {};
  for (const name of fs.readdirSync(dir).filter((f) => /\.(js|jsx|mjs)$/.test(f))) {
    for (const code of sizeCompares(fs.readFileSync(new URL(name, dir), 'utf8'), name.endsWith('.jsx') ? 'jsx' : 'js')) found[`${name}: ${code}`] = (found[`${name}: ${code}`] ?? 0) + 1;
  }
  const listed = Object.fromEntries(Object.entries(SIZE_COMPARES).map(([key, [count]]) => [key, count]));
  assert.deepEqual(found, listed, 'a size is compared outside overCap: route it through overCap, or list it in SIZE_COMPARES with a reason');
  const dodges = [
    'text.length > cap', 'text.length > 2_000_000', 'text.length > 2e6', 'MAX_DOC_BYTES - text.length < 0', '!(text.length <= max)',
    'Math.max(text.length, MAX_DOC_BYTES) !== MAX_DOC_BYTES', 'text.length < MAX', 'text.length >\n MAX_DOC_BYTES', 'text.length>MAX_DOC_BYTES',
    'bytes.length > LIMIT', 'text.length > maxBytes', 'url.length > LONG_LINK', 'blob.size > MAX_DOC_BYTES', 'text.length > limitBytes',
  ];
  for (const dodge of dodges) assert.equal(sizeCompares(`f(${dodge});`).length, 1, dodge);
  assert.deepEqual(sizeCompares("// a doc over limit > 2 MB is refused\nconst msg = 'over the limit > cap';\nx.length === 0;"), []);
  assert.equal(overCap('é'.repeat(3), 5), true);
  assert.equal(overCap('é'.repeat(3), 6), false);
  assert.equal(overCap(new Uint8Array(7), 6), true);
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
  let render;
  try {
    const file = path.join(dir, 'panes.cjs');
    fs.writeFileSync(file, outputFiles[0].contents);
    ({ render } = createRequire(import.meta.url)(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const html = render({ html: '<p>x</p>', markdown: 'x', text: 'x', stale: true });
  const tablist = /<div[^>]*role="tablist"[^>]*>(.*?)<\/div>/.exec(html)?.[1];
  assert.ok(tablist, 'a tablist');
  assert.deepEqual(tablist.replace(/<button[^>]*role="tab"[^>]*>[^<]*<\/button>/g, ''), '', 'nothing in the tablist but tabs');
  assert.ok(html.includes('last good render'), 'the note is still shown');
  assert.ok(!render({ html: '', markdown: '', text: '', stale: false }).includes('last good render'));
});
