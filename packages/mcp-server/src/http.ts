/**
 * HTTP transport wiring for `@portable-doc/mcp-server`.
 *
 * Implements the editor-to-localhost path locked in the May 10 grill:
 *
 *   - Bind 127.0.0.1 only (never 0.0.0.0).
 *   - CORS allowlist on the Origin header. Defaults to localhost:5173 +
 *     localhost:6123; overridable via repeatable `--cors-origin` flag.
 *   - No rotating loopback token — same local-only assumption stdio has.
 *   - Single endpoint at `/mcp` accepting POST + GET + OPTIONS + DELETE,
 *     dispatched to the SDK's `StreamableHTTPServerTransport`.
 *
 * The factory returns `{ port, close }` so tests can spawn an in-process
 * server on an ephemeral port and tear it down per test.
 */
import { createServer as createHttpServer, type IncomingMessage, type Server as NodeHttpServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer as createMcpServer } from './server.js';

export const DEFAULT_PORT = 6123;
export const DEFAULT_CORS_ORIGINS = ['localhost:5173', 'localhost:6123'] as const;

export interface StartHttpOptions {
  /** Port to listen on. Use 0 for an ephemeral port (tests). */
  port: number;
  /** Allowed Origin host:port tuples (exact-match). */
  allowedOrigins: readonly string[];
}

export interface HttpHandle {
  /** Resolved port (useful when port:0 was passed). */
  readonly port: number;
  /** Tear down the HTTP server + MCP transport. */
  close(): Promise<void>;
}

/**
 * Decide whether an Origin header is allowed against the host:port allowlist.
 * Accepts both `http://` and `https://` schemes; matches strictly on host:port.
 */
export function isOriginAllowed(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (!origin) return true; // No Origin header (curl/agents) — allowed per spec.
  for (const entry of allowedOrigins) {
    if (origin === `http://${entry}` || origin === `https://${entry}`) return true;
  }
  return false;
}

/**
 * Start the MCP server bound to 127.0.0.1 with HTTP transport.
 * Returns a handle exposing the resolved port + a teardown function.
 */
export async function startHttp(opts: StartHttpOptions): Promise<HttpHandle> {
  const mcpServer = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  });
  await mcpServer.connect(transport);

  const httpServer: NodeHttpServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const allowed = isOriginAllowed(origin, opts.allowedOrigins);

    if (origin && !allowed) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('CORS: origin not allowed');
      return;
    }

    if (origin && allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, DELETE');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
      );
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    transport.handleRequest(req, res).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('mcp-http transport error', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('mcp-http transport error');
      }
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    httpServer.once('error', rejectListen);
    httpServer.listen(opts.port, '127.0.0.1', () => {
      httpServer.off('error', rejectListen);
      resolveListen();
    });
  });

  const address = httpServer.address() as AddressInfo;
  const resolvedPort = address.port;

  return {
    port: resolvedPort,
    close: async () => {
      await transport.close();
      await mcpServer.close();
      await new Promise<void>((r) => httpServer.close(() => r()));
    },
  };
}
