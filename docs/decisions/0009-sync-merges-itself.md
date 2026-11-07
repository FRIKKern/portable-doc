# 0009 The sync PR merges itself

Date: 2026-11-07 · Status: accepted · Amends the "one PR" line of [0003](0003-pull-sync.md) · Task: task-e3dcacc674c89222

```
Barkpark main ─► hourly job ─► differs? ─► copy ─► npm run check ─► PR ─► merge
                                  │ no                  │ fails
                                  └─ done               └─ no PR, job fails
```

Sync PRs waited up to 12 hours for a person, while nothing they carry is written by hand here. Barkpark's required `mix test` already holds the bytes, and this job runs `npm run check` first. So the job merges its own PR. A failed check still stops it, and the failed run is the alert.
