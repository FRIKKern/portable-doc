// SPDX-License-Identifier: Apache-2.0
// `portable-doc import`: turn a Markdown file into a doc.

import fs from 'node:fs';
import { fromMarkdown } from '@portable-doc/text';
import { UsageError, jsonText, parseArgs, read, sameFile } from '../shared.js';
import { shown } from '../words.js';

export const order = 6;
export const synopsis = '[file]';
export const summary = 'turn a Markdown file into a doc';
export const usage = `Usage: portable-doc import [file] [-o out] [--json]

Reads GFM Markdown and prints it as a doc, { "blocks": [...] }, that passes validate.
  -o, --output <file>   write there instead of stdout ("-" is stdout); never the input file
  --json                print { ok, file, doc } (with -o, { ok, file, output }), or { ok, file, error }
Exit: 0 imported, 2 usage error, unreadable file or a file that cannot be written.`;

const flags = { '--output': 'output=', '-o': 'output=', '--json': 'json' };

export async function run(args, io) {
  const { files, opts } = parseArgs(flags, args);
  if (files.length > 1) throw new UsageError('import takes one file');
  if (!files.length && io.stdinIsTTY) throw new UsageError('give a file, or pipe Markdown to stdin');
  const output = opts.output === '-' ? undefined : opts.output;
  if (output !== undefined && sameFile(files[0] ?? '-', output)) throw new UsageError('-o would overwrite the input file');
  const input = await read(files[0] ?? '-', io);
  const fail = (file, error) => {
    if (opts.json) io.stdout(jsonText({ ok: false, file, error }));
    else io.stderr(`${file}: ${error.message}\n`);
    return 2;
  };
  if (input.failure) return fail(input.name, input.failure);
  const doc = { blocks: fromMarkdown(input.text) };
  if (output !== undefined) {
    try {
      fs.writeFileSync(output, jsonText(doc));
    } catch (error) {
      return fail(shown(output), { kind: 'write', message: `cannot write: ${shown(error.message)}` });
    }
  }
  if (opts.json) io.stdout(jsonText({ ok: true, file: input.name, ...(output === undefined ? { doc } : { output: shown(output) }) }));
  else if (output === undefined) io.stdout(jsonText(doc));
  return 0;
}

export const readme = `## Import

\`\`\`console
$ npx portable-doc import notes.md -o notes.json
$ cat notes.md | npx portable-doc import > notes.json
\`\`\`

Reads GFM Markdown and writes a doc, \`{ "blocks": [...] }\`, as pretty JSON
that \`validate\` accepts. The rules, and what each Markdown form becomes, are
\`fromMarkdown\`'s in [\`@portable-doc/text\`](../text/README.md#from-markdown).
Any Markdown imports; the exit is 2 only for a usage error, a file that cannot
be read, or an output that cannot be written. \`-o\` works as in render.
\`--json\` prints \`{ ok, file, doc }\`, or \`{ ok, file, output }\` with \`-o\`,
and \`{ ok: false, file, error }\` when a file cannot be read or written.`;
