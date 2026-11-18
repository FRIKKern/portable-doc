# 0012 The sync writes packages/editor too

Date: 2026-11-18 · Status: accepted · Amends [0003](0003-pull-sync.md)

```
FRIKKern/barkpark main                     FRIKKern/portable-doc
api/priv/portable_doc/    ─┐               sync-from-barkpark.yml (same job, same run)
api/assets/paper-editor/  ─┼─ sparse ─►    check-pack --against: pack and editor same? ── yes ─► done
   git ls-files, minus     │  checkout          │ no
   what git ignores        │                    ▼
                           │               spec/ goldens/ conformance/  ◄─ rm + copy
                           │               packages/editor/             ◄─ rm + copy of tracked files
                           │               SOURCE.json: commit, files{}, editor{path, files{}}
                           └──────────────► one PR on sync/barkpark, merged by the job (0009, 0011)
```

## Context

The paper editor's home is Barkpark (`api/assets/paper-editor/`). Barkpark builds, tests and releases it as `@portable-doc/editor`. `packages/editor/` here was a copy made by hand, so it drifted: by 2026-11-18 it was ten days behind, with 17 files changed and 8 missing. It is not a workspace, and nothing here builds or tests it.

## Decision

- The sync job copies `packages/editor/` from Barkpark the way it copies the pack. It removes the folder and copies the files Barkpark's git tracks under `api/assets/paper-editor/`, minus any that Barkpark's `.gitignore` files match. Build output, `node_modules` and local leftovers never travel.
- Ignore rules come from the repo's own `.gitignore` files only. A global excludes file and `.git/info/exclude` are never read, so a local sync copies what CI copies. Here, the check counts every committed file, ignored or not, and skips untracked files git ignores (a `.DS_Store`, an `npm ci` in the folder); other untracked files count. Not at the top of a git work tree, every file on disk counts. Only regular files are allowed: the check names a symlink, file or directory, as an error, and the sync refuses one in Barkpark.
- The record is an `editor` section in `SOURCE.json`: `{ "path": "api/assets/paper-editor", "files": { "<path>": "<sha256>" } }`, with paths relative to `packages/editor/`. One run copies the pack and the editor from one Barkpark checkout, so the top-level `commit` holds for both. A second `SOURCE.json` inside `packages/editor/` would repeat that commit and would itself be a file Barkpark does not have.
- `npm run check` fails, naming the file, when a file under `packages/editor/` differs from its recorded sha256, when a recorded file is missing, or when a file is there that the sync did not write. It also fails when the section is missing, names another path, or is empty.
- `check-pack --against` also compares the editor with Barkpark, so a change to the editor alone opens the sync PR.
- The sync refuses, and copies nothing, when Barkpark tracks no files under the editor path or has no `package.json` there.
- The root test run (`scripts/test-files.mjs`) and `check-docs` leave `packages/editor/` out. Its tests need its own install, and its Markdown links are Barkpark's text, so neither can stop the sync here.

Fix the editor in Barkpark, never here: the next sync would undo a local edit, and the check fails until it does.

## Considered

- **`packages/editor/SOURCE.json`.** Rejected for the reasons above.
- **A git subtree of the editor folder.** Rejected for the reason 0003 gives: a person has to bump it.
