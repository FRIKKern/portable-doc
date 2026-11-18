# @portable-doc/cli

The `portable-doc` command: check PortableDoc files against the schema, explain
what is wrong, render them as HTML, Markdown or plain text, compare two of
them block by block, preview one in the browser as you edit it, and import
Markdown. Plain JavaScript; it uses
[`@portable-doc/validate`](../validate/CODES.md),
[`@portable-doc/text`](../text/README.md) and, for HTML,
[`@portable-doc/react`](../react/README.md).

Not yet on npm. Inside this repo, after `npm ci`, run it as `npx portable-doc`.

A file can be a blocks array or `{ "blocks": [...] }`. A file of `-`, or no
file at all, reads stdin.

## Validate

```console
$ npx portable-doc validate notes.json broken.json
notes.json: ok
broken.json: unknown_block_type at /blocks/1/type: "nope" is not a PortableDoc block type
broken.json: value_not_allowed at /blocks/2/level: 9 is above 6
```

One line per error: `file: code at /path: message`. The codes and their rules
are in [`CODES.md`](../validate/CODES.md). `--json` prints
`{ ok, files: [{ file, ok, errors | error }] }` for scripts.

Exit codes, the same for `explain`:

| Exit | When |
|---|---|
| 0 | every doc is valid |
| 1 | some doc is invalid |
| 2 | a usage error, a file that cannot be read, or bad JSON (with its line and column) |

## Explain

```console
$ npx portable-doc explain broken.json
broken.json: 2 errors

1. unknown_block_type at /blocks/1/type, in the nope block at /blocks/1
   "nope" is not a PortableDoc block type.
   Refused when a block's type is not in the schema's type enum.
...
```

Each error gets the block it sits in, the validator's message and the rule it
breaks, from the "Refused when" column of `CODES.md`. `--json` adds
`explanation` and `refusedWhen` to each error; the doc's text in them is
escaped once, by JSON itself.

## Render

```console
$ npx portable-doc render notes.json --format markdown -o notes.md
$ cat notes.json | npx portable-doc render --format text
```

- `--format markdown` (the default) and `--format text` use `@portable-doc/text`.
- `--format html` prints the React renderer's markup inside
  `<div class="bp-paper-surface">`, with field and embed blocks on. Style it
  with `@portable-doc/react/paper-surface.css`. It loads the built package, so
  run `npm run react:build` once first; without it, or without `react`
  installed, the command exits 2 and says what to run.
- `-o -` writes to stdout. `-o` never replaces the input file, by any path,
  symlink or hard link to it.
- An invalid doc is not rendered: its errors go to stderr and the exit is 1.
  `--force` renders it anyway, after printing the errors.

## Diff

```console
$ npx portable-doc diff old.json new.json
old.json → new.json: 1 added, 0 removed, 1 moved, 2 changed
> paragraph m: moved [3] → [0]
~ heading h: level: 2 → 3
~ paragraph p1: text: The quick [-brown-]{+red+} fox jumps.
+ callout c at [4]
```

The first line counts the changes. Then one line per block that differs: `+`
added, `-` removed, `>` moved, `~` changed, with the block's type and id, or
its position (`paragraph at [2]`, 0-based, in the new doc; in the old one for
a removed block) when it has no id. Text gets a word diff, `[-old-]{+new+}`,
with long unchanged runs cut to a few words around each change. Inline
`content` is compared as Markdown, so marks and links show (`**bold**`, a
Markdown link). Other fields show `path: old → new`, with `(none)` for a side
that does not have the field. A string prints bare unless it would read as
another JSON value: `"2"` prints quoted, `2` does not. Changes to the doc's own keys (`title`, …) come
first, as `~ doc:`. Every string from a doc, and every file name, has its
control characters escaped, as in `validate`.

Color: `--color auto` (the default) colors only on a terminal, and not when
`NO_COLOR` is set; `always` and `never` force it. `--json` is never colored
and prints `{ equal, from, to, summary: { added, removed, moved, changed },
changes }`. Each change is `{ kind, type, id, from, to, fields }`: `kind` is
`doc`, `added`, `removed`, `moved` or `changed`; `from` and `to` are 0-based
positions or `null`; `id` is `null` without one. A field is `{ path, words }`
for text, with `words` a list of `{ op: "=" | "-" | "+", text }`, or
`{ path, from, to }`, with `from` or `to` left out for a side that lacks it.
A moved block that also changed is `moved` and carries its fields. The order
is stable: doc keys, then blocks by position.

