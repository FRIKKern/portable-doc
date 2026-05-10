// @vitest-environment node
/**
 * HTTP transport tests — spawns an in-process mcp-server bound to an
 * ephemeral 127.0.0.1 port and exercises it through the SDK's official
 * `StreamableHTTPClientTransport`.
 *
 * Covers:
 *   - tools/list returns the four spec-mandated tools.
 *   - doc_validate roundtrips a clean fixture and yields valid:true.
 *   - CORS check: origin outside the allowlist is rejected with 403.
 *   - CLI parser: `--http --port N --cors-origin x --cors-origin y`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { PortableDoc } from '@portable-doc/core';
import { type HttpHandle, isOriginAllowed, startHttp } from './http.js';
import { parseCli } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const welcome = JSON.parse(
  readFileSync(resolve(repoRoot, 'examples', 'welcome.json'), 'utf8'),
) as PortableDoc;

let handle: HttpHandle | undefined;

afterEach(async () => {
  if (handle) {
    await handle.close();
    handle = undefined;
  }
});

async function spawnServer(allowedOrigins: readonly string[] = ['localhost:5173']): Promise<HttpHandle> {
  const h = await startHttp({ port: 0, allowedOrigins });
  handle = h;
  return h;
}

describe('mcp-server HTTP mode', () => {
  it('binds 127.0.0.1 and resolves an ephemeral port', async () => {
    const h = await spawnServer();
    expect(h.port).toBeGreaterThan(0);
  });

  it('lists the four spec-mandated tools over the SDK client', async () => {
    const h = await spawnServer();
    const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${h.port}/mcp`));
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name).sort();
      expect(names).toEqual(['doc_explain_block', 'doc_render', 'doc_suggest_fixes', 'doc_validate']);
    } finally {
      await client.close();
    }
  });

  it('roundtrips doc_validate against the welcome fixture', async () => {
    const h = await spawnServer();
    const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${h.port}/mcp`));
    await client.connect(transport);
    try {
      const result = await client.callTool({
        name: 'doc_validate',
        arguments: { document: welcome },
      });
      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0]?.type).toBe('text');
      const parsed = JSON.parse(content[0]!.text) as { valid: boolean; issues: unknown[] };
      expect(parsed.valid).toBe(true);
      expect(parsed.issues).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it('rejects requests from an off-allowlist origin with 403', async () => {
    const h = await spawnServer(['localhost:5173']);
    const res = await fetch(`http://127.0.0.1:${h.port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://evil.example:9999',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });
    expect(res.status).toBe(403);
  });

  it('handles CORS preflight for an allowed origin', async () => {
    const h = await spawnServer(['localhost:5173']);
    const res = await fetch(`http://127.0.0.1:${h.port}/mcp`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });
});

describe('isOriginAllowed', () => {
  it('allows missing Origin (curl/non-browser clients)', () => {
    expect(isOriginAllowed(undefined, ['localhost:5173'])).toBe(true);
  });

  it('matches http and https schemes for an allowlisted host:port', () => {
    expect(isOriginAllowed('http://localhost:5173', ['localhost:5173'])).toBe(true);
    expect(isOriginAllowed('https://localhost:5173', ['localhost:5173'])).toBe(true);
  });

  it('rejects host:port not on the allowlist', () => {
    expect(isOriginAllowed('http://evil.example:9999', ['localhost:5173'])).toBe(false);
  });
});

describe('parseCli', () => {
  it('defaults to stdio with port 6123 + default origins when no flags', () => {
    const cli = parseCli([]);
    expect(cli.http).toBe(false);
    expect(cli.port).toBe(6123);
    expect(cli.corsOrigins).toEqual(['localhost:5173', 'localhost:6123']);
  });

  it('parses --http --port 9999', () => {
    const cli = parseCli(['--http', '--port', '9999']);
    expect(cli.http).toBe(true);
    expect(cli.port).toBe(9999);
  });

  it('collects repeatable --cors-origin values', () => {
    const cli = parseCli([
      '--http',
      '--cors-origin',
      'localhost:5173',
      '--cors-origin',
      'localhost:6123',
    ]);
    expect(cli.corsOrigins).toEqual(['localhost:5173', 'localhost:6123']);
  });

  it('throws on invalid --port', () => {
    expect(() => parseCli(['--http', '--port', 'banana'])).toThrow(/Invalid --port/);
  });
});
