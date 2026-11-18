// SPDX-License-Identifier: Apache-2.0
// The `portable-doc` command: validate, explain and render PortableDoc files.

import fs from 'node:fs';
import path from 'node:path';
import { validate } from '@portable-doc/validate';
import { toMarkdown, toPlainText } from '@portable-doc/text';
import { parseJson } from './json.js';
import { explainError, refusedWhen, shown } from './words.js';

export const VERSION = JSON.parse(fs.readFileSync(new URL('package.json', import.meta.url), 'utf8')).version;

const USAGE = {
  main: `Usage: portable-doc <command> [options]

Commands:
  validate [file...]   check docs against the PortableDoc schema
  explain [file...]    the same, with each error explained in full
  render [file]        print a doc as html, markdown or text

A file of "-", or no file, reads stdin. A doc is a blocks array or { "blocks": [...] }.
Options: --help, --version. Run "portable-doc <command> --help" for its options.`,
  validate: `Usage: portable-doc validate [file...] [--json]

Prints one line per error: "file: code at /path: message".
  --json   print the results as JSON
Exit: 0 every doc is valid, 1 some doc is invalid, 2 usage error, unreadable file or bad JSON.`,
  explain: `Usage: portable-doc explain [file...] [--json]

Like validate, with where each error is, what is wrong and the rule it breaks.
  --json   print the results as JSON
Exit: 0 every doc is valid, 1 some doc is invalid, 2 usage error, unreadable file or bad JSON.`,
  render: `Usage: portable-doc render [file] [--format html|markdown|text] [-o out] [--force]

  --format <f>          html, markdown (the default) or text
  -o, --output <file>   write there instead of stdout ("-" is stdout); never the input file
  --force               render a doc that fails validation
Exit: 0 rendered, 1 the doc is invalid (without --force), 2 usage error, unreadable file, bad JSON,
or html asked for before @portable-doc/react is built.`,
};

const FLAGS = {
  validate: { '--json': 'json' },
  explain: { '--json': 'json' },
  render: { '--format': 'format=', '--output': 'output=', '-o': 'output=', '--force': 'force' },
};
const FORMATS = ['html', 'markdown', 'text'];

class UsageError extends Error {}

/** Split a command's arguments into { files, opts }, or throw UsageError. */
function parseArgs(command, args) {
  const files = [];
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      files.push(...args.slice(i + 1));
      break;
    }
    if (arg === '-' || !arg.startsWith('-')) {
      files.push(arg);
      continue;
    }
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const spec = FLAGS[command][flag];
    if (!spec) throw new UsageError(`unknown option ${shown(flag)}`);
    if (!spec.endsWith('=')) {
      if (inline !== undefined) throw new UsageError(`${flag} takes no value`);
      opts[spec] = true;
      continue;
    }
    const value = inline ?? args[++i];
    if (value === undefined || value === '' || (inline === undefined && value.startsWith('-') && value !== '-')) throw new UsageError(`${flag} needs a value`);
    opts[spec.slice(0, -1)] = value;
  }
  return { files, opts };
}

/** Read and parse one input: { name, doc } or { name, failure: { kind, message, line?, column? } }. */
async function load(file, io) {
  const name = file === '-' ? '<stdin>' : shown(file);
  let text;
  try {
    text = file === '-' ? await io.readStdin() : fs.readFileSync(file, 'utf8');
  } catch (error) {
    return { name, failure: { kind: 'read', message: error.code === 'ENOENT' ? 'no such file' : shown(error.message) } };
  }
  const parsed = parseJson(text.replace(/^﻿/, ''));
  if (parsed.ok) return { name, doc: parsed.value };
  const { line, column, message } = parsed;
  return { name, failure: { kind: 'json', message: `bad JSON${line ? ` at line ${line}, column ${column}` : ''}: ${shown(message)}`, line, column } };
}

const errorLine = (name, e) => `${name}: ${e.code} at ${shown(e.path) || '(root)'}: ${shown(e.message)}`;

