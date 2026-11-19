// SPDX-License-Identifier: Apache-2.0
// What the commands share: option parsing, reading and parsing a doc, JSON and
// error lines for a terminal, and the React renderer for html.

import fs from 'node:fs';
import path from 'node:path';
import { parseJson } from './json.js';
import { shown } from './words.js';

/** A usage error: the CLI prints the message and the command's usage, and exits 2. */
export class UsageError extends Error {}

/**
 * Split a command's arguments into { files, opts }, or throw UsageError. `flags` maps each
 * flag to its option name, with a trailing "=" when the flag takes a value.
 */
export function parseArgs(flags, args) {
  const files = [];
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      for (const file of args.slice(i + 1)) files.push(file);
      break;
    }
    if (arg === '-' || !arg.startsWith('-')) {
      files.push(arg);
      continue;
    }
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const spec = Object.hasOwn(flags, flag) ? flags[flag] : undefined;
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

/** Read one input: { name, text } or { name, failure: { kind: 'read', message } }. */
export async function read(file, io) {
  const name = file === '-' ? '<stdin>' : shown(file);
  try {
    const text = file === '-' ? await io.readStdin() : fs.readFileSync(file, 'utf8');
    return { name, text: text.replace(/^﻿/, '') };
  } catch (error) {
    return { name, failure: { kind: 'read', message: error.code === 'ENOENT' ? 'no such file' : shown(error.message) } };
  }
}

/** Read and parse one input: { name, doc } or { name, failure: { kind, message, line?, column? } }. */
export async function load(file, io) {
  const input = await read(file, io);
  if (input.failure) return input;
  const { name, text } = input;
  const parsed = parseJson(text);
  if (parsed.ok) return { name, doc: parsed.value };
  const { line, column, message } = parsed;
  return { name, failure: { kind: 'json', message: `bad JSON${line ? ` at line ${line}, column ${column}` : ''}: ${shown(message)}`, line, column } };
}

// Pretty JSON safe for a terminal: JSON.stringify escapes C0 controls; DEL and
// C1 are escaped here, inside strings, the only place they occur.
export const jsonText = (value) => `${JSON.stringify(value, null, 2).replace(/[\u007f-\u009f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n`;

export const errorLine = (name, e) => `${name}: ${e.code} at ${shown(e.path) || '(root)'}: ${shown(e.message)}`;

// validate lists up to MAX_ERRORS errors; the rest are only counted.
export const moreLine = (file, more) => (more ? `${file}: ${more} more ${more === 1 ? 'error' : 'errors'}, not listed\n` : '');

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
export async function renderHtml(doc) {
  const missing = htmlMissing();
  if (missing) return { missing };
  const [react, fields, embeds] = await Promise.all([import('@portable-doc/react'), import('@portable-doc/react/field-blocks'), import('@portable-doc/react/embed')]);
  const blocks = Array.isArray(doc) ? doc : doc.blocks;
  const html = react.renderPortableDocument(blocks, { blocks: { ...fields.fieldBlocks, ...embeds.embedBlocks() } });
  return { html: `<div class="bp-paper-surface">${html}</div>\n` };
}

export const isRenderable = (doc) => Array.isArray(doc) || (typeof doc === 'object' && doc !== null && Array.isArray(doc.blocks));

// True when writing `output` would replace the file the doc was read from:
// the same device and inode, so any path, symlink or hard link to it counts.
// An output that does not exist yet cannot be the input.
export function sameFile(input, output) {
  if (input === '-') return false;
  try {
    const [a, b] = [input, output].map((f) => fs.statSync(f, { bigint: true }));
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return path.resolve(input) === path.resolve(output);
  }
}
