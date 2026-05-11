# `apps/editor/public/fonts/`

Self-hosted WOFF2 fallback for the v0.4 Paper typography decision.

## Decision in one sentence

The editor uses a **system-first serif stack** (`'Iowan Old Style', 'Constantia', 'Charter', Georgia, serif`) and **self-hosts an Iowan Old Style WOFF2** here as a `font-display: optional` fallback. Mac users get Iowan from the OS for free; Windows/Linux/Android users get Constantia/Charter/Georgia from their OS on first paint, then the WOFF2 quietly downloads in the background and catches up on the second visit. Never blocks first render.

Locked in pre-flight T1 — see `~/docs/paperflow/notes/2026-05-12-v0-4-typography.html`.

## Files

| File | Status | Notes |
|---|---|---|
| `iowan-old-style.woff2` | **placeholder** — not committed yet | Required for the `@font-face` fallback to resolve. The path is referenced by `paper.css` (added in v0.4 A1). |
| `iowan-old-style.woff2.placeholder` | committed | Zero-byte sentinel so the directory layout is reproducible. |

## Licensing — why this file is not in the repo

**Iowan Old Style is a copyrighted typeface** by Bigelow & Holmes Inc., distributed by Linotype/Monotype. The family ships pre-installed on **macOS** as part of the OS (legally usable by every Mac user), but **redistributing the font file** — including converting the bundled `.ttc` to WOFF2 and shipping it in a public web app — is a separate license question.

Two acceptable paths to obtain the WOFF2 before v0.4.0 ships:

1. **License from Monotype** (the canonical commercial path). Buy a self-hosted web font license for Iowan Old Style on https://www.monotype.com/, receive the WOFF2 from them, drop it in this directory.
2. **Extract from a licensed copy you own.** The user owns macOS, so Iowan ships at `/System/Library/Fonts/Supplemental/Iowan Old Style.ttc`. Conversion to WOFF2 is technically straightforward with `fonttools`:
   ```bash
   pip install fonttools brotli
   # extract regular weight from .ttc
   python -c "from fontTools.ttLib import TTCollection; ttc = TTCollection('/System/Library/Fonts/Supplemental/Iowan Old Style.ttc'); ttc.fonts[0].save('iowan-regular.ttf')"
   # convert to woff2
   python -c "from fontTools.ttLib import TTFont; f = TTFont('iowan-regular.ttf'); f.flavor='woff2'; f.save('iowan-old-style.woff2')"
   ```
   **Legality of this path depends on the macOS EULA / Linotype EULA** — generally OS-bundled fonts are licensed for *use on this machine*, not for embedding into a web app for distribution to third parties. Treat this as a development-only fallback unless a lawyer signs off.

For the v0.4 pre-flight, the file is **left as a placeholder.** The decision is locked, the CSS path is wired up, but the binary asset is sourced manually before v0.4.0 ships.

## `@font-face` block (lands in `paper.css` in task A1)

```css
@font-face {
  font-family: 'Iowan Old Style';
  src: url('/fonts/iowan-old-style.woff2') format('woff2');
  font-weight: 400 700;
  font-display: optional;
}
```

`font-display: optional` is the key. If the WOFF2 isn't in cache when the page paints, the browser skips it entirely for that load — no FOIT, no FOUT, no layout shift. Mac users never hit it (system Iowan wins the cascade). Non-Mac users get Constantia/Charter/Georgia on first paint; by the second visit the WOFF2 is cached and Iowan paints from byte one.

## When to replace the placeholder

- Before `pnpm build` produces a production bundle of `apps/editor` for any public deployment.
- Before the v0.4.0 release tag.

The build should **not fail** when the WOFF2 is missing — `font-display: optional` means the browser simply 404s and falls through to the system stack. CI can lint for the placeholder's presence and warn (not fail).
