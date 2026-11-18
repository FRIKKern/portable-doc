# @portable-doc/cli

The `portable-doc` command: check PortableDoc files against the schema, explain
what is wrong, and render them as HTML, Markdown or plain text. Plain
JavaScript; it uses [`@portable-doc/validate`](../validate/CODES.md),
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
- `-o -` writes to stdout. `-o` never replaces the input file.
- An invalid doc is not rendered: its errors go to stderr and the exit is 1.
  `--force` renders it anyway, after printing the errors.

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

`node --test packages/cli/cli.test.mjs` runs the bin against the fixtures.
