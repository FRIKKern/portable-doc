# 0008 48-hour review trial

Date: 2026-11-07 · Status: accepted, ends 2026-11-09 unless the owner keeps it · Overrides parts of AGENTS.md until then · Task: task-6764ed1adbb45b48

```
now    build ─► agent review ─► fix ─► merge
trial  build ─► npm run check ─► merge it yourself
                             └─ risky code only: one review first
```

Review took about 34% of agent hours here. Plan: /papers/ecosystem-efficiency-plan.

**Risky code keeps its review before merging:** `SPEC.md`, `scripts/sync-*`, `scripts/lib/pack.mjs`, `.github/workflows/`, and anything that changes how a document is read or written.

**Other code.** `npm run check` on a branch, then open the PR and merge it yourself. Put `Trial: unreviewed` in the commit message, so the work can be counted and audited. This covers the "ask before pushing" rule for this work only.

**Unchanged.** Worktrees, no skip-pass, no hand edits to `spec/`, `goldens/` or `conformance/`, Barkpark stays the source until its flip, nobody signs off their own journey, and owner sign-off stays with the owner.

**Stop early** if a document is lost or corrupted, or `main` fails `npm run check` for more than an hour.

**Judged by** the same score as barkever ([0038 there](https://github.com/FRIKKern/barkever/blob/main/docs/decisions/0038-review-trial.md)), plus an audit of a sample of `Trial: unreviewed` commits for missed bugs.
