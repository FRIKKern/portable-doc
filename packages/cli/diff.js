// SPDX-License-Identifier: Apache-2.0
// `portable-doc diff`: two docs compared block by block, as one line per block
// or as JSON. The comparison itself is in diff-core.js.

import fs from 'node:fs';
import { MAX_VALUE_DEPTH, walkDepth } from '@portable-doc/validate';
import { asDoc, diffDocs } from './diff-core.js';
import { parseJson } from './json.js';
import { shown } from './words.js';

export const DIFF_USAGE = `Usage: portable-doc diff <a.json> <b.json> [--json] [--color auto|always|never]
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
      files.push(...args.slice(i + 1));
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
export async function diff(args, io) {
  if (args.includes('--help') || args.includes('-h')) return io.stdout(`${DIFF_USAGE}\n`), 0;
  let files;
  let opts;
  try {
    ({ files, opts } = parse(args));
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    io.stderr(`portable-doc diff: ${error.message}\n\n${DIFF_USAGE}\n`);
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
