# 0007 apply_ops judges duplicate ids at the end of the batch, as Barkpark does

Date: 2026-11-02 · Status: accepted · Amends the "per op" line of [0006](0006-mcp.md)

```
start ──op 1──► ──op 2──► … ──op n──► end
        │         │                    │
        │  names an id the batch       │  an id the batch leaves repeated,
        │  has made repeated? refuse   │  more often than at start? refuse,
        │  (that op)                   │  naming the last op that added a copy
        │
        └─ any other error stops the batch first: a later bad op's error beats a leftover repeat
```

| Case (criterion on task-f4a4647b62b33643) | Answer |
|---|---|
| 1 a move whose id sits twice mid-batch | applies |
| 2 a repeat the batch leaves | `duplicate_id`, last op that added a copy |
| 3 a legacy pair that grows | `duplicate_id` |
| 4 an op naming an id the batch made repeated | `duplicate_id`, that op |
| 5 an op on a legacy repeat | edits the first match |
| 6 a leftover repeat plus a later bad op | the later op's error |
| 7 an incoming block that repeats an id inside itself | `duplicate_id` |
| also: `append-block` or `insert-after` of an id already in the doc | `duplicate_id` at that op, still (Patch's own guard), so a later bad op or a later removal does not change it |

## Context

Barkpark main at `0db4b40d89` (barkpark#25056) moved the duplicate-id check out of each op: `Patch.apply_patches` and both BlockOps folds apply each op with `duplicates: {:batch, start}` and call `Patch.refuse_new_duplicates` once at the end. A move written as "replace the new section, then the old one" now lands; before, its first op was refused. A single `apply_patch` keeps the per-op check.

## Decision

- **`applyPatches(doc, ops)` mirrors `Patch.apply_patches`.** Each op runs through `applyPatch(acc, op, start)`: the named-repeat check first (the op's `after`, `afterId`, `id`, in that order, as Elixir's `Map.take |> Map.values` returns them), then the op, then locked placement; no per-op duplicate check. At the end, the first id in walk order that is repeated and more frequent than at start is refused.
- **`applyOps` is the BlockOps fold.** Same fold, each op lowered against the current doc first. Its `index` for an end refusal is the op that last added a copy, the op Barkpark names.
- **The adding op comes from the fold's own steps**, not a replay: Barkpark replays the same ops from the same start, which gives the same steps.
- **`applyPatch(doc, op)` alone is unchanged.**
- **Checked three ways.** `differential.mjs --batch` runs seeded random batches (moves between sections, ops naming the moved id, legacy repeats, random ops) through both folds: 0 mismatches. `test/batch-elixir.json` replays 5,000 of Barkpark's answers in `npm run check`. `test/batch-vectors.json` holds nine vectors, the seven cases and two for the guard, with Barkpark's full answers, written by `vectors.mjs`, for any second fold to replay.
