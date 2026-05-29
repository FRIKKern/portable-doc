# Design Philosophy

> Why PortableDoc exists, and how to think about it.

This is the slow-burn document. If you want the technical spec, read
[`architecture.md`](./architecture.md). If you want to ship a change, read
[`../CONTRIBUTING.md`](../CONTRIBUTING.md). This file explains the *frame* —
the design rules that decide what gets into the AST and what stays out.

## The problem

One semantic document. Many surfaces. Premium UX everywhere.

A product team writes an incident report once and ships it as:

- a styled web page (Web)
- a native iOS / Android view (Native)
- an Outlook-safe email (Email)
- a beautifully rendered terminal block (TUI)
- a plain-text fallback that survives any pipe

Today the industry's answer is "write five times, by five teams, with five
inconsistencies." PortableDoc's answer is: lock the input, render five times,
get a binary contract — every valid document renders natively on every
surface, or the validator rejects it at edit time.

## The frame: convex hull, not floor

The first instinct is to find the *floor*: the most-limited surface, design
the AST inside its constraints, and trust that everything richer will
gracefully scale up. We tried that. It's wrong in a subtle way.

There is no single floor. The surfaces compromise on different axes:

| Surface | Strong on | Weak on |
|---|---|---|
| Web | Layout, color, typography | None of the others' weak spots |
| Native | Layout, color | Outlook-style email constraints |
| TUI (Charm/Ink-class) | 24-bit color, OSC-8 hyperlinks, inline images via Kitty / iTerm2 | Pixel layout, custom fonts |
| Email | Color, system fonts | Layout (table-only), no media queries, Outlook strips half of CSS |
| Plain text | Universal portability | Everything visual |

Email and TUI are *both* constrained, but on different axes. Email is more
limited on *layout* than TUI. TUI is more limited on *fonts and pixel
geometry* than Email. There is no "Email is the floor" framing that holds
once you take Charm-quality TUI seriously.

The right frame is a **convex hull** — the set of features every surface
can render at top UX. Not the lowest common denominator, the highest
shared denominator. PortableDoc's job is to find that hull and commit to it.

## The two-question test

Every candidate AST feature passes (or fails) two gates:

1. **Does the AST need this for expressive documents?** (authoring freedom)
2. **Can every surface render it at top UX — not just "without crash"?**
   (cross-surface fidelity at quality)

Both yes → the feature is IN. Either no → drop it.

