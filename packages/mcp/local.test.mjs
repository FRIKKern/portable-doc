import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { toMarkdown, toPlainText } from '@portable-doc/text';
import { FAKE_TOKEN, readerHtml, startFakeReader } from './test/fake-reader.mjs';

const BIN = fileURLToPath(new URL('bin/portable-doc-mcp.mjs', import.meta.url));
const TIMEOUT = { timeout: 20_000 };
const spec = JSON.parse(fs.readFileSync(new URL('../../spec/blocks.schema.json', import.meta.url), 'utf8')).definitions;
const golden = (name) => JSON.parse(fs.readFileSync(new URL(`../../goldens/blocks/${name}.golden.json`, import.meta.url), 'utf8')).input;
const DOC = { title: 'Local', blocks: [{ id: 'h', ...golden('heading') }, { id: 'c', ...golden('callout') }] };
const BROKEN = { blocks: [{ type: 'heading', level: 0, text: 'x' }, { type: 'nope' }] };

async function connect(env) {
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN], env, stderr: 'pipe' }));
  return client;
}

const call = (client, name, args) => client.callTool({ name, arguments: args }, undefined, TIMEOUT);

async function invalid(promise, pattern) {
  await assert.rejects(promise, (e) => {
    assert.equal(e.code, ErrorCode.InvalidParams, e.message);
    assert.match(e.message, pattern);
    return true;
  });
}

describe('with no Barkpark server', () => {
  let client;
  before(async () => {
    client = await connect({});
  });
  after(() => client.close());

  test('render with no BARKPARK_URL renders the doc locally, the same HTML as the reader goldens', async () => {
    const result = await call(client, 'render', { doc: DOC });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.deepEqual(result.structuredContent, { html: readerHtml(DOC.blocks) });
    assert.deepEqual((await call(client, 'render', { doc: DOC.blocks, format: 'html' })).structuredContent, { html: readerHtml(DOC.blocks) });
  });

  test('format markdown and text return @portable-doc/text output', async () => {
    assert.deepEqual((await call(client, 'render', { doc: DOC, format: 'markdown' })).structuredContent, { markdown: toMarkdown(DOC) });
    assert.deepEqual((await call(client, 'render', { doc: DOC.blocks, format: 'text' })).structuredContent, { text: toPlainText(DOC) });
  });

  test('a broken doc is a tool error carrying the validator codes, in every format', async () => {
    for (const format of ['html', 'markdown', 'text']) {
      const result = await call(client, 'render', { doc: BROKEN, format });
      assert.equal(result.isError, true, format);
      assert.deepEqual(result.structuredContent.errors.map((e) => [e.code, e.path]), [['value_not_allowed', '/blocks/0/level'], ['unknown_block_type', '/blocks/1/type']]);
      assert.match(result.content[0].text, /does not validate/);
      assert.equal(Object.hasOwn(result.structuredContent, format === 'text' ? 'text' : format), false);
    }
  });

  test('blocks lists every spec type and alias; blocks {type} gives its fields and golden example', async () => {
    const list = (await call(client, 'blocks', {})).structuredContent;
    assert.deepEqual(list.blocks.map((b) => b.type), Object.keys(spec.blocks).sort());
    for (const b of list.blocks) assert.match(b.description, /^(element|widget|section)\b/, b.type);
    assert.deepEqual(list.aliases.map((a) => [a.type, a.aliasOf]), Object.entries(spec.aliases).map(([k, v]) => [k, v['x-alias-of']]).sort());
    const callout = (await call(client, 'blocks', { type: 'callout' })).structuredContent;
    assert.equal(callout.tier, 'widget');
    assert.deepEqual(callout.example, golden('callout'));
    assert.deepEqual(callout.fields.find((f) => f.name === 'content'), { name: 'content', type: 'inline[]', required: false });
    assert.deepEqual(callout.fields.map((f) => f.name), Object.keys(spec.blocks.callout.properties).filter((k) => k !== 'type'));
    const heading = (await call(client, 'blocks', { type: 'h2' })).structuredContent;
    assert.deepEqual([heading.aliasOf, heading.sets, heading.example], ['heading', { level: 2 }, golden('heading')]);
    assert.deepEqual(heading.fields.find((f) => f.name === 'level'), { name: 'level', type: 'any', required: false, description: 'Set by the spelling; a stored value is ignored.' });
    const level = (await call(client, 'blocks', { type: 'heading' })).structuredContent.fields.find((f) => f.name === 'level');
    assert.deepEqual(level, { name: 'level', type: 'integer | string', required: false, minimum: 1, maximum: 6, enum: ['1', '2', '3', '4', '5', '6'] });
  });

  test('an unknown block type and a bad format are InvalidParams', async () => {
    await invalid(call(client, 'blocks', { type: 'nope' }), /no block type "nope"/);
    for (const type of ['__proto__', 'constructor']) await invalid(call(client, 'blocks', { type }), /no block type/);
    await invalid(call(client, 'blocks', { type: 3 }), /type must be a string/);
    await invalid(call(client, 'render', { doc: DOC, format: 'pdf' }), /format must be one of html, markdown, text/);
    await invalid(call(client, 'render', { doc: DOC, format: null }), /format must be one of/);
    await invalid(call(client, 'blocks', { kind: 'x' }), /blocks takes no argument "kind"/);
  });
});

test('with BARKPARK_URL set, html goes to the reader and markdown and text stay local', async () => {
  const reader = await startFakeReader();
  const client = await connect({ BARKPARK_URL: reader.base, BARKPARK_TOKEN: FAKE_TOKEN });
  try {
    assert.deepEqual((await call(client, 'render', { doc: DOC, format: 'markdown' })).structuredContent, { markdown: toMarkdown(DOC) });
    assert.deepEqual((await call(client, 'render', { doc: DOC, format: 'text' })).structuredContent, { text: toPlainText(DOC) });
    assert.equal(reader.requests.length, 0);
    assert.deepEqual((await call(client, 'render', { doc: DOC, format: 'html' })).structuredContent, { html: readerHtml(DOC.blocks) });
    assert.equal(reader.requests.length, 1);
  } finally {
    await client.close();
    await reader.close();
  }
});

test('blocks names the missing file in plain words when the checkout has no spec or goldens', async () => {
  const { loadCatalog } = await import('./catalog.js');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-no-spec-'));
  const root = pathToFileURL(empty + path.sep);
  try {
    assert.match(loadCatalog(root).error, /^blocks needs spec\/blocks\.schema\.json from a portable-doc checkout, and it could not be read: ENOENT$/);
    fs.mkdirSync(path.join(empty, 'spec'));
    fs.copyFileSync(new URL('../../spec/blocks.schema.json', import.meta.url), path.join(empty, 'spec', 'blocks.schema.json'));
    assert.match(loadCatalog(root).error, /^blocks needs goldens\/blocks\/ from a portable-doc checkout/);
  } finally {
    fs.rmSync(empty, { recursive: true });
  }
});
