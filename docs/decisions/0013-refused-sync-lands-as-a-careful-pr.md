# 0013 A sync the check refuses lands as one careful PR

Date: 2026-11-20 · Status: accepted · Amends [0009](0009-sync-merges-itself.md) and [0011](0011-sync-merges-by-number.md)

```
Barkpark main ─► hourly job ─► copy ─► npm run check ─ fails ─► no merge; every run fails again
                                                              │
   a person ◄─────────────────────────────────────────────────┘
      one PR, careful review:
        commit 1  node scripts/sync-from-barkpark.mjs at a named Barkpark commit, nothing else
        commit 2  the change here that makes the check accept those bytes
      merged ─► the job finds main the same as Barkpark ─► done, until Barkpark moves again
```

## Context

The job merges its own PR only on a green check (0009), and it owns `sync/barkpark`, which it pushes on every run (0011). When new Barkpark bytes need a change here, such as a test's list that does not know a new file kind or an export, the job cannot carry that change. A change made first, on `main`, cannot go green either: a test that pins an exact count, or a name the synced code must export, holds only with the new bytes. So the sync stays red.

## Decision

- The fix lands as one PR with two commits, reviewed as careful class.
- Commit 1 is the sync script's own output at a Barkpark commit that the PR names, and nothing else. The reviewer reruns the script at that commit: the diff against commit 1 is empty, and `check-pack --against` says the copy is the same as Barkpark. This copies the bytes Barkpark committed, as 0003 asks, and is no hand edit.
- Commit 2 is the change here. It loosens, skips or excuses nothing. A test whose list does not know something new gets the new names together with the rows that judge them. A real loss in the bytes is Barkpark's, and is fixed there.
- The job's red runs before the merge merge nothing (0009). After the merge the job finds `main` the same as Barkpark and does nothing, until Barkpark moves again.
