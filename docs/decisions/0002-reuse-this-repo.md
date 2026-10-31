# 0002 Reuse FRIKKern/portable-doc, old code kept at legacy-v0.4

Date: 2026-10-31 · Status: accepted

```
master ──●──●── … ──● 5c72d86   ◄ tag legacy-v0.4, branch legacy (kept)
main   ●  new history: the hub (R0), the editor's history merges in at R5
```

## Context

This repo already held a 10-type PortableDoc: a closed AST, an intersection-schema validator, a kernel with five backends (Ink, email, web static, React Native Web, native), an MCP server and a Vite editor, 835 specs, MIT. Barkpark's format grew to 80 block types on its own path; the two are not compatible.

## Decision

- The old code stays reachable at tag `legacy-v0.4` and branch `legacy` (both at `5c72d86`).
- `main` starts a new history. The editor's history merges in at R5 with `git filter-repo`, so blame survives.
- License is Apache-2.0, matching Barkpark and the editor. The old MIT code is the owner's own and stays MIT at its tag.
- Ideas are reused, code is not ported:

| Old piece | Reused in |
|---|---|
| Closed AST + intersection-schema validator | R4 validator design |
| `packages/mcp-server` | R4 MCP server design |
| `backend-ink`, `backend-email` | R7 plain-text output |
| `apps/editor/scripts/lib/editor-page.ts`, `docs/parity-trust-boundary.md` | R2 host pages and trust ladder |

## Considered

- **A new repo.** Rejected: the name already exists and already promises this; a second repo means two names again.
