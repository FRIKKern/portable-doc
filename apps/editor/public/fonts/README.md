# `apps/editor/public/fonts/`

Self-hosted **Adobe Source Serif 4** TTF bundle — the canonical body face for the v0.4 Paper typography decision.

## Decision in one sentence

The editor's serif voice is **Source Serif 4** (`--paper-font-serif: 'Source Serif 4', Georgia, 'Times New Roman', serif` — see `apps/editor/src/styles/paper.css:32`). The four TTFs in this directory are self-hosted and served by Vite at `/fonts/` in both dev and after `vite build`, so every host — Mac, Windows, Linux, Android — gets the same face without depending on an OS-installed font. Georgia / Times New Roman remain only as the cold-cache fallback during the `font-display: swap` FOUT.

## Files

| File | Notes |
|---|---|
| `SourceSerif4-Regular.ttf` | weight 400, upright |
| `SourceSerif4-Italic.ttf` | weight 400, italic |
| `SourceSerif4-Bold.ttf` | weight 700, upright |
| `SourceSerif4-BoldItalic.ttf` | weight 700, italic |
| `LICENSE.txt` | SIL Open Font License 1.1 |
| `NOTES.txt` | provenance + upstream filename mapping |

The `@font-face` rules that load these live in `apps/editor/src/styles/paper.css:111-134` (one rule per file, `font-display: swap`).

## Provenance

Vendored from Adobe's [`adobe-fonts/source-serif`](https://github.com/adobe-fonts/source-serif) (release branch). The italic and bold-italic files are renamed locally from upstream's `SourceSerif4-It.ttf` / `SourceSerif4-BoldIt.ttf` to the consistent `*-Italic.ttf` / `*-BoldItalic.ttf` scheme — see `NOTES.txt` for the full mapping. Naming follows `2026-05-20-font-bundle-spec.html`.

## Licensing

Source Serif 4 is released under the **SIL Open Font License 1.1** (see `LICENSE.txt`), which permits bundling and redistribution in a web app. No commercial license, no manual extraction, and no per-host font install is required.

## Build guard

`apps/editor/scripts/structural-check.ts` enforces this decision: check **A22** fails the build if `'Iowan Old Style'` appears anywhere in the `--paper-font-serif` stack or if Source Serif 4 isn't the first token, and a companion check requires exactly four `'Source Serif 4'` `@font-face` rules. Keep all four TTFs present and the stack Source-Serif-first.
