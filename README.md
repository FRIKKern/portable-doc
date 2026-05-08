# portable-doc-mvp

One document, many surfaces — a portable-document MVP that authors a single tree and renders it to terminal (Ink), email, web (server + editor), native (RN), and over MCP.

Architecture spec: <http://localhost:8765/paperflow/specs/2026-05-08-portable-doc-architecture-spec.html>

## Quick start

```bash
pnpm install
pnpm test
pnpm typecheck
```

## Monorepo layout

```
packages/
  core/                 portable-doc tree + invariants
  primitives/           shared primitive set
  pd-to-rn-shim/        bridge to React Native
  backend-ink/          terminal renderer
  backend-email/        email renderer
  backend-web-server/   SSR web backend
  backend-web-editor/   browser editor backend
  backend-native/       RN / RN-Web backend
  mcp-server/           MCP exposure
apps/
  editor/               authoring app
fixtures/               sample documents
```
