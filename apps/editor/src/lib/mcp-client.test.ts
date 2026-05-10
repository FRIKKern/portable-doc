/**
 * @vitest-environment jsdom
 *
 * Specs for the MCP client wrapper. Mocks the SDK so unit tests stay
 * hermetic — no real server is spawned.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable behavior toggles read by the mocked SDK on each test.
const sdkState = {
  shouldFailConnect: false,
  callToolImpl: null as
    | null
    | ((params: { name: string; arguments: unknown }) => Promise<unknown>),
  capturedUrl: null as string | null,
};

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  class Client {
    constructor(_info: unknown, _opts: unknown) {}
    async connect(_t: unknown): Promise<void> {
      if (sdkState.shouldFailConnect) throw new Error('connect failed');
    }
    async listTools(): Promise<unknown> {
      return { tools: [] };
    }
    async callTool(params: { name: string; arguments: unknown }): Promise<unknown> {
      if (sdkState.callToolImpl) return sdkState.callToolImpl(params);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ surface: 'tui', output: 'mock-tui-output' }),
          },
        ],
      };
    }
    async close(): Promise<void> {
      /* no-op */
    }
  }
  return { Client };
});

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => {
  class StreamableHTTPClientTransport {
    constructor(url: URL) {
      sdkState.capturedUrl = url.href;
    }
  }
  return { StreamableHTTPClientTransport };
});

import {
  DEFAULT_MCP_URL,
  __resetMcpForTests,
  isReachable,
  probeMcp,
  renderViaMcp,
} from './mcp-client.js';

beforeEach(() => {
  sdkState.shouldFailConnect = false;
  sdkState.callToolImpl = null;
  sdkState.capturedUrl = null;
  vi.unstubAllEnvs();
  __resetMcpForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('mcp-client', () => {
  it('probeMcp returns true on success and primes the cached client', async () => {
    expect(isReachable()).toBeNull();
    const ok = await probeMcp();
    expect(ok).toBe(true);
    expect(isReachable()).toBe(true);
    // listTools succeeded → renderViaMcp can be called without throwing.
    const out = await renderViaMcp(
      { version: 1, blocks: [] },
      'tui',
    );
    expect(out).toBe('mock-tui-output');
  });

  it('probeMcp returns false when the transport / connect throws', async () => {
    sdkState.shouldFailConnect = true;
    const ok = await probeMcp();
    expect(ok).toBe(false);
    expect(isReachable()).toBe(false);
    // No cached client → renderViaMcp throws so the consumer can fall back.
    await expect(renderViaMcp({ version: 1, blocks: [] }, 'tui')).rejects.toThrow(
      /not connected/,
    );
  });

  it('uses the default URL when VITE_PORTABLE_DOC_MCP_URL is unset', async () => {
    vi.stubEnv('VITE_PORTABLE_DOC_MCP_URL', '');
    await probeMcp();
    expect(sdkState.capturedUrl).toBe(DEFAULT_MCP_URL);
  });

  it('respects VITE_PORTABLE_DOC_MCP_URL override when set', async () => {
    vi.stubEnv('VITE_PORTABLE_DOC_MCP_URL', 'http://example.test:9999/mcp');
    await probeMcp();
    expect(sdkState.capturedUrl).toBe('http://example.test:9999/mcp');
  });

  it('renderViaMcp parses the server JSON envelope and returns `output`', async () => {
    sdkState.callToolImpl = async ({ name, arguments: args }) => {
      expect(name).toBe('doc_render');
      expect((args as { surface: string }).surface).toBe('email');
      // Server returns content[0].text = JSON.stringify({surface, output}).
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ surface: 'email', output: '<p>hi</p>' }),
          },
        ],
      };
    };
    await probeMcp();
    const out = await renderViaMcp({ version: 1, blocks: [] }, 'email');
    expect(out).toBe('<p>hi</p>');
  });

  it('renderViaMcp throws on a malformed result shape (non-text content)', async () => {
    sdkState.callToolImpl = async () => ({ content: [{ type: 'image' }] });
    await probeMcp();
    await expect(renderViaMcp({ version: 1, blocks: [] }, 'tui')).rejects.toThrow(
      /Unexpected MCP doc_render result shape/,
    );
  });
});
