# 0011 The sync merges by number, at the head it pushed

Date: 2026-11-07 · Status: accepted · Amends [0003](0003-pull-sync.md) and [0009](0009-sync-merges-itself.md) · Task: task-e3dcacc674c89222

```
scripts/sync-pr.mjs --merge
  open PR from this repo? ─► always push ─► create or edit ─► merge #N at HEAD ─► view #N: MERGED? ─ no ─► try again, then fail the run
                                                                                                └ yes ─► housekeeping job dispatches housekeeping.yml
```

Before the first real merge, one review and one reading of the docs turned up four gaps in the step as 0009 left it. The first two come from gh's source and real queries; none of them has been run end to end.

| Gap | Fix |
|---|---|
| The repo is public, so anyone can open a fork PR from a branch named `sync/barkpark`. `gh pr list --head` would find it, the script would edit it, and the merge by branch name would fall back to old merged #30: exit 0, green run, nothing landed | Open PRs are filtered to this repo. The merge is by number, and `gh pr view` must then say `MERGED` |
| 0003's early exit leaves an open PR alone when its pack matches, so a merge would take a head the check never saw. Nothing else guards `main` | No early exit. Every run pushes, and the merge uses `--match-head-commit` |
| A merge made with `GITHUB_TOKEN` fires no `push` event, so the heatmap and README would wait for the daily run | A job dispatches `housekeeping.yml` after a merge. It alone holds `actions: write`, which `npm ci` and the check never need |
| GitHub may refuse a merge while it works out mergeability, and scheduled runs arrive hours apart | Five tries, five to twenty seconds apart |

**To hold the sync back, disable the workflow.** Closing the PR no longer holds it: the next run opens another and merges it.
