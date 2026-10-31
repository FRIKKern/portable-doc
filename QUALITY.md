# Quality

## The bar

| Rule | Check |
|---|---|
| A journey is done only when someone other than its builder signs it off, naming the sha | task criteria |
| Every renderer passes the goldens for every block type it claims | conformance heatmap |
| No check skips and passes; an empty corpus fails (Z8) | each runner counts its cases |
| A stale golden stamp fails, on both sides | stamp check |
| Predict, then run: unit tests and the real app are two oracles; both must pass | layer 1 + layer 2 |

## Zero downtime

| # | Rule |
|---|---|
| Z1 | Names and bytes never change in the same step |
| Z2 | Every app pins before Barkpark changes how it serves |
| Z3 | The first swap is byte-identical; behavior changes come later |
| Z4 | Rollout: workbench → host pages → guerrilla → one fleet box → fleet → app releases |
| Z5 | Every step has a one-line rollback, written before it ships |
| Z6 | `"format": "portableDoc"` never changes; `/v1/embed/canvas`, `/assets/bp-paper-*` and `<bp-paper-*>` keep their names until R7 |
| Z7 | Minor versions only add; an old-client replay test guards saves |
| Z8 | No check skips and passes |
| Z9 | Barkpark stays the source of each piece until that piece's flip |
| Z10 | No milestone without a reward you can see |

## Docs

- Picture first: README, docs and decisions open with a diagram, a table or a screenshot.
- README stays at or under 80 lines; `npm run check` enforces it and checks links.
- One fact, one home. Status lives on the board, never in docs.
- Generated files (`docs/images/roadmap.svg`, the README timeline) are never edited by hand.
