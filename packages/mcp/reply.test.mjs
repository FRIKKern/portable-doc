import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { FAKE_TOKEN, startFakeReader } from './test/fake-reader.mjs';
import { READER_WAIT, REQUEST } from './test/hang.mjs';

const BIN = fileURLToPath(new URL('bin/portable-doc-mcp.mjs', import.meta.url));
const MiB = 1024 * 1024;
const SMALL = { blocks: [{ id: 'd', type: 'divider' }] };

async function connect(env) {
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN], env: { ...READER_WAIT, ...env }, stderr: 'pipe' }), REQUEST);
  return client;
}

const call = (client, name, args) => client.callTool({ name, arguments: args }, undefined, REQUEST);
const answer = (result) => JSON.parse(result.content[0].text);

async function stillWorks(client) {
  assert.deepEqual((await call(client, 'validate', { doc: SMALL })).structuredContent, { ok: true });
}

function refused(result, tool) {
  assert.equal(result.isError, true, result.content[0].text.slice(0, 200));
  assert.match(result.structuredContent.error, new RegExp(`^the ${tool} reply would be \\d+ bytes, over the \\d+ one reply may carry`));
}

describe('large answers over stdio with the SDK client', () => {
  let client;
  let reader;
  before(async () => {
    reader = await startFakeReader({ raw: JSON.stringify({ html: 'a'.repeat(6 * MiB) }) });
    client = await connect({ BARKPARK_URL: reader.base, BARKPARK_TOKEN: FAKE_TOKEN });
  });
  after(async () => {
    await client.close();
    await reader.close();
  });

  test('reader html of 6 MiB still answers, with the full JSON in content', async () => {
    const result = await call(client, 'render', { doc: SMALL });
    assert.equal(result.isError, undefined, result.content[0].text.slice(0, 200));
    assert.equal(answer(result).html.length, 6 * MiB);
    await stillWorks(client);
  });

  test('apply_ops on a 5 MiB doc still answers', async () => {
    const blocks = Array.from({ length: 1_000 }, (_, i) => ({ id: `p${i}`, type: 'paragraph', text: 'x'.repeat(5 * 1024) }));
    const result = await call(client, 'apply_ops', { doc: { blocks }, ops: [{ op: 'append-block', block: { id: 'end', type: 'divider' } }] });
    assert.equal(result.isError, undefined, result.content[0].text.slice(0, 200));
    const { ok, doc } = answer(result);
    assert.equal(ok, true);
    assert.deepEqual([doc.blocks.length, doc.blocks.at(-1).id, doc.blocks[0].text.length], [1_001, 'end', 5 * 1024]);
    await stillWorks(client);
  });

  test('a reply that does not fit even once is a tool error, local or from the reader, and the next call works', async () => {
    const local = await connect({});
    try {
      refused(await call(local, 'render', { doc: { blocks: Array.from({ length: 60_000 }, () => ({ type: 'divider' })) } }), 'render');
      await stillWorks(local);
      const long = { blocks: [{ type: 'paragraph', text: 'a'.repeat(11 * MiB) }] };
      for (const format of ['markdown', 'text']) {
        refused(await call(local, 'render', { doc: long, format }), 'render');
        await stillWorks(local);
      }
    } finally {
      await local.close();
    }
    const quotes = await startFakeReader({ raw: JSON.stringify({ html: '"'.repeat(3 * MiB) }) });
    const remote = await connect({ BARKPARK_URL: quotes.base, BARKPARK_TOKEN: FAKE_TOKEN });
    try {
      refused(await call(remote, 'render', { doc: SMALL }), 'render');
      await stillWorks(remote);
    } finally {
      await remote.close();
      await quotes.close();
    }
  });
});