async function check(command, files, opts, io) {
  const inputs = files.length ? files : ['-'];
  if (inputs.filter((f) => f === '-').length > 1) throw new UsageError('stdin can be read only once');
  if (!files.length && io.stdinIsTTY) throw new UsageError('give a file, or pipe a doc to stdin');
  const results = [];
  for (const file of inputs) {
    const input = await load(file, io);
    if (input.failure) {
      results.push({ file: input.name, ok: false, failure: input.failure });
      continue;
    }
    const result = validate(input.doc);
    const errors = result.ok ? [] : result.errors;
    results.push({ file: input.name, ok: result.ok, errors, doc: input.doc });
  }
  const code = results.some((r) => r.failure) ? 2 : results.every((r) => r.ok) ? 0 : 1;
  if (opts.json) {
    const files = results.map(({ file, ok, failure, errors, doc }) => {
      if (failure) return { file, ok, error: failure };
      const list = command === 'explain' ? errors.map((e) => ({ ...e, explanation: explainError(e, doc, String).join(' '), refusedWhen: refusedWhen(e.code) })) : errors;
      return { file, ok, errors: list };
    });
    // JSON.stringify escapes C0 controls; DEL and C1 are escaped here, inside strings, the only place they occur.
    const json = JSON.stringify({ ok: code === 0, files }, null, 2).replace(/[\u007f-\u009f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    io.stdout(`${json}\n`);
    return code;
  }
  for (const r of results) {
    if (r.failure) io.stderr(`${r.file}: ${r.failure.message}\n`);
    else if (command === 'validate') io.stdout(r.ok ? `${r.file}: ok\n` : r.errors.map((e) => `${errorLine(r.file, e)}\n`).join(''));
    else if (r.ok) io.stdout(`${r.file}: ok, nothing to explain\n`);
    else {
      const n = r.errors.length;
      const body = r.errors.map((e, i) => explainError(e, r.doc).map((l, j) => `${j ? '   ' : `${i + 1}. `}${l}`).join('\n')).join('\n\n');
      io.stdout(`${r.file}: ${n} ${n === 1 ? 'error' : 'errors'}\n\n${body}\n\n`);
    }
  }
  return code;
}

const resolves = (specifier) => {
  try {
    return Boolean(import.meta.resolve(specifier));
  } catch {
    return false;
  }
};

// Why html cannot load, or null when it can: react or the renderer not
// installed, or the renderer installed but not built.
function htmlMissing() {
  if (!resolves('react/jsx-runtime') || !resolves('@portable-doc/react/package.json')) return 'html needs react and @portable-doc/react installed; run "npm ci" in the repo';
  if (!resolves('@portable-doc/react') || !resolves('@portable-doc/react/field-blocks') || !resolves('@portable-doc/react/embed')) return 'html needs @portable-doc/react built; run "npm run react:build" in the repo';
  return null;
}

/** { html } or { missing }: why the React renderer cannot load. */
async function renderHtml(doc) {
  const missing = htmlMissing();
  if (missing) return { missing };
  const [react, fields, embeds] = await Promise.all([import('@portable-doc/react'), import('@portable-doc/react/field-blocks'), import('@portable-doc/react/embed')]);
  const blocks = Array.isArray(doc) ? doc : doc.blocks;
  const html = react.renderPortableDocument(blocks, { blocks: { ...fields.fieldBlocks, ...embeds.embedBlocks() } });
  return { html: `<div class="bp-paper-surface">${html}</div>\n` };
}

// True when writing `output` would replace the file the doc was read from:
// the same device and inode, so any path, symlink or hard link to it counts.
// An output that does not exist yet cannot be the input.
function sameFile(input, output) {
  if (input === '-') return false;
  try {
    const [a, b] = [input, output].map((f) => fs.statSync(f, { bigint: true }));
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return path.resolve(input) === path.resolve(output);
  }
}

async function render(files, opts, io) {
  if (files.length > 1) throw new UsageError('render takes one file');
  const format = opts.format ?? 'markdown';
  if (!FORMATS.includes(format)) throw new UsageError(`--format must be html, markdown or text, not "${shown(format)}"`);
  if (!files.length && io.stdinIsTTY) throw new UsageError('give a file, or pipe a doc to stdin');
  const output = opts.output === '-' ? undefined : opts.output;
  if (output !== undefined && sameFile(files[0] ?? '-', output)) throw new UsageError('-o would overwrite the input file');
  const input = await load(files[0] ?? '-', io);
  if (input.failure) return io.stderr(`${input.name}: ${input.failure.message}\n`), 2;
  const result = validate(input.doc);
  if (!result.ok) {
    io.stderr(result.errors.map((e) => `${errorLine(input.name, e)}\n`).join(''));
    if (!opts.force) return io.stderr(`${input.name}: not rendered, the doc is invalid (--force renders it anyway)\n`), 1;
  }
  let out;
  if (format === 'html') {
    const r = await renderHtml(isRenderable(input.doc) ? input.doc : []);
    if (r.missing) return io.stderr(`portable-doc: ${r.missing}\n`), 2;
    out = r.html;
  } else out = format === 'markdown' ? toMarkdown(input.doc) : toPlainText(input.doc);
  if (output === undefined) return io.stdout(out), 0;
  try {
    fs.writeFileSync(output, out);
  } catch (error) {
    return io.stderr(`${shown(output)}: cannot write: ${shown(error.message)}\n`), 2;
  }
  return 0;
}

const isRenderable = (doc) => Array.isArray(doc) || (typeof doc === 'object' && doc !== null && Array.isArray(doc.blocks));

/**
 * Run the command line. `io` is { stdout(text), stderr(text), readStdin(): Promise<string>, stdinIsTTY }.
 * Resolves to the exit code.
 */
export async function main(argv, io) {
  const [command, ...args] = argv;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    io[command === undefined ? 'stderr' : 'stdout'](`${USAGE.main}\n`);
    return command === undefined ? 2 : 0;
  }
  if (command === '--version' || command === '-v') return io.stdout(`${VERSION}\n`), 0;
  if (!Object.hasOwn(FLAGS, command)) {
    io.stderr(`portable-doc: unknown command "${shown(command)}"\n\n${USAGE.main}\n`);
    return 2;
  }
  if (args.includes('--help') || args.includes('-h')) return io.stdout(`${USAGE[command]}\n`), 0;
  try {
    const { files, opts } = parseArgs(command, args);
    return command === 'render' ? await render(files, opts, io) : await check(command, files, opts, io);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.stderr(`portable-doc ${command}: ${error.message}\n\n${USAGE[command]}\n`);
    return 2;
  }
}
