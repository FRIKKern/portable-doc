# 0001 One home for PortableDoc

Date: 2026-10-31 · Status: accepted

```
before                                   after
barkpark holds the format, reader,       portable-doc holds spec, goldens, ops,
editor and 3 more renderers; 3 apps      editor, JS renderers; every app pins a
carry look-alike copies                  version and passes the same goldens
```

## Context

PortableDoc is rendered in five places inside Barkpark (Elixir reader, editor canvas, `@barkpark/react`, Go `pdrender` + WASM, mobile) and three apps carry look-alikes (Barkever `Blocks.tsx`, barkpark-studio `PortableDocView.tsx`, next-starter `portable-doc.tsx`). Apps live-load the editor from whatever the server serves: Barkdown's fallback is contract 1.14 while the server is 1.19. A 28-agent scope run measured the coupling ([SCOPE.md](../SCOPE.md)).

## Decision

PortableDoc gets one home, this repo. It holds the spec, the stamped goldens, the edit ops, the editor and the JS renderers. Barkpark keeps the Elixir reader, because it needs Barkpark's translations and chat parts, and proves it with the same goldens.

One name everywhere: PortableDoc. Stored docs keep `"format": "portableDoc"`, so nothing is migrated.

The move goes rules first, code later, in reward milestones R0–R7. Every milestone ships a reward you can see (Z10); every step copies first and switches later (Z9).

Progress is visible from here: the roadmap picture and the README timeline are generated from the board by `scripts/`, refreshed daily and on every push by `.github/workflows/housekeeping.yml`.

## Considered

- **Only the editor in its own repo.** Rejected: the editor is one of eight renderers; the drift between them is the bigger cost.
- **Rename to GoodDoc.** Rejected: stored data and public imports already say PortableDoc; a rename means aliases or a fleet-wide data migration.
