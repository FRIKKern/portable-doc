# AGENTS.md

Lead with a picture, then the fewest words that carry the point.

## Where things live

```
work + status ─► Barkpark tasks (bp)      goal: task-88d88a6e15e5a2eb, milestones R0–R7
plan + steps  ─► Paper /papers/portabledoc-plan
why           ─► docs/decisions/NNNN-*.md (supersede, never edit)
what "works"  ─► JOURNEYS.md (F01–F05, E01–E12)
how good      ─► QUALITY.md (the bar, Z1–Z10)
the format    ─► SPEC.md; until R4.2 the source is Barkpark api/lib/barkpark/portable_doc/
```

## Loop

1. `bp task next <worker>`, or claim the step you were given.
2. Work in a git worktree; the main checkout stays on `main`.
3. One step per branch, named in the commit: `R1.3: …`.
4. `npm run check` before every commit.
5. Close with evidence: what ran, where to see it, screenshots for anything visible.

## Rules

- **Unrun means unrun.** Never report a check you didn't run.
- **Nobody signs off their own journey.**
- **No skip-pass.** A check with nothing to check fails (Z8).
- **Barkpark stays the source** of each piece until its flip (Z9). Change it there first.
- **No secrets** in prompts, files or output. **Fixtures are synthetic.**
- **Ask before pushing** or anything destructive.
