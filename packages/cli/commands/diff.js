// SPDX-License-Identifier: Apache-2.0
// `portable-doc diff`: two docs compared block by block, as one line per block
// or as JSON. The comparison itself is in ../diff-core.js.

import fs from 'node:fs';
import { MAX_VALUE_DEPTH, walkDepth } from '@portable-doc/validate';
import { asDoc, diffDocs } from '../diff-core.js';
import { parseJson } from '../json.js';
import { shown } from '../words.js';

export const order = 4;
export const synopsis = '<a> <b>';
export const summary = 'compare two docs block by block';
export const usage = `Usage: portable-doc diff <a.json> <b.json> [--json] [--color auto|always|never]
       portable-doc diff --git <path> <old-file> <old-hex> <old-mode> <new-file> <new-hex> <new-mode>

Compares two docs block by block. One line per block that differs:
  + added   - removed   > moved   ~ changed
with a word diff ([-old-]{+new+}) inside changed text and "old → new" for other fields.
  --json            print the changes as JSON (never colored)
  --color <when>    auto (the default: only on a terminal), always or never
  --git             the seven arguments git passes an external diff driver; exits 0 when the docs differ
Exit: 0 the docs are the same, 1 they differ, 2 usage error, unreadable file, bad JSON or not a doc.`;

const COLORS = ['auto', 'always', 'never'];
const SGR = { '-': 31, '+': 32, '>': 36, '~': 33 };
const MAX_VALUE = 60;
const CONTEXT = 6;

class Refused extends Error {}

function parse(args) {
  const files = [];
  const opts = { color: 'auto' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      for (const file of args.slice(i + 1)) files.push(file);
      break;
    }
    if (arg === '-' || !arg.startsWith('-')) files.push(arg);
    else if (arg === '--json' || arg === '--git') opts[arg.slice(2)] = true;
    else if (arg === '--color' || arg.startsWith('--color=')) {
      const value = arg === '--color' ? args[++i] : arg.slice('--color='.length);
      if (!COLORS.includes(value)) throw new Refused(`--color must be auto, always or never, not "${shown(value ?? '')}"`);
      opts.color = value;
    } else throw new Refused(`unknown option ${shown(arg)}`);
  }
  if (opts.git ? files.length !== 7 && files.length !== 9 : files.length !== 2) throw new Refused(opts.git ? '--git takes the seven (or, for a rename, nine) arguments git passes' : 'give two files');
  if (files.filter((f) => f === '-').length > 1) throw new Refused('stdin can be read only once');
  return { files, opts };
}

/** { doc } or { error } for one side. git passes /dev/null for a side that does not exist: an empty doc. */
async function load(file, io, git) {
  if (git && file === '/dev/null') return { doc: { blocks: [], rest: {} } };
  let text;
  try {
    text = file === '-' ? await io.readStdin() : fs.readFileSync(file, 'utf8');
  } catch (error) {
    return { error: error.code === 'ENOENT' ? 'no such file' : shown(error.message) };
  }
  const parsed = parseJson(text.replace(/^﻿/, ''));
  if (!parsed.ok) return { error: `bad JSON${parsed.line ? ` at line ${parsed.line}, column ${parsed.column}` : ''}: ${shown(parsed.message)}` };
  // Counted as validate counts it, so a doc diff refuses is one validate refuses too.
  if (walkDepth(parsed.value) > MAX_VALUE_DEPTH) return { error: `nested deeper than ${MAX_VALUE_DEPTH} levels` };
  const doc = asDoc(parsed.value);
  return doc ? { doc } : { error: 'not a doc: give a blocks array or { "blocks": [...] }' };
}

