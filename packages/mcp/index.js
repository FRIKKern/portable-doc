import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, callTool } from './tools.js';

export { TOOLS } from './tools.js';
export { applyOp, applyOps } from './ops/apply.js';

export const RENDER_TIMEOUT_MS = 10_000;

export function configFromEnv(env = process.env) {
  const timeout = Number(env.BARKPARK_TIMEOUT_MS);
  return { base: env.BARKPARK_URL ?? '', timeoutMs: Number.isInteger(timeout) && timeout > 0 && timeout <= 60_000 ? timeout : RENDER_TIMEOUT_MS };
}

export function createServer(config = configFromEnv()) {
  const server = new Server({ name: 'portable-doc', version: '0.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, (request) => callTool(config, request.params.name, request.params.arguments));
  return server;
}
