[![PortableDoc roadmap: milestones R0 to R7, each with the reward it ships and its status on the board](docs/images/roadmap.svg)](docs/ROADMAP.md)

## Vision

One document format for every Barkpark app. A Paper, a Barkdown note or a
Barkever note is written once and reads and edits the same everywhere: Barkpark
Studio, the web, Barkdown, Barkever, barkpark-studio and the phone.

Today the format's rules live inside [Barkpark](https://github.com/FRIKKern/barkpark)
and are rendered in eight places that drift apart. This repo becomes their one
home: the spec, the goldens every renderer must pass, the edit ops, the editor and
the JS renderers. They move here one reward at a time, with no downtime
([0001](docs/decisions/0001-one-home.md)).

![Today: eight renderers drift apart inside Barkpark and three apps. Target: portable-doc holds spec, goldens, ops, editor and packages; every app pins a version and passes the goldens](docs/images/today-vs-target.svg)

## What we get

| Reward | Milestone |
|---|---|
| A change is proven in every app in minutes | R2 |
| A doc looks the same everywhere: one heatmap, all green | R1 → R6 |
| No app breaks by surprise: each pins a version it tested | R3 |
| AI and apps can't save a broken doc | R4 |
| The editor is fast to work on, in its own repo | R5 |
| A new app is one `npm i` | R6 |
| A public docs site and playground | R7 |

## What happened

<!-- timeline:start -->
- **Today** · 3 milestones closed
  - Delivered: [R2.1 Contract truth: every editor member any app uses is declared in EMBED-CONTRACT.md and index.d.ts, with EDITOR_VERSION + sha](https://github.com/FRIKKern/barkpark/issues/24948)
- **Yesterday** · 3 changes, 5 milestones closed
  - Delivered: [R1.5 Sync: Barkpark opens a PR to portable-doc with spec/ and goldens/ when the stamp changes; portable-doc fails on a stale stamp](https://github.com/FRIKKern/barkpark/issues/24945)
<!-- timeline:end -->

## Where things live (one fact, one home)

| What | Where |
|---|---|
| Why, plan, steps, rules Z1–Z10 | Paper [`portabledoc-plan`](https://guerrilla.barkpark.cloud/papers/portabledoc-plan) |
| Milestones | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| The journeys (the spec of "works") | [`JOURNEYS.md`](JOURNEYS.md) |
| The format spec | [`SPEC.md`](SPEC.md) |
| The spec, as JSON Schema (synced from Barkpark, never edited here) | [`spec/`](spec/), source in [`SOURCE.json`](SOURCE.json) ([0003](docs/decisions/0003-pull-sync.md)) |
| The goldens every renderer must pass, stamped (synced the same way) | [`goldens/`](goldens/) |
| The doc validator and its reason codes; broken and valid fixtures. Report-only: nothing calls it yet | [`packages/validate/`](packages/validate/CODES.md), [`fixtures/`](fixtures/) ([0004](docs/decisions/0004-validate.md)) |
| The quality bar | [`QUALITY.md`](QUALITY.md) |
| How we work | [`CONTRIBUTING.md`](CONTRIBUTING.md), [`AGENTS.md`](AGENTS.md) |
| Decisions | [`docs/decisions/`](docs/decisions/), one page each |
| What the move touches, in numbers | [`docs/SCOPE.md`](docs/SCOPE.md) |
| Status, who does what | Barkpark tasks under goal `task-88d88a6e15e5a2eb`, mirrored to [FRIKKern/barkpark#24888](https://github.com/FRIKKern/barkpark/issues/24888) and the [PortableDoc board](https://github.com/users/FRIKKern/projects/3). Never in docs |
| License (Apache-2.0); ported code | [`LICENSE`](LICENSE); [`THIRD-PARTY.md`](THIRD-PARTY.md) |
| The old 10-type version | tag [`legacy-v0.4`](https://github.com/FRIKKern/portable-doc/tree/legacy-v0.4) ([0002](docs/decisions/0002-reuse-this-repo.md)) |

## Run it

```sh
npm run roadmap    # redraw docs/images/roadmap.svg from the board
npm run timeline   # rewrite the timeline above
npm run sync -- ../barkpark   # copy spec/ and goldens/ from a Barkpark checkout
npm run check      # doc rules, pack stamp and SOURCE.json, tests
```

The editor, the workbench and the host pages arrive with R2 and R5.
