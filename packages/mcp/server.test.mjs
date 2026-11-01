import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { MAX_DEPTH, MAX_NODES } from './limits.js';
import { MAX_HTML_BYTES, render } from './render.js';
import { MAX_MESSAGE_BYTES } from './stdio.js';
import { MAX_OPS } from './tools.js';
import { FAKE_TOKEN, readerHtml, startFakeReader } from './test/fake-reader.mjs';

const BIN = fileURLToPath(new URL('bin/portable-doc-mcp.mjs', import.meta.url));
const TIMEOUT = { timeout: 20_000 };

const golden = (name) => JSON.parse(fs.readFileSync(new URL(`../../goldens/blocks/${name}.golden.json`, import.meta.url), 'utf8')).input;
const SAMPLE = { title: 'Sample', blocks: [{ id: 'h', ...golden('heading') }, { id: 'c', ...golden('callout') }] };
const ARGS = { validate: { doc: SAMPLE }, explain: { errors: [] }, apply_ops: { doc: SAMPLE, ops: [] }, render: { doc: SAMPLE } };

function deepDoc(levels) {
  let block = { type: 'divider' };
  for (let i = 0; i < levels; i++) block = { type: 'section', blocks: [block] };
  return { blocks: [block] };
}

async function connect(env = {}) {
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN], env, stderr: 'pipe' }));
  return client;
}

const call = (client, name, args) => client.callTool({ name, arguments: args }, undefined, TIMEOUT);

async function protocolError(promise, pattern) {
  await assert.rejects(promise, (e) => {
    assert.equal(e.code, ErrorCode.InvalidParams, e.message);
    assert.match(e.message, pattern);
    return true;
  });
}

function toolError(result, pattern) {
  assert.equal(result.isError, true, JSON.stringify(result));
  assert.match(result.content[0].text, pattern);
  return result.structuredContent;
}

