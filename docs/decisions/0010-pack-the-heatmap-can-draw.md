# 0010 Check and sync refuse a pack the heatmap can't draw

Date: 2026-11-07 · Status: accepted · Extends [0005](0005-conformance-heatmap.md), which leaves out two rules the code already enforces · Task: task-c1e195ef5c950f7e

```
Barkpark pack ─► check-pack + dry-run draw ─┬─ fine ──► sync copies it, check passes
                                            └─ refused: nothing copied, check fails
```

**A pack must fit the picture.** `scripts/check-pack.mjs` and `scripts/sync-from-barkpark.mjs` both run `draw` from `scripts/lib/heatmap.mjs` without writing. They refuse a renderer name over 32 characters (`MAX_NAME`) and more renderers than one panel holds. Otherwise the sync would land a pack, and housekeeping would then fail to redraw on `main`.

**A report says how it compared.** Every `conformance/<renderer>.json` declares `compare`: `dom` or `text`. Anything else fails the check. The heatmap orders columns by it: reference, then dom, then text.

Enforced by:

- Names and panel limit, in check and sync: [`scripts/pack.test.mjs`](../../scripts/pack.test.mjs) (`a renderer name the heatmap cannot fit`, `more renderers than the heatmap can hold`).
- Names and panel limit, in the draw itself: [`scripts/heatmap.test.mjs`](../../scripts/heatmap.test.mjs) (`it fits renderer names of 32 characters and refuses longer ones`, `it refuses more renderers than one panel can hold, naming the limit`).
- `compare`: [`scripts/pack.test.mjs`](../../scripts/pack.test.mjs) (`a report whose compare is neither dom nor text`).