const clip = (s) => (s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE)}…` : s);
// A string prints bare unless it would read as another JSON value ("2", "true", ""), then quoted.
const looksLikeJson = (s) => s === '' || parseJson(s).ok;
const value = (v) => (v === undefined ? '(none)' : shown(clip(typeof v === 'string' && !looksLikeJson(v) ? v : JSON.stringify(v))));

/** Long unchanged text keeps a few words next to each change. */
function context(text, first, last) {
  const t = text.match(/\s+|[^\s]+/g);
  const keep = CONTEXT * 2;
  if (t.length <= keep * 2 + 1) return text;
  const head = first ? '' : t.slice(0, keep).join('');
  const tail = last ? '' : t.slice(-keep).join('');
  return `${head}…${tail}`;
}

function fieldLine(f, paint) {
  const path = shown(f.path || '(value)');
  if (!f.words) return `${path}: ${value(f.from)} → ${value(f.to)}`;
  const parts = f.words.map((w, k) => {
    if (w.op === '=') return shown(context(w.text, k === 0, k === f.words.length - 1));
    return paint(w.op, w.op === '-' ? `[-${shown(w.text)}-]` : `{+${shown(w.text)}+}`);
  });
  return `${path}: ${parts.join('')}`;
}

function blockLine(c, paint) {
  if (c.kind === 'doc') return `${paint('~', '~')} doc: ${c.fields.map((f) => fieldLine(f, paint)).join('; ')}`;
  const at = c.kind === 'removed' ? c.from : c.to;
  const label = `${shown(c.type)} ${c.id === null ? `at [${at}]` : shown(c.id)}`;
  const fields = c.fields.map((f) => fieldLine(f, paint)).join('; ');
  switch (c.kind) {
    case 'added': return `${paint('+', '+')} ${shown(c.type)} ${c.id === null ? '' : `${shown(c.id)} `}at [${c.to}]`;
    case 'removed': return `${paint('-', '-')} ${shown(c.type)} ${c.id === null ? '' : `${shown(c.id)} `}at [${c.from}]`;
    case 'moved': return `${paint('>', '>')} ${label}: moved [${c.from}] → [${c.to}]${fields ? `; ${fields}` : ''}`;
    default: return `${paint('~', '~')} ${label}: ${fields}`;
  }
}

/** JSON.stringify escapes C0 controls; DEL and C1 are escaped here, as validate --json does. */
const json = (v) => JSON.stringify(v, null, 2).replace(/[\u007f-\u009f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** Run `portable-doc diff <args>`. Resolves to the exit code. */
export async function run(args, io) {
  let files;
  let opts;
  try {
    ({ files, opts } = parse(args));
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    io.stderr(`portable-doc diff: ${error.message}\n\n${usage}\n`);
    return 2;
  }
  const [oldFile, newFile] = opts.git ? [files[1], files[4]] : files;
  // git adds the new path and a rename message after the seven arguments for a renamed file.
  const names = opts.git ? [`a/${shown(files[0])}`, `b/${shown(files[7] ?? files[0])}`] : files.map((f) => (f === '-' ? '<stdin>' : shown(f)));
  const head = `${opts.git ? 'portable-doc diff ' : ''}${names[0]}${opts.git ? ' ' : ' → '}${names[1]}`;
  const sides = [await load(oldFile, io, opts.git), await load(newFile, io, opts.git)];
  const failed = sides.map((s, k) => s.error && `${names[k]}: ${s.error}`).filter(Boolean);
  // Under git, a side that cannot be read is reported in the diff, and git goes on to the next file.
  if (failed.length && opts.git) return io.stdout(failed.map((f) => `${head}: ${f}\n`).join('')), 0;
  if (failed.length) return io.stderr(failed.map((f) => `${f}\n`).join('')), 2;
  const result = diffDocs(sides[0].doc, sides[1].doc);
  const ok = result.equal ? 0 : 1;
  if (opts.json) return io.stdout(`${json({ equal: result.equal, from: names[0], to: names[1], summary: result.summary, changes: result.changes })}\n`), opts.git ? 0 : ok;
  const color = opts.color === 'always' || (opts.color === 'auto' && io.stdoutIsTTY && !process.env.NO_COLOR);
  const paint = (op, text) => (color ? `\u001b[${SGR[op]}m${text}\u001b[0m` : text);
  if (result.equal) {
    if (opts.git) io.stdout(`${head}: the same blocks; only the JSON layout differs\n`);
    return 0;
  }
  const s = result.summary;
  const lines = [`${head}: ${s.added} added, ${s.removed} removed, ${s.moved} moved, ${s.changed} changed`, ...result.changes.map((c) => blockLine(c, paint))];
  io.stdout(`${lines.join('\n')}\n`);
  return opts.git ? 0 : ok;
}

export const readme = `## Diff

\`\`\`console
$ npx portable-doc diff old.json new.json
old.json → new.json: 1 added, 0 removed, 1 moved, 2 changed
> paragraph m: moved [3] → [0]
~ heading h: level: 2 → 3
~ paragraph p1: text: The quick [-brown-]{+red+} fox jumps.
+ callout c at [4]
\`\`\`

The first line counts the changes. Then one line per block that differs: \`+\`
added, \`-\` removed, \`>\` moved, \`~\` changed, with the block's type and id, or
its position (\`paragraph at [2]\`, 0-based, in the new doc; in the old one for
a removed block) when it has no id. Text gets a word diff, \`[-old-]{+new+}\`,
with long unchanged runs cut to a few words around each change. Inline
\`content\` is compared as Markdown at the block's own \`content\`, so marks and
links show (\`**bold**\`, a Markdown link). Other fields show
\`path: old → new\`, with \`(none)\` for a side that does not have the field; a
\`null\` is a value, not an absent field. A string prints bare unless it would
read as another JSON value: \`"2"\` prints quoted, \`2\` does not. Changes to the
doc's own keys (\`title\`, …) come first, as \`~ doc:\`. Every string from a doc, and every file name, has its
control characters escaped, as in \`validate\`.

Color: \`--color auto\` (the default) colors only on a terminal, and not when
\`NO_COLOR\` is set; \`always\` and \`never\` force it. \`--json\` is never colored
and prints \`{ equal, from, to, summary: { added, removed, moved, changed },
changes }\`. Each change is \`{ kind, type, id, from, to, fields }\`: \`kind\` is
\`doc\`, \`added\`, \`removed\`, \`moved\` or \`changed\`; \`from\` and \`to\` are 0-based
positions or \`null\`; \`id\` is \`null\` without one. A field is \`{ path, words }\`
for text, with \`words\` a list of \`{ op: "=" | "-" | "+", text }\`, or
\`{ path, from, to }\`, with \`from\` or \`to\` left out for a side that lacks it.
A moved block that also changed is \`moved\` and carries its fields. The order
is stable: doc keys, then blocks by position.

Exit: 0 the docs are the same, 1 they differ, 2 a usage error, a file that
cannot be read, bad JSON, JSON nested deeper than \`MAX_VALUE_DEPTH\` (1,000)
levels of arrays and objects, counted as \`validate\` counts them, or JSON that
is not a doc. Docs that differ only in
key order or layout are the same.

How blocks are matched, so that a move never shows as a remove plus an add:

1. By \`id\`: a non-empty string id pairs the first block with it on each side.
2. The blocks left without an id (or with an id already taken on their side),
   in order: first with the first equal block, then with the most similar
   block of the same type that shares at least half its words. Scoring stops
   after a fixed amount of work (20 million pairs looked at and words
   compared), and blocks not reached by then show as removed and added.
3. A block with an id never pairs with one without, so a block that gains or
   changes its id shows as removed and added.
4. Of the pairs, the longest run that keeps its order stays in place; the
   others are moved. Nested blocks (\`blocks\`, \`children\`, \`items\`) are
   compared by position inside their block, as field changes.

### In git

Two ways, one per path. A textconv driver lets git's own line diff run on the
rendered text, and on the raw file when it does not parse:

\`\`\`sh
echo '*.pd.json diff=portable-doc-text' >> .gitattributes
git config diff.portable-doc-text.textconv "sh -c 'npx portable-doc render --format text --force \\"\\$1\\" 2>/dev/null || cat \\"\\$1\\"' -"
\`\`\`

An external diff driver prints this command's block diff instead:

\`\`\`sh
echo '*.pd.json diff=portable-doc' >> .gitattributes
git config diff.portable-doc.command 'npx portable-doc diff --git'
\`\`\`

git runs a driver command with seven arguments (\`path old-file old-hex
old-mode new-file new-hex new-mode\`, \`/dev/null\` for a side that does not
exist), and two more for a rename (\`new-path\` and git's rename message).
\`--git\` takes both forms and names the sides \`a/<path>\` and \`b/<new-path>\`.
It exits 0 when the docs differ, and also when a side cannot be read or is
not a doc, printing why in the diff, since git stops at a driver that exits
non-zero. \`git diff\` uses the driver; \`git log -p\` and \`git show\` need
\`--ext-diff\`.`;