| Feature | Q1: AST needs? | Q2: Top UX everywhere? | Verdict |
|---|---|---|---|
| Truecolor tone palette | yes (callouts need color) | yes (24-bit → 256 → 16 → bracket prefix degrades cleanly) | **IN** |
| Border radius (rounded corners) | nice-to-have | Outlook strips, TUI can't honor | **OUT** |
| Inline image | yes (incident reports need screenshots) | Web/Native/TUI yes; Email/text fall back to alt-text | **IN** as escape-hatch |
| Hover state on buttons | no (it's an app concern) | TUI/Email/plain-text can't honor | **OUT** |
| Custom font-family | no (system stacks deliver) | Email partial, TUI no | **OUT** |

The validator encodes this test as code. Three rule classes (prop allowlist,
content constraints, URL safety) plus a fourth (variant allowlist) reject
any property that fails Q2.

## What's IN the sweet spot

The AST commits to a closed set:

- **10 block types** — `heading`, `paragraph`, `list`, `callout`, `action`,
  `section`, `divider`, `code`, `image`, `table`. The last two carry
  `surfaces: ['web','native']` (image extends to TUI in v0.2.1.A) and degrade
  to alt-text on Email and plain text.
- **5-tone palette** — `success`, `warning`, `danger`, `info`, `neutral`.
  Hex in the AST, surface-degraded on render.
- **Variant catalog** — per-block named variants (`<Callout tone="success"
  emphasis="bold">`). 21 variants across callout (5×2), action (2×2),
  section (3), code (2×2). The keystone of v0.2.
- **Pd\* primitives** — `<PdBox>`, `<PdText>`, `<PdLink>`, `<PdInlineCode>`,
  `<PdButton>`, `<PdHr>`, `<PdContainer>`, `<PdImage>`, `<PdTable>`,
  `<PdCallout>`. Ten kinds (`packages/primitives/src/pd.ts` — the `PdNode`
  union). Shaped like React Native's primitive set, paperflow-owned.
- **PortableDoc-owned token system** — color, space (xs/sm/md/lg/xl),
  borderStyle (single/double/bold), system-font typography. No web-fonts,
  no custom radius.

## What's OUT (above the ceiling)

The validator rejects these properties at edit time, not at render time:

- Animations, transitions
- Gradients, shadows, opacity
- Hover, focus, active states
- Responsive variants (`sm:` / `md:` / `lg:`)
- Custom fonts beyond system stacks
- Border radius
- 3D transforms, scale, rotate

Each rejection corresponds to a feature that fails Q2 — at least one surface
can't render it at top UX, so it never enters the AST.

## Plain text — the universal degradation target

Plain text isn't a feature set we constrain the AST to. It's where the AST
renders *down to* via a dedicated rendering strategy. Today that strategy
lives inside `backend-ink`: `renderInk(node, { colorDepth: 'mono',
hyperlinks: false })` walks the same Pd-tree and emits structural prose
with no ANSI escapes.

Every surface above plain text inherits the same per-feature degradation
pattern: detect capability, render rich if available, fall back to the
plain-text shape if not. `supports-color` detects color depth (24-bit →
256 → 16 → mono). `terminal-image` detects graphics protocols (Kitty /
iTerm2 / ANSI half-block). OSC-8 unsupported → bare URL after label.
Same logic per feature, written once in each backend.

A v0.2 audit considered carving out a separate `backend-text` package.
Decision: defer. `renderInk(mono)` already produces acceptable plain-text
output, and a separate package would move boundaries without improving
quality. If Markdown-pure text matters later, fold a `mode: 'text'` flag
into `backend-ink` (~30 LOC), no new package.

## The variant catalog

The variant catalog is the actual design vocabulary, and the keystone of
v0.2. Per block, a finite enum of named visual states:

```ts
<Callout tone="success" emphasis="bold">
<Action priority="primary" size="large">
<Section density="comfortable">
<Code theme="dark" density="compact">
```

Tamagui-inspired pattern. Paperflow-owned implementation. Every variant
resolves at editor save-time to a fully-specified `PdStyle` that the
existing five backends already consume — the AST stays single-language,
backends hand-tune per-variant for top UX.

Why the catalog matters: it's how PortableDoc encodes the design system
without leaking surface-specific details into the AST. The author picks
`tone="success"`; backend-ink renders it as truecolor green with a left-rule
glyph; backend-email renders it as a green table cell with VML-bordered
icon; backend-web renders it as a styled callout component. Same author
intent, surface-idiomatic execution.

## Inspiration policy

Five projects shaped the design. None ship as runtime dependencies:

| Project | What we borrowed | What we left behind |
|---|---|---|
| **Tamagui** | Token-driven primitives, variants pattern | The whole Tamagui runtime |
| **Sanity Portable Text** | JSON document tree, decoupled rendering | Open schema, BYO renderer per project |
| **React Email** | Email-client-safe component primitives | The full RE component library |
| **Ink** | Finite, named primitives for terminals | JSX-everywhere, interactivity |
| **Tailwind** | Token-driven utility thinking | Class-string syntax, the runtime |

Tailwind class syntax is explicitly rejected — even paperflow-namespaced
strings like `"p-4 bg-success-50"`. PortableDoc's "utility" is the variant
catalog plus typed token objects, not Tailwind shorthand.

## Why "utility" means strong interfaces

Tailwind's success comes from disciplined design tokens, not class strings.
PortableDoc takes the discipline and skips the strings. The shipping
"utility surface" is:

- **The variant catalog** (v0.2) — named visual states resolve to PdStyle.
- **The token objects** (v0.1) — color, space, borderStyle as TypeScript
  objects, not class lookups.
- **The color-depth interface** (v0.2.1) — `resolveColor(hex, depth)`
  centralizes degradation across backends.

These are paperflow-owned, paperflow-named, statically typed. No
parser-at-edit-time. No runtime class-string lookups. The utility *is*
the strong internal interface.

## Comparison: Sanity Portable Text

Portable Text and PortableDoc are siblings — both JSON document trees,
content decoupled from rendering. They diverge at the schema layer:

| Axis | Portable Text | PortableDoc |
|---|---|---|
| Schema model | Open — bring your own block types | Closed — 10 fixed types, validator enforces |
| Origin | Sanity CMS (rich-text authoring) | One-doc-many-surfaces (deterministic compile) |
| Inline links | Marks reference markDefs by `_key` (good for dedup, footnotes) | Link is a tree node, href on node |
| Custom blocks | First-class — schema declares them | Rejected — validator enforces 10-type union |
| Renderer model | Per-surface, BYO components mapping `_type → component` | Shared kernel composes Pd primitives; backends adapt Pd-tree |
| Cross-surface guarantee | None — each renderer is independent | Binary contract — same input renders same on all 5 surfaces |
| Optimizes for | Extensibility | Uniformity |

PortableDoc kept the JSON tree and threw away the openness. Portable Text
optimizes for extensibility; PortableDoc optimizes for uniformity. Pick
by problem: rich CMS authoring with per-renderer freedom → PT. Same
document landing cleanly across web + email + terminal + native with a
contract enforced at edit time → PD.

## What we shipped

**v0.1.0** — first release. The architecture locked: validator, kernel,
all five backends, the MCP server, and the editor ship working. 272 specs.

**v0.2.0 — Sweet-Spot Architecture.** Layered the cross-surface component
kit on top of v0.1: `@portable-doc/variants` with 21 named variants across
4 block catalogs; a 4th validator rule class (`variant-allowlist`);
`backend-ink` v0.2 with truecolor + Lipgloss-equivalent borders +
cli-highlight syntax-coloring + iTerm2 inline images; editor variant UI;
sweet-spot reframing in the architecture spec.

**v0.2.1 — Cleanup release.** Strong color-depth interface in `backend-ink`.
Package collapses: `backend-web-server` + `backend-web-editor` →
`backend-web` (with `static`/`rnw` subpath exports); `backend-native`
inlined into `pd-to-rn-shim`; `fixtures` package → `examples/*.json`.
Documentation distilled into this `docs/` tree. 8 packages. 282 specs.

**v0.3 — Public playground.** Shipped `apps/playground`: paste a PortableDoc
JSON, live-validate it, preview across all five surfaces, and share via a
`?doc=` URL — deployed to GitHub Pages. The MCP server gained `applyDocPatch`
structured-patch handling.

**v0.4 — Paper editor.** Rebuilt `apps/editor` as a single-column TipTap
WYSIWYG on warm cream paper, replacing the v0.3 three-panel grid. Live
surface tabs gave way to DOCX / EPUB / PDF / Ink export surfaces, and the
self-hosted Source Serif 4 (SIL OFL) bundle became the canonical body face.
The MCP server added barkpark forwarding for live streaming of applied ops.
445 specs across 36 files.

## Cross-references

- [`architecture.md`](./architecture.md) — the technical spec.
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — how to set up, test, and
  add a backend.
- [`../README.md`](../README.md) — the project front door.

---

*Author: Frikk Jarl · 2026.*
