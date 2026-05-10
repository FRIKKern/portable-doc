# editor

Vite + React app with five preview tabs (TUI, Email, Web, Native, JSON) over one PortableDoc tree.

## Local dev

```bash
pnpm --filter editor dev               # editor only on :5173
pnpm dev:full                          # editor + MCP HTTP server (workspace root)
```

`pnpm dev:full` (in the workspace root) is the usual mode — it boots this Vite dev server alongside `@portable-doc/mcp-server --http --port 6123` via `concurrently`. Ctrl-C tears both down.

## MCP routing

The editor probes a local MCP HTTP server on mount and routes `doc_render` calls through it. Default URL: `http://127.0.0.1:6123/mcp`. Override with `VITE_PORTABLE_DOC_MCP_URL`:

```bash
VITE_PORTABLE_DOC_MCP_URL=http://localhost:7000/mcp pnpm --filter editor dev
```

If the probe fails, preview surfaces fall back to direct backend imports and a banner appears at the top with a Retry button. Start the MCP server, click Retry, and the editor switches back to MCP routing without a reload.

Implementation: `src/McpProvider.tsx`, `src/lib/mcp-client.ts`.
