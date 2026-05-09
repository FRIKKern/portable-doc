# portable-doc

**One semantic document → deterministic, beautiful output across Web, Native, Email, TUI, and plain text.**

[![CI](https://github.com/FRIKKern/portable-doc/actions/workflows/ci.yml/badge.svg)](https://github.com/FRIKKern/portable-doc/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

PortableDoc is a JSON document format, a compiler, an MCP server, and an editor. Author once against a closed AST of 10 block types; render natively across five surfaces with cross-surface guarantees enforced by the validator at edit time. Inspired by Tamagui, Sanity Portable Text, React Email, and Ink.

## Why

- **Closed by design.** 10 block types, intersection-schema validator. If a property doesn't survive on the most-compromised surface (Email or 80-col TUI), it's rejected at edit time — not papered over per surface.
- **One kernel, four backends.** `composeDocument(doc) → PdNode` builds a backend-agnostic primitive tree; thin adapters (Ink, Email, Web-server, Web-editor, Native) translate. New block = one component. New surface = one adapter.
- **MCP-native.** A local MCP server exposes the compiler as resources and tools; agents and assistants can validate, render, and rewrite documents over stdio.

## Architecture

```mermaid
flowchart LR
  D["PortableDoc (JSON)"] --> V["validateDoc"]
  V --> K["composeDocument (kernel)"]
  K --> B1["backend-ink"]
  K --> B2["backend-email"]
  K --> B3["backend-web-server"]
  K --> B4["backend-web-editor"]
  K --> B5["backend-native"]
  B1 --> O1["terminal text"]
  B2 --> O2["email HTML (Outlook-safe)"]
  B3 --> O3["web HTML"]
  B4 --> O4["RNW DOM (browser)"]
  B5 --> O5["RN tree (iOS / Android)"]
```

## Quick start

```bash
pnpm install
pnpm test                              # 199 specs across 13 files
pnpm --filter editor dev               # http://localhost:5173
pnpm --filter @portable-doc/mcp-server start   # stdio MCP server
pnpm visual-goldens                    # writes goldens/{welcome,incident}-{tui,email,web}.{txt,html}
```

**Requires:** Node ≥ 20, pnpm ≥ 9.

## The editor

A Vite + React app with five preview tabs over the same document tree. The block list sits left, the edit form center, the validation panel along the bottom. Inactive tabs lazy-mount so the RNW preview never costs you anything until you open it. Two fixtures load on boot: `welcome` (onboarding) and `incident` (alert).

Tab order:

1. TUI (default)
2. Email
3. Web
4. Native
5. JSON

## The MCP server

Exposes the compiler over stdio. Five resources, four tools.

**Resources:**

- `portable-doc://schema/v1`
- `portable-doc://surface-contracts`
- `portable-doc://tokens/default`
- `portable-doc://examples/welcome`
- `portable-doc://examples/incident`

**Tools:**

- `doc_validate`
- `doc_render`
- `doc_explain_block`
- `doc_suggest_fixes`

`doc_render({ surface: "web" })` uses the slim hand-written `backend-web-server`, not RNW — the editor's RNW preview is browser-only.

## Block set

Ten block types:

- `heading`
- `paragraph`
- `list`
- `callout`
- `action`
- `section`
- `divider`
- `code`
- `image` — escape-hatch (`surfaces: ['web','native']`); renders as alt text on TUI and a placeholder on email
- `table` — escape-hatch (`surfaces: ['web','native']`); same fallback behavior

## Validator rules

Three rule classes:

- **Prop allowlist.** Reject `borderRadius`, `opacity`, `boxShadow`, `transform`, `animation`, `gradient`, `flex`, `flexWrap`, `justifyContent: 'space-between'`, `alignSelf`. Allow only the intersection-safe shape.
- **Content constraints.** `code` lines ≤ 60 cols; `tone` ∈ `{success, warning, danger, info, neutral}`; non-empty unique block ids; length limits on heading text and action labels.
- **URL safety.** Scheme allowlist: `http | https | mailto | tel`. Defense-in-depth at validate, kernel, and HTML-emitting backends.

## Monorepo layout

```
packages/
  core/                 AST + tokens + validateDoc
  primitives/           Pd* shape + composeDocument kernel
  pd-to-rn-shim/        Pd → RN-shaped data translation
  backend-ink/          terminal text adapter
  backend-email/        React Email adapter (Outlook VML, dark mode, a11y)
  backend-web-server/   hand-written HTML adapter (used by MCP)
  backend-web-editor/   react-native-web wrapper (editor preview only)
  backend-native/       react-native re-export through the shim
  mcp-server/           MCP server: 5 resources + 4 tools
apps/
  editor/               Vite + React editor (5 preview tabs, TUI default)
fixtures/               welcome + incident reference docs
scripts/visual-goldens.ts  emit per-fixture per-surface artifact files
```

## Testing

Three layers:

| Layer                                                                | Frequency         | Command                                       |
| -------------------------------------------------------------------- | ----------------- | --------------------------------------------- |
| Structural snapshots (kernel primitive-tree + Ink + Email + RE HTML) | every commit (CI) | `pnpm test`                                   |
| Per-adapter unit specs (escaping, allowlist, determinism, …)         | every commit (CI) | `pnpm test`                                   |
| Visual goldens (Ink TUI, Email HTML, Web HTML)                       | on demand         | `pnpm visual-goldens` then eyeball `goldens/` |

199 specs across 13 files at the time of release. CI also runs `pnpm typecheck` (per-package `tsc --noEmit`); `pnpm snapshots:ci` runs the structural snapshot suite and is wired into `.github/workflows/ci.yml`. Web-editor (RNW) and Native (RN) adapter snapshots are deferred — they inherit from the kernel + adapter layers.

## Status

v0.1.0 — first release. The architecture is locked: validator, kernel, all five backends, the MCP server, and the editor ship working. 199 specs across 13 files pass; the React Email adapter sits at ~637 LOC and every other package is within its per-task budget. Next up: richer inline editing, footnotes, and an Expo native demo app.

## Inspirations

- **Sanity Portable Text** — JSON document tree decoupled from rendering.
- **React Email** — email-client-safe component primitives.
- **Ink** — finite, named primitives for terminal output.
- **Tamagui** — token-driven, surface-aware rendering.

## License

MIT — see [LICENSE](./LICENSE).

---

Author: Frikk Jarl · 2026.
