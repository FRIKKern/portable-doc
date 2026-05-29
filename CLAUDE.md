# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


## Build & Test

Requires Node ≥ 20 and pnpm ≥ 9.

```bash
pnpm install                                   # bootstrap the workspace
pnpm test                                      # run all specs (vitest run)
pnpm typecheck                                 # tsc --noEmit across every package (pnpm -r typecheck)
pnpm format                                    # prettier --write .
pnpm dev:full                                  # editor on :5173 + MCP HTTP on :6123 (concurrently)
pnpm --filter editor dev                       # editor only — http://localhost:5173
pnpm --filter @portable-doc/mcp-server start   # stdio MCP server
pnpm visual-goldens                            # regenerate eyeball-check goldens
```

Filter tests/typecheck to one package with `pnpm --filter @portable-doc/<pkg> test`.

## Architecture Overview

One PortableDoc JSON renders across five surfaces (Web, Email, TUI, Native, Text)
through a shared kernel — `validateDoc` (core) → `composeDocument` (primitives) →
per-surface backends, with an MCP server and two apps (`apps/editor`, `apps/playground`)
on top. Full technical spec: [`docs/architecture.md`](./docs/architecture.md).

## Conventions & Patterns

- **Closed schema** — the AST is a fixed, validated set of block/inline kinds;
  new shapes pass the design rules in [`docs/design-philosophy.md`](./docs/design-philosophy.md)
  before they enter, and the validator rejects unknown nodes at edit time.
- **Kernel-first** — backends never re-implement structure; they consume the
  kernel's `composeDocument` output. Add a backend by rendering Pd\* primitives,
  not by reparsing the doc.
- **SIL-OFL fonts** — Source Serif 4 is self-hosted and embedded across every
  channel (editor, DOCX, EPUB, HTML, PDF); see `apps/editor/public/fonts/`.
