# Contributing

```
bp task (one milestone step) ─► branch + PR here or in the app repo ─► checks green
        ▲                                                                   │
        └── close with evidence: sha, run, screenshot ◄── review by someone else
```

## How we work

- **Work is tracked in Barkpark**, under goal `task-88d88a6e15e5a2eb`. The Barkpark GitHub bridge mirrors it to [FRIKKern/barkpark#24888](https://github.com/FRIKKern/barkpark/issues/24888); the roadmap picture and the README timeline read from there.
- **One step per PR.** Name the step in the title: `R1.3: gen_spec writes blocks.schema.json`.
- **Steps that touch another repo** land there (Barkpark, Barkdown, Barkever, barkpark-studio) and link back to the step's task.
- **Every step has a rollback line** in its PR before it merges (Z5).
- **Evidence on close:** what ran, where to see it, screenshots for anything you can see.
- **`spec/`, `goldens/` and `conformance/` arrive only through `sync/barkpark` PRs.** Fix them in Barkpark; the hourly sync brings them here ([0003](docs/decisions/0003-pull-sync.md)).
- **No squash of history you didn't write.** The editor's history arrives at R5 with its original commits.

## Before you push

```sh
npm run check
```

## Decisions

A decision gets its own page in `docs/decisions/NNNN-title.md`. Pages are superseded by a new page, never edited.
