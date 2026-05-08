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

## Testing

Three layers, per the architecture spec §10:

| Layer                                                         | Frequency               | Command                                       |
| ------------------------------------------------------------- | ----------------------- | --------------------------------------------- |
| Structural snapshots (kernel primitive-tree + Ink + Email + RE HTML) | every commit (CI)       | `pnpm test`                                   |
| Per-adapter unit specs (escaping, allowlist, determinism, …)  | every commit (CI)       | `pnpm test`                                   |
| Visual goldens (Ink TUI, Email HTML, Web HTML)                | on demand               | `pnpm visual-goldens` then eyeball `goldens/` |

CI also runs `pnpm typecheck` (per-package `tsc --noEmit`).
A dedicated `pnpm snapshots:ci` alias runs the structural snapshot suite and is wired into the GitHub Actions workflow at `.github/workflows/ci.yml`.

Web-editor (RNW) and Native (RN) adapter snapshots are deferred to v2 — they
inherit from the kernel + adapter layers per the architecture spec.
