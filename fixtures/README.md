# Fixtures

Cases that this repository and Barkpark are both tested against. This
folder is the one home of these cases. A project that uses them copies them by
script and records the portable-doc commit it copied; a hand-edited copy is not
a copy.

| Folder | A case file | Read here by | Read in Barkpark by |
|---|---|---|---|
| `broken/` | one doc and the codes and paths validation reports for it | `packages/validate` | the doc validator |
| `valid/` | one doc that must pass validation | `packages/validate`, `packages/text` | the doc validator |
| `nesting/` | `{ markdown, blocks }`: `fromMarkdown(markdown)` gives `blocks` | `packages/text/shared-cases.test.mjs` | the Markdown importer |
| `headings/` | `{ markdown, blocks }`: `fromMarkdown(markdown)` gives `blocks` | `packages/text/shared-cases.test.mjs` | the Markdown importer |
| `aliases/` | `{ block, reads }`: each field name read on `block` gives its value, `null` for none | `packages/text/shared-cases.test.mjs` | the alias reader |
| `text-work/` | inputs and rules only; see its README | `packages/text/shared-cases.test.mjs` | the import's work count and cuts |
| `round-trip/` | nothing kept; see its README | `packages/text/shared-cases.test.mjs` | the Markdown importer |

The case files in `nesting/`, `headings/`, `text-work/` and `round-trip/` are generated:
`node scripts/write-shared-cases.mjs` rewrites them from their inputs with this
checkout's `@portable-doc/text`. A generated file over 64 kB is not kept in the
repository; `node scripts/write-shared-cases.mjs <dir>` writes every file, the
big ones too, under `<dir>`, and that is what the copy for Barkpark runs. The
test fails when a kept file is not what the script writes, so a case and the
code cannot drift apart. No package packs this folder.
