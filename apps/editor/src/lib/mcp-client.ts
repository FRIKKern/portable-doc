/**
 * Thin wrapper around `@modelcontextprotocol/sdk` for the editor.
 *
 * Discovers the server URL via `VITE_PORTABLE_DOC_MCP_URL` (default
 * http://127.0.0.1:6123/mcp), probes it on startup with a no-op call
 * (`listTools`), and exposes `renderViaMcp(doc, surface)` that round-trips
 * `doc_render` through StreamableHTTPClientTransport.
 *
 * Per grill q8: probe failure is graceful — callers fall back to direct
 * backend imports and surface a banner. Mid-session render failure throws
 * upward; the consumer logs and falls back silently for that single call.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { PortableDoc } from '@portable-doc/core';

export const DEFAULT_MCP_URL = 'http://127.0.0.1:6123/mcp';

/** Editor-side surface keys; `json` is editor-only (no MCP equivalent). */
export type McpSurface = 'web' | 'email' | 'tui' | 'native';

interface McpServerOutput {
  surface: string;
  output: string;
}

/** Read the configured URL at call time so tests can stub env vars. */
function resolveUrl(): string {
  const viteEnv = (import.meta as ImportMeta).env as
    | Record<string, string | undefined>
    | undefined;
  const fromVite = viteEnv?.['VITE_PORTABLE_DOC_MCP_URL'];
  if (fromVite) return fromVite;
  // Test fallback: Node-side `process.env` is reachable under Vitest even when
  // `import.meta.env` snapshot does not pick up `vi.stubEnv` updates.
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process;
  const fromProc = proc?.env?.['VITE_PORTABLE_DOC_MCP_URL'];
  if (fromProc) return fromProc;
  return DEFAULT_MCP_URL;
}

let cachedClient: Client | null = null;
let cachedReachable: boolean | null = null;

async function connect(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(resolveUrl()));
  const client = new Client(
    { name: 'portable-doc-editor', version: '0.3' },
    { capabilities: {} },
  );
  await client.connect(transport);
  return client;
}

/**
 * Probe the MCP server. Returns true if reachable, false otherwise.
 * On success, caches the live client for subsequent `renderViaMcp` calls.
 */
export async function probeMcp(): Promise<boolean> {
  try {
    if (cachedClient) {
      try {
        await cachedClient.close();
      } catch {
        /* ignore close errors */
      }
    }
    const client = await connect();
    // listTools is a cheap no-op for liveness — the server registers it.
    await client.listTools();
    cachedClient = client;
    cachedReachable = true;
    return true;
  } catch {
    cachedClient = null;
    cachedReachable = false;
    return false;
  }
}

export function isReachable(): boolean | null {
  return cachedReachable;
}

/**
 * Call the server's `doc_render` tool. Returns the rendered output string.
 * Throws on transport / protocol error (caller falls back per surface).
 */
export async function renderViaMcp(doc: PortableDoc, surface: McpSurface): Promise<string> {
  if (!cachedClient) throw new Error('MCP client not connected');
  const result = await cachedClient.callTool({
    name: 'doc_render',
    arguments: { document: doc, surface },
  });
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  const first = content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') {
    throw new Error('Unexpected MCP doc_render result shape');
  }
  // Server JSON-stringifies { surface, output }; parse and return output.
  try {
    const parsed = JSON.parse(first.text) as McpServerOutput;
    if (typeof parsed.output === 'string') return parsed.output;
  } catch {
    // Not JSON — pass the raw text through (defensive).
    return first.text;
  }
  throw new Error('MCP doc_render result missing `output` string');
}

/** Test-only: clear cached client + reachability state between specs. */
export function __resetMcpForTests(): void {
  cachedClient = null;
  cachedReachable = null;
}