describe('over stdio with the SDK client', () => {
  let client;
  let reader;
  before(async () => {
    reader = await startFakeReader();
    client = await connect({ BARKPARK_URL: reader.base, BARKPARK_TOKEN: FAKE_TOKEN });
  });
  after(async () => {
    await client.close();
    await reader.close();
  });

  test('lists four tools, each with an input schema', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ['validate', 'explain', 'apply_ops', 'render']);
    for (const t of tools) assert.equal(t.inputSchema.type, 'object');
  });

  test('validate, explain, apply_ops and render work on a sample doc', async () => {
    assert.deepEqual((await call(client, 'validate', { doc: SAMPLE })).structuredContent, { ok: true });
    const broken = { blocks: [{ type: 'heading', level: 0, text: 'x' }] };
    const checked = (await call(client, 'validate', { doc: broken })).structuredContent;
    assert.equal(checked.errors[0].code, 'value_not_allowed');
    const words = (await call(client, 'explain', { errors: checked.errors, doc: broken })).structuredContent.explanations;
    assert.match(words[0].text, /^block 1 \(heading\) › field "level": 0 is below 1\. Refused when /);
    const applied = (await call(client, 'apply_ops', { doc: SAMPLE, ops: [{ op: 'move-block', id: 'c', after: null }] })).structuredContent;
    assert.deepEqual(applied.doc.blocks.map((b) => b.id), ['c', 'h']);
    const rendered = (await call(client, 'render', { doc: applied.doc })).structuredContent;
    assert.equal(rendered.html, readerHtml(applied.doc.blocks));
    assert.deepEqual(JSON.parse(reader.requests.at(-1).body), { blocks: applied.doc.blocks });
    assert.equal(reader.requests.at(-1).auth, `Bearer ${FAKE_TOKEN}`);
  });

  test('every op golden applies through the server', async () => {
    const dir = new URL('../../goldens/ops/', import.meta.url);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 9);
    for (const f of files) {
      const g = JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
      assert.deepEqual((await call(client, 'apply_ops', { doc: g.before, ops: [g.op] })).structuredContent, { ok: true, doc: g.after }, f);
    }
  });

  test('missing, unknown and wrongly typed arguments are InvalidParams for every tool', async () => {
    for (const [name, args] of Object.entries(ARGS)) {
      await protocolError(call(client, name, {}), new RegExp(`${name} needs (doc|errors)`));
      await protocolError(call(client, name, { ...args, extra: 1 }), /takes no argument "extra"/);
    }
    for (const doc of ['x', 5, null, true]) {
      for (const name of ['validate', 'apply_ops', 'render']) await protocolError(call(client, name, { ...ARGS[name], doc }), /doc must be an object with a blocks array/);
    }
    for (const doc of [{}, { title: 'T' }, { blocks: 'x' }, { blocks: null }]) {
      for (const name of ['apply_ops', 'render']) await protocolError(call(client, name, { ...ARGS[name], doc }), /doc must be an object with a blocks array/);
      assert.equal((await call(client, 'validate', { doc })).isError, undefined);
    }
    await protocolError(call(client, 'apply_ops', { doc: SAMPLE, ops: 'x' }), /ops must be an array/);
    await protocolError(call(client, 'apply_ops', { doc: SAMPLE, ops: Array(MAX_OPS + 1).fill({ op: 'remove-block', id: 'x' }) }), new RegExp(`more than ${MAX_OPS} ops`));
    await protocolError(call(client, 'explain', { errors: 'x' }), /errors must be an array/);
    await protocolError(call(client, 'explain', { errors: [7] }), /errors\[0\] must be an object/);
    await protocolError(call(client, 'explain', { errors: [{ code: 'nope', path: '' }] }), /errors\[0\]\.code must be one of not_a_doc/);
    await protocolError(call(client, 'explain', { errors: [{ code: 'too_deep', path: 5 }] }), /errors\[0\]\.path must be a JSON pointer/);
    await protocolError(call(client, 'explain', { errors: [{ code: 'too_deep', path: 'blocks' }] }), /errors\[0\]\.path must be a JSON pointer/);
    await protocolError(call(client, 'explain', { errors: [{ code: 'too_deep', path: 'blocks/0' }] }), /errors\[0\]\.path must be a JSON pointer/);
    await protocolError(call(client, 'explain', { errors: [{ code: 'too_deep', path: 'x' }] }), /errors\[0\]\.path must be a JSON pointer/);
    await protocolError(call(client, 'explain', { errors: [{ code: 'too_deep', path: '', message: 3 }] }), /errors\[0\]\.message must be a string/);
    await protocolError(call(client, 'explain', { errors: [{ code: 'too_deep', path: `/${'a'.repeat(10_000)}` }] }), /errors\[0\]\.path must be a JSON pointer/);
    assert.equal((await call(client, 'explain', { errors: [{ code: 'too_deep', path: `/${'a'.repeat(9_999)}` }] })).isError, undefined);
    await protocolError(call(client, 'explain', { errors: Array(1001).fill({ code: 'too_deep', path: '' }) }), /more than 1000 entries/);
    assert.equal((await call(client, 'explain', { errors: Array(1000).fill({ code: 'too_deep', path: '' }) })).structuredContent.explanations.length, 1000);
    await protocolError(call(client, 'explain', { errors: [], doc: 'x' }), /doc must be an object/);
    await protocolError(call(client, 'nope', {}), /no tool "nope"; tools: validate, explain, apply_ops, render/);
    await assert.rejects(client.request({ method: 'tools/call', params: { name: 'validate', arguments: [] } }, CallToolResultSchema, TIMEOUT), (e) => {
      assert.equal(e.code, ErrorCode.InternalError);
      assert.match(e.message, /"expected": "record"/);
      return true;
    });
  });

  test(`a doc past ${MAX_NODES} JSON values is InvalidParams, quickly`, async () => {
    const blocks = Array.from({ length: 70_000 }, (_, i) => ({ id: `p${i}`, type: 'divider' }));
    for (const name of ['validate', 'apply_ops', 'render']) {
      const started = Date.now();
      await protocolError(call(client, name, { ...ARGS[name], doc: { blocks } }), new RegExp(`more than ${MAX_NODES} JSON values`));
      assert.ok(Date.now() - started < 5000, `${name} took ${Date.now() - started} ms`);
    }
  });

  test('the largest doc allowed answers in time: validate, a full batch of ops, render', async () => {
    const blocks = Array.from({ length: 49_000 }, (_, i) => ({ id: `p${i}`, type: 'divider' }));
    const ops = Array.from({ length: MAX_OPS }, (_, i) => ({ op: 'patch-block', id: `p${48_999 - i}`, patch: { tone: 'x' } }));
    let started = Date.now();
    assert.deepEqual((await call(client, 'validate', { doc: { blocks } })).structuredContent, { ok: true });
    assert.ok(Date.now() - started < 10_000, `validate took ${Date.now() - started} ms`);
    started = Date.now();
    const applied = (await call(client, 'apply_ops', { doc: { blocks }, ops })).structuredContent;
    assert.equal(applied.doc.blocks.at(-1).tone, 'x');
    assert.ok(Date.now() - started < 15_000, `apply_ops took ${Date.now() - started} ms`);
    toolError(await call(client, 'render', { doc: { blocks: [{ type: 'divider', tone: 'x' }] } }), /answered 422/);
  });

  test('a 2500-section doc (5000 JSON levels, the most the SDK client can send): validate answers too_deep, apply_ops and render refuse it, explain names its path', async () => {
    const doc = deepDoc(2500);
    const checked = (await call(client, 'validate', { doc })).structuredContent;
    assert.deepEqual(checked.errors.map((e) => e.code), ['too_deep']);
    const words = (await call(client, 'explain', { errors: checked.errors, doc })).structuredContent.explanations;
    assert.match(words[0].text, /^block 1 \(section\) › field "blocks" › block 1 \(section\)/);
    await protocolError(call(client, 'apply_ops', { doc, ops: [] }), new RegExp(`nest deeper than ${MAX_DEPTH} JSON levels`));
    await protocolError(call(client, 'render', { doc }), new RegExp(`nest deeper than ${MAX_DEPTH} JSON levels`));
    await protocolError(call(client, 'apply_ops', { doc: SAMPLE, ops: [{ op: 'append-block', block: deepDoc(600).blocks[0] }] }), /nest deeper/);
  });

  test('a refused op is a tool error that names the op index and the refusal', async () => {
    const r = toolError(await call(client, 'apply_ops', { doc: SAMPLE, ops: [{ op: 'remove-block', id: 'h' }, { op: 'patch-block', id: 'h', patch: {} }] }), /block_not_found/);
    assert.deepEqual(r, { ok: false, index: 1, error: { code: 'block_not_found', target: 'h', op: 'patch-block' } });
    for (const op of [null, 7, 'x', [], {}, { op: 'nope' }]) {
      assert.equal(toolError(await call(client, 'apply_ops', { doc: SAMPLE, ops: [op] }), /invalid_op/).error.code, 'invalid_op');
    }
  });

  test('twenty calls in flight at once all get their own answer', async () => {
    const calls = Array.from({ length: 20 }, (_, i) => call(client, 'apply_ops', { doc: SAMPLE, ops: [{ op: 'append-block', block: { id: `n${i}`, type: 'divider' } }] }));
    const answers = await Promise.all(calls);
    answers.forEach((a, i) => assert.equal(a.structuredContent.doc.blocks.at(-1).id, `n${i}`));
  });

  test('the server still answers after every bad call', async () => {
    assert.equal((await client.listTools()).tools.length, 4);
  });
});

