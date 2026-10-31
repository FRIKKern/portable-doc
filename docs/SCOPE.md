# Scope

What the move touches, measured on 2026-10-30 by a 28-agent scope run against Barkpark `61d7c546c8`. Every number came with a file path or command; the full evidence stays with the plan.

```
TODAY: one monorepo builds, commits and serves the editor
FRIKKern/barkpark
  api/assets/paper-editor/   85 shipping files, 279 test files
     npm run build ──► api/priv/static/assets/  bundle.js · editor.css · bp-paper-code.js · bp-paper-surface.css
        │ deploy builds nothing; servers serve committed bytes
        ├─ Studio LiveView + field canvas + public reader     same origin
        ├─ web/ (Next.js)                                     own committed copy
        ├─ Barkever ── /v1/embed/canvas ──► browser + Mac app  floor 1.17.0
        ├─ barkpark-studio ── /v1/embed/canvas                 no pin
        └─ Barkdown ── server /assets/* ► cache ► vendored 1.14.0 fallback
```

## Renderers of the format

| Renderer | Where | Note |
|---|---|---|
| Elixir reader | `barkpark/api/lib/barkpark/portable_doc/` | The source of truth; also renders email |
| Editor canvas | `barkpark/api/assets/paper-editor/` | `<bp-paper-canvas>`, `<bp-paper-editor>` |
| React | `barkpark/js/packages/react/src/PortableDoc.tsx` | Public as `@barkpark/react/portable-doc` |
| Go + WASM | `barkpark/internal/pdrender` | |
| Mobile | `barkpark/apps/mobile/src/papers/portabledoc` | 7,254 lines |
| Look-alikes | Barkever `Blocks.tsx`, barkpark-studio `PortableDocView.tsx`, next-starter `portable-doc.tsx` (359 lines) | Read-only copies |

## Numbers

| Measure | Value |
|---|---|
| Editor shipping files / lines | 85 / 39,010 |
| Editor test files / lines | 279 / 52,944 |
| `npm test` chain | 281 entries |
| Editor tests reading files outside the editor folder | 129 of 279 |
| Editor folder copied alone: tests passing | 151 pass, 130 fail |
| Largest files | `canvas/index.js` 5,682 lines, `canvas/run-convert.js` 5,309 |
| Commits touching the folder | 459; `filter-repo` keeps 470 (2.28 MiB) |
| Co-change since 2026-08-01 | 69% of editor commits also touch files outside the folder |
| Contract moves | 1.0.0 → 1.19.0 in 18 bumps, 2026-10-05 to 2026-10-30 |
| Barkdown lag | contract 1.14 vs 1.19 |
| Path references to the folder in Barkpark | 105 |
| Elixir tests reading editor source | 7, plus 6 on built assets |
| Bundle size | 1,006,682 B (package tarball 389,787 B packed) |
| Reader classes covered by no fixture | 117 of ~341 |
| barkpark-studio CSS lines on editor internals | 102 |
| App e2e touching the editor | Barkever 53 tests in 12 files; Barkdown 62 live files; barkpark-studio 38 of 143 specs |

## What stays in Barkpark

The Elixir reader, `Patch`/BlockOps and the golden generator stay: the server must render, and the reader depends on Barkpark's Gettext and chat parts. They prove themselves against the goldens published here.
