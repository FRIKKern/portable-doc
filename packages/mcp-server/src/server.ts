/**
 * MCP server wiring — registers resource + tool handlers on a `Server`.
 *
 * The handlers are thin shells over the pure functions in `tools.ts` /
 * `resources.ts`, so unit tests target those directly instead of going
 * through the stdio transport.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { RESOURCE_LIST, readResource } from './resources.js';
import { TOOL_DESCRIPTORS, dispatchTool } from './tools.js';

export function createServer(): Server {
  const server = new Server(
    {
      name: '@portable-doc/mcp-server',
      version: '0.0.0',
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: RESOURCE_LIST,
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    return readResource(uri);
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DESCRIPTORS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await dispatchTool(name, args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: message,
          },
        ],
      };
    }
  });

  return server;
}