describe('render failures are tool errors, never a hang', () => {
  const renderWith = async (env, doc = SAMPLE) => {
    const client = await connect({ BARKPARK_TOKEN: FAKE_TOKEN, ...env });
    try {
      return await call(client, 'render', { doc });
    } finally {
      await client.close();
    }
  };

  test('no BARKPARK_URL, a bad URL, a non-http URL', async () => {
    toolError(await renderWith({}), /render needs BARKPARK_URL/);
    toolError(await renderWith({ BARKPARK_URL: 'not a url' }), /is not a URL/);
    toolError(await renderWith({ BARKPARK_URL: 'file:///etc' }), /must be http or https/);
  });

  test('no BARKPARK_TOKEN sends nothing; a wrong one gets the reader\'s 401', async () => {
    const reader = await startFakeReader();
    try {
      toolError(await renderWith({ BARKPARK_URL: reader.base, BARKPARK_TOKEN: '' }), /render needs BARKPARK_TOKEN/);
      assert.equal(reader.requests.length, 0);
      toolError(await renderWith({ BARKPARK_URL: reader.base, BARKPARK_TOKEN: 'wrong' }), /answered 401: .*invalid ingest token/);
      assert.equal(reader.requests[0].auth, 'Bearer wrong');
    } finally {
      await reader.close();
    }
  });

  test('a reader that errors, answers no html, answers junk, redirects, is too big, is gone, or is slow', async () => {
    for (const [options, pattern] of [
      [{ status: 500 }, /answered 500: .*fake reader answers 500/],
      [{ raw: '{"nohtml":1}' }, /answered 200 without an html string/],
      [{ raw: 'not json' }, /answered 200 without an html string/],
      [{ status: 302, raw: '' }, /failed/],
      [{ status: 204, raw: '' }, /answered 204 without an html string/],
      [{ raw: JSON.stringify({ html: 'x'.repeat(MAX_HTML_BYTES) }) }, new RegExp(`more than ${MAX_HTML_BYTES} bytes`)],
    ]) {
      const reader = await startFakeReader(options);
      try {
        toolError(await renderWith({ BARKPARK_URL: reader.base }), pattern);
      } finally {
        await reader.close();
      }
    }
    const full = await startFakeReader({ raw: JSON.stringify({ html: 'x'.repeat(MAX_HTML_BYTES - 11) }) });
    try {
      assert.equal((await render({ blocks: [] }, { base: full.base, token: FAKE_TOKEN, timeoutMs: 10_000 })).html.length, MAX_HTML_BYTES - 11);
      await render([{ id: 'b', type: 'divider' }], { base: full.base, token: FAKE_TOKEN, timeoutMs: 10_000 });
      assert.deepEqual(JSON.parse(full.requests.at(-1).body), { blocks: [{ id: 'b', type: 'divider' }] });
    } finally {
      await full.close();
    }
    const gone = await startFakeReader();
    await gone.close();
    toolError(await renderWith({ BARKPARK_URL: gone.base }), /failed: connect ECONNREFUSED/);
    const slow = await startFakeReader({ delayMs: 3000 });
    try {
      const started = Date.now();
      toolError(await renderWith({ BARKPARK_URL: slow.base, BARKPARK_TIMEOUT_MS: '300' }), /no answer within 300 ms/);
      assert.ok(Date.now() - started < 2500, `took ${Date.now() - started} ms`);
    } finally {
      await slow.close();
    }
  });

  test('BARKPARK_URL keeps its path prefix', async () => {
    const reader = await startFakeReader();
    try {
      toolError(await renderWith({ BARKPARK_URL: `${reader.base}/w/ws/p/pj/` }), /answered 404/);
      assert.equal(reader.requests[0].url, '/w/ws/p/pj/v1/plugins/bulldocs/render');
    } finally {
      await reader.close();
    }
  });
});

