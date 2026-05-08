/**
 * Entry point — wires the MCP server to a stdio transport and runs forever.
 *
 * `pnpm --filter @portable-doc/mcp-server start` runs this file via tsx;
 * the bundled `bin/portable-doc-mcp.mjs` shim does the same for installed
 * environments.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
