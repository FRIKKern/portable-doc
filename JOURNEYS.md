# Journeys

The spec of "works". Format journeys (F) pass on every renderer. Editor journeys (E) pass on every host page (layer 1) and in every real app (layer 2) before a release. Nobody signs off their own journey.

## Format

| Id | Milestone | Journey | Proof |
|---|---|---|---|
| F01 | R1 | Every renderer renders all 80 block types as the goldens say | conformance heatmap |
| F02 | R2 | A doc saved in any app opens unchanged in every other app | round-trip report |
| F03 | R4 | A broken doc is refused with the same reason by the JS validator, Elixir and MCP | reason table |
| F04 | R4 | AI writes 50 docs through MCP; none is invalid | run report |
| F05 | R6 | A new app renders a doc with one `npm i` and 10 lines | GIF |

## Editor

| Id | Milestone | Journey | Proof |
|---|---|---|---|
| E01 | R2 | Type a paragraph; it saves | GIF per app |
| E02 | R2 | Enter splits, Backspace merges, across blocks | GIF |
| E03 | R2 | Paste rich text, Markdown, a table; shape survives | before/after |
| E04 | R2 | Undo and redo across blocks and pastes | GIF |
| E05 | R2 | `[[link]]` typed, pasted, aliased; title stays live | GIF |
| E06 | R2 | Slash menu inserts every block type | screenshot grid |
| E07 | R2 | A remote edit arrives while I type; my keys win | two-window GIF |
| E08 | R2 | Offline, reconnect: pending edits flush, nothing lost | GIF + op log |
| E09 | R2 | Read = Edit: the same doc looks the same in reader and editor | heatmap |
| E10 | R2 | Phone width and dark mode | screenshot grid |
| E11 | R2 | Pickers: image, reference, card media (Studio hosts) | GIF |
| E12 | R3 | Upgrade with no downtime: a new version rolls out, old clients still save | replay report |
