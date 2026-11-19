# Fixtures

Cases that any reader or writer of Portable Doc can be tested against. This
repository's tests read every one. This folder is the one home of these cases.
A project that uses them copies them by script and records the portable-doc
commit it copied; a hand-edited copy is not a copy.

| Folder | A case file |
|---|---|
| `broken/` | one doc and the codes and paths validation reports for it |
| `valid/` | one doc that must pass validation |
| `nesting/` | `{ markdown, blocks }`: `fromMarkdown(markdown)` gives `blocks` |
| `headings/` | `{ markdown, blocks }`: `fromMarkdown(markdown)` gives `blocks` |
| `aliases/` | `{ block, reads }`: each field name read on `block` gives its value, `null` for none |
| `text-work/` | inputs and rules only; see its README |
| `round-trip/` | nothing kept; see its README |
| `writers/` | `{ blocks, markdown, text, html }`: each writer's output, pinned byte for byte; see its README |

The case files in `nesting/`, `headings/`, `text-work/` and `round-trip/` are generated:
`node scripts/write-shared-cases.mjs` rewrites them from their inputs with this
checkout's `@portable-doc/text`. A generated file over 64 kB is not kept in the
repository; `node scripts/write-shared-cases.mjs <dir>` writes every file, the
big ones too, under `<dir>`, and that is what a copy runs. The
test fails when a kept file is not what the script writes, so a case and the
code cannot drift apart. No package packs this folder.