describe('raw stdio: lines that are not MCP still get an answer', () => {
  let child;
  let lines;
  let waiters;
  before(() => {
    child = spawn(process.execPath, [BIN], { stdio: ['pipe', 'pipe', 'pipe'] });
    lines = [];
    waiters = [];
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) !== -1) {
        lines.push(JSON.parse(buffer.slice(0, at)));
        buffer = buffer.slice(at + 1);
        waiters.shift()?.();
      }
    });
  });
  after(() => child.kill());

  const reply = async (text) => {
    const count = lines.length;
    const answered = new Promise((resolve) => waiters.push(resolve));
    child.stdin.write(text);
    let timer;
    await Promise.race([answered, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('no answer within 10 s')), 10_000)))]).finally(() => clearTimeout(timer));
    assert.equal(lines.length, count + 1);
    return lines.at(-1);
  };

  test('not JSON is ParseError, not JSON-RPC is InvalidRequest, an unknown method is MethodNotFound', async () => {
    assert.deepEqual(await reply('not json\n'), { jsonrpc: '2.0', id: null, error: { code: ErrorCode.ParseError, message: 'message is not JSON' } });
    assert.equal((await reply('{"id":3,"foo":1}\n')).error.code, ErrorCode.InvalidRequest);
    assert.equal((await reply('{"id":3,"foo":1}\n')).id, 3);
    assert.equal((await reply('{"id":"s","foo":1}\n')).id, 's');
    assert.equal((await reply('{"jsonrpc":"2.0","id":4,"method":"nope"}\n')).error.code, ErrorCode.MethodNotFound);
    const bare = await reply('{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"validate"}}\n');
    assert.deepEqual([bare.error.code, bare.error.message.includes('validate needs doc')], [ErrorCode.InvalidParams, true]);
  });

  test('a depth-5000 doc (10000 JSON levels, past what JSON.stringify can write): validate answers too_deep, explain names it, apply_ops and render refuse it', async () => {
    const deep = `{"blocks":[${'{"type":"section","blocks":['.repeat(5000)}{"type":"divider"}${']}'.repeat(5000)}]}`;
    const callLine = (id, name, args) => `{"jsonrpc":"2.0","id":${id},"method":"tools/call","params":{"name":"${name}","arguments":${args}}}\n`;
    const checked = (await reply(callLine(20, 'validate', `{"doc":${deep}}`))).result.structuredContent;
    assert.deepEqual(checked.errors.map((e) => e.code), ['too_deep']);
    const words = (await reply(callLine(21, 'explain', `{"errors":${JSON.stringify(checked.errors)},"doc":${deep}}`))).result.structuredContent;
    assert.match(words.explanations[0].where, /› block 1 \(section\)$/);
    for (const [id, name] of [[22, 'apply_ops'], [23, 'render']]) {
      const refused = await reply(callLine(id, name, `{"doc":${deep}${name === 'apply_ops' ? ',"ops":[]' : ''}}`));
      assert.equal(refused.id, id);
      assert.equal(refused.error.code, ErrorCode.InvalidParams);
      assert.match(refused.error.message, new RegExp(`nest deeper than ${MAX_DEPTH} JSON levels`));
    }
  });

  test(`a message past ${MAX_MESSAGE_BYTES} bytes is InvalidRequest under its own id, wherever the id sits, and the next call works`, async () => {
    const pad = 'x'.repeat(MAX_MESSAGE_BYTES);
    const tail = await reply(`{"method":"tools/call","params":{"name":"validate","arguments":{"doc":{"blocks":[],"pad":"${pad}${'y'.repeat(1 << 20)}"}}},"jsonrpc":"2.0","id":9}\n`);
    assert.equal(tail.id, 9);
    assert.equal(tail.error.code, ErrorCode.InvalidRequest);
    assert.match(tail.error.message, new RegExp(`the limit is ${MAX_MESSAGE_BYTES}`));
    const head = await reply(`{"jsonrpc":"2.0","id":"ten","method":"tools/call","params":{"pad":"${pad}"}}\n`);
    assert.equal(head.id, 'ten');
    assert.equal((await reply(`{"jsonrpc":"2.0","id":0,"method":"tools/call","params":{"pad":"${pad}"}}\n`)).id, 0);
    assert.equal((await reply(`{"jsonrpc":"2.0","id":"\\x","method":"tools/call","params":{"pad":"${pad}"}}\n`)).id, null);
    const sized = (extra) => {
      const line = (pad) => `{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"explain","arguments":{"errors":[],"pad":"${pad}"}}}`;
      return `${line('x'.repeat(MAX_MESSAGE_BYTES - line('').length + extra))}\n`;
    };
    assert.match((await reply(sized(0))).error.message, /takes no argument "pad"/);
    assert.match((await reply(sized(1))).error.message, new RegExp(`the limit is ${MAX_MESSAGE_BYTES}`));
    const ok = await reply('{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"validate","arguments":{"doc":{"blocks":[]}}}}\n');
    assert.deepEqual(ok.result.structuredContent, { ok: true });
  });
});
