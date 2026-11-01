# 0005 The sync carries conformance/, housekeeping draws the heatmap

Date: 2026-11-01 · Status: accepted · Extends [0003](0003-pull-sync.md)

```
Barkpark api/priv/portable_doc/conformance/*.json ─► sync PR (same as 0003) ─► merge to main
                                                                                   │ push
docs/images/conformance.svg ◄── generate-heatmap.mjs ◄── housekeeping on main ◄────┘
```

## Context

Each Barkpark renderer writes `conformance/<renderer>.json`: one row per block golden, `pass`, `fail`, `missing` or `unchecked`, stamped with the pack it ran against. Barkpark's Elixir gate fails when a report's stamp is not the pack's, so `main` never holds a stale report. The README needs those reports as one picture.

## Decision

- `conformance/` is a third synced directory beside `spec/` and `goldens/`: copied by `sync-from-barkpark.mjs`, hashed in `SOURCE.json`, carried by the one `sync/barkpark` PR.
- `npm run check` fails when a report's `pack_stamp` is not the sha256 of `goldens/stamp.json`, when a report lacks a row for a block golden or has one too many, when a status is unknown, when there are no reports (Z8), and on a hand edit. The sync refuses a Barkpark pack that fails the same checks.
- `scripts/generate-heatmap.mjs` draws `docs/images/conformance.svg` from the committed reports and refuses reports that fail the check. Housekeeping redraws it on every push to `main`, beside the roadmap.
- `npm run check` does not compare the committed picture with a fresh draw. A sync PR changes the reports but not the picture, and must still pass; the picture catches up when housekeeping runs after the merge. The two never write the same file.

## Considered

- **The sync PR redraws the picture.** Rejected: the picture would then have two writers, and the sync PR's diff would mix Barkpark's bytes with ours.
