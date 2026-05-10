/**
 * Entry point — wires the MCP server to either stdio (default) or HTTP
 * (when `--http` is passed). The CLI shape is locked by the May 10 spec.
 *
 *   mcp-server start                              → stdio
 *   mcp-server start --http --port 6123           → HTTP on 127.0.0.1:6123
 *   mcp-server start --http --port 6123 \
 *     --cors-origin localhost:5173 \
 *     --cors-origin localhost:6123                → with explicit allowlist
 */
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { DEFAULT_CORS_ORIGINS, DEFAULT_PORT, startHttp } from './http.js';

interface ParsedCli {
  http: boolean;
  port: number;
  corsOrigins: string[];
}

/** Parse CLI args. Exported so tests can exercise the parser directly. */
export function parseCli(argv: readonly string[]): ParsedCli {
  const { values } = parseArgs({
    args: argv as string[],
    options: {
      http: { type: 'boolean', default: false },
      port: { type: 'string' },
      'cors-origin': { type: 'string', multiple: true },
    },
    strict: true,
    allowPositionals: true,
  });

  const portRaw = values.port;
  const port = portRaw === undefined ? DEFAULT_PORT : Number.parseInt(portRaw, 10);
  if (Number.isNaN(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid --port value: ${String(portRaw)}`);
  }

  const corsOriginRaw = values['cors-origin'];
  const corsOrigins =
    corsOriginRaw && corsOriginRaw.length > 0 ? corsOriginRaw : [...DEFAULT_CORS_ORIGINS];

  return { http: Boolean(values.http), port, corsOrigins };
}

async function startStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  if (cli.http) {
    const handle = await startHttp({ port: cli.port, allowedOrigins: cli.corsOrigins });
    // Log to stderr — stdout still belongs to stdio mode by convention.
    // eslint-disable-next-line no-console
    console.error(
      `MCP HTTP listening on http://127.0.0.1:${handle.port}/mcp (origins: ${cli.corsOrigins.join(', ')})`,
    );
  } else {
    await startStdio();
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
