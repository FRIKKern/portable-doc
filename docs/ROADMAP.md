# Roadmap

[![PortableDoc roadmap](images/roadmap.svg)](../README.md)

Every milestone ships a reward you can see (rule Z10). Steps, sizes and rollbacks live in the Paper [`portabledoc-plan`](https://guerrilla.barkpark.cloud/papers/portabledoc-plan); status lives on the board (goal [FRIKKern/barkpark#24888](https://github.com/FRIKKern/barkpark/issues/24888)). This page is the list `scripts/generate-roadmap.mjs` draws.

```
R0 Kickoff ─► R1 See the drift ─┬─► R2 Safe editing ─► R3 No surprise breaks ─┬─► R5 Editor moves home ─► ◆ flip ─┐
                                │        └─► ✎ editor upgrades, every week     │                                 ├─► R7 Public
                                └─► R4 AI-proof docs ──────────────────────────┴─► R6 One-line adoption ─────────┘
```

| Id | Milestone | Reward | Done when |
|---|---|---|---|
| R0 | Kickoff | You can see the project | README shows the roadmap, the board lists R0–R7, today's editor is screenshotted in all 5 apps |
| R1 | See the drift | One heatmap of where the renderers disagree | Every renderer has a heatmap row from a real run, none skip-passes |
| R2 | Safe editing | Editor changes proven in all 5 apps | 7 host pages and 5 host profiles green; editor upgrades start |
| R3 | No surprise breaks | Every app pins a version it tested | `@portable-doc/editor` on npm; 5 apps pinned and green |
| R4 | AI-proof docs | Broken docs can't be saved | The schema here is the source; F03 and F04 pass |
| R5 | Editor moves home | Fast editor work in its own repo | First release from here lands in every app; no file over 800 lines |
| R6 | One-line adoption | One `npm i`, the heatmap all green | 3 look-alike renderers deleted; F05 recorded |
| R7 | Public | Docs site and playground | Both live and linked from the README |