Exit: 0 the docs are the same, 1 they differ, 2 a usage error, a file that
cannot be read, bad JSON, JSON nested deeper than `MAX_VALUE_DEPTH` (1,000)
levels of arrays and objects, counted as `validate` counts them, or JSON that
is not a doc. Docs that differ only in
key order or layout are the same.

How blocks are matched, so that a move never shows as a remove plus an add:

1. By `id`: a non-empty string id pairs the first block with it on each side.
2. The blocks left without an id (or with an id already taken on their side),
   in order: first with the first equal block, then with the most similar
   block of the same type that shares at least half its words. Scoring stops
   after a fixed amount of work (20 million pairs looked at and words
   compared), and blocks not reached by then show as removed and added.
3. A block with an id never pairs with one without, so a block that gains or
   changes its id shows as removed and added.
4. Of the pairs, the longest run that keeps its order stays in place; the
   others are moved. Nested blocks (`blocks`, `children`, `items`) are
   compared by position inside their block, as field changes.

### In git

Two ways, one per path. A textconv driver lets git's own line diff run on the
rendered text, and on the raw file when it does not parse:

```sh
echo '*.pd.json diff=portable-doc-text' >> .gitattributes
git config diff.portable-doc-text.textconv "sh -c 'npx portable-doc render --format text --force \"\$1\" 2>/dev/null || cat \"\$1\"' -"
```

An external diff driver prints this command's block diff instead:

```sh
echo '*.pd.json diff=portable-doc' >> .gitattributes
git config diff.portable-doc.command 'npx portable-doc diff --git'
```

git runs a driver command with seven arguments (`path old-file old-hex
old-mode new-file new-hex new-mode`, `/dev/null` for a side that does not
exist), and two more for a rename (`new-path` and git's rename message).
`--git` takes both forms and names the sides `a/<path>` and `b/<new-path>`.
It exits 0 when the docs differ, and also when a side cannot be read or is
not a doc, printing why in the diff, since git stops at a driver that exits
non-zero. `git diff` uses the driver; `git log -p` and `git show` need
`--ext-diff`.

## Preview

```console
$ npx portable-doc preview notes.json --open
Previewing notes.json at http://127.0.0.1:4317/ (Ctrl-C stops)
```

- The page is the doc as `render --format html` makes it, styled with
  `@portable-doc/react/paper-surface.css`. That stylesheet is read from the
  built package, so run `npm run react:build` once first, as for html. Light
  and dark follow the system.
- Save the file and the page reloads by itself, also when the editor saves by
  renaming a new file over the old one.
- A doc with bad JSON or validation errors shows its problems, in the words
  `explain` uses, above the last version that rendered.
- The server listens on 127.0.0.1 only, on port 4317, or on any free port
  when that one is taken. `--port 0` always picks a free one. It answers GET
  and HEAD for `/`, `/paper-surface.css` and `/events` (the reload stream, GET
  only), with `127.0.0.1` or `localhost` as the host. Anything else is a 404.
  No other site may frame the page.
- If the file can no longer be watched, the page says so above the last
  render, and the server keeps running.
- `--open` opens the page with `open` (macOS) or `xdg-open`. Ctrl-C closes the
  watcher and every connection, and exits 0.

## Import

```console
$ npx portable-doc import notes.md -o notes.json
$ cat notes.md | npx portable-doc import > notes.json
```

Reads GFM Markdown and writes a doc, `{ "blocks": [...] }`, as pretty JSON
that `validate` accepts. The rules, and what each Markdown form becomes, are
`fromMarkdown`'s in [`@portable-doc/text`](../text/README.md#from-markdown).
Any Markdown imports; the exit is 2 only for a usage error, a file that cannot
be read, or an output that cannot be written. `-o` works as in render.
`--json` prints `{ ok, file, doc }`, or `{ ok, file, output }` with `-o`,
and `{ ok: false, file, error }` when a file cannot be read or written.

## In a pre-commit hook or CI

```sh
#!/bin/sh
# .git/hooks/pre-commit: refuse a commit with an invalid doc in it.
# -z and xargs -0 keep any file name whole; -r skips the run when no doc is staged.
git diff --cached --name-only --diff-filter=ACM -z -- 'docs/*.json' |
  xargs -0 -r npx portable-doc validate --
```

```yaml
# a CI step
- run: npm ci
- run: npx portable-doc validate --json -- content/*.json > validate.json
```

`node --test packages/cli/*.test.mjs` runs the bin against the fixtures and a live preview.
