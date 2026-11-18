# @portable-doc/cli

The `portable-doc` command: check PortableDoc files against the schema, explain
what is wrong, render them as HTML, Markdown or plain text, preview one in
the browser as you edit it, and import Markdown. Plain JavaScript; it uses
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
  when that one is taken. `--port 0` always picks a free one. It answers
  `GET /`, `/paper-surface.css` and `/events` (the reload stream), with
  `127.0.0.1` or `localhost` as the host. Anything else is a 404.
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

`node --test packages/cli/cli.test.mjs packages/cli/preview.test.mjs` runs the bin against the fixtures and a live preview.
