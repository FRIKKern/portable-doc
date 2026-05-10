# Contributing to portable-doc

Thanks for considering a contribution. Here's the lay of the land.

## Setup

Requires Node ≥ 20 and pnpm ≥ 9.

```bash
git clone https://github.com/FRIKKern/portable-doc.git
cd portable-doc
pnpm install
pnpm test                    # 282 specs across 15 files
pnpm --filter editor dev     # http://localhost:5173
```

## Project layout

Eight packages plus the editor app. See [`docs/architecture.md`](./docs/architecture.md)
for the technical spec; [`docs/design-philosophy.md`](./docs/design-philosophy.md)
explains the design rules that decide what's in the AST.

```
packages/
  core/              AST + tokens + validateDoc
  primitives/        Pd* shape + composeDocument kernel
  variants/          Variant catalog (21 variants × 4 block types)
  pd-to-rn-shim/     Pd → RN translation; doubles as the Native surface
  backend-ink/       Terminal text adapter (also: plain-text fallback)
  backend-email/     React Email adapter (Outlook VML, dark mode, a11y)
  backend-web/       Web adapter — /static (MCP) + /rnw (editor)
  mcp-server/        MCP server: 5 resources + 4 tools
apps/editor/         Vite + React editor (5 preview tabs, TUI default)
examples/            welcome.json + incident.json
```

## How to add a backend

1. Implement `render(node: PdNode) → string` (sync) or async equivalent.
2. Consume the kernel's output: `composeDocument(doc) → PdNode` from
   `@portable-doc/primitives`.
3. Wire into `mcp-server`'s `doc_render` tool if the backend should be
   reachable from agents.
4. Update `scripts/visual-goldens.ts` to emit a per-fixture artifact.
5. Add a structural snapshot test to the package's `vitest.config.ts`.

The architecture doc walks through how Pd\* primitives compose and where
each backend slots in.

## Tests

`pnpm test` runs the workspace. Filter by package:

```bash
pnpm --filter @portable-doc/core test
pnpm --filter @portable-doc/backend-ink test
```

Snapshots regenerate with `-u`:

```bash
pnpm --filter @portable-doc/backend-email test -u
```

Visual goldens (Ink TUI, Email HTML, Web HTML) are eyeball checks, not CI:

```bash
pnpm visual-goldens   # writes goldens/{welcome,incident}-{tui,email,web,text}.{txt,html}
```

## Reporting issues

Open an issue at https://github.com/FRIKKern/portable-doc/issues. Include:

- **Surface** — web, email, tui, native, or text.
- **Document JSON** — the smallest reproduction that triggers the bug.
- **Expected vs actual output**.

## License

MIT — see [LICENSE](./LICENSE).
