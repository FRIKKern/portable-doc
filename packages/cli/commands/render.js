// SPDX-License-Identifier: Apache-2.0
// `portable-doc render`: print a doc as html, markdown or text.

import fs from 'node:fs';
import { toMarkdown, toPlainText } from '@portable-doc/text';
import { validate } from '@portable-doc/validate';
import { UsageError, errorLine, isRenderable, load, moreLine, parseArgs, renderHtml, sameFile } from '../shared.js';
import { shown } from '../words.js';

export const order = 3;
export const synopsis = '[file]';
export const summary = 'print a doc as html, markdown or text';
export const usage = `Usage: portable-doc render [file] [--format html|markdown|text] [--round-trip] [-o out] [--force]

  --format <f>          html, markdown (the default) or text
  --round-trip          markdown that import reads back as the same blocks; lists any it cannot keep
                        and says how many it kept
  -o, --output <file>   write there instead of stdout ("-" is stdout); never the input file
  --force               render a doc that fails validation
Exit: 0 rendered, 1 the doc is invalid (without --force), 2 usage error, unreadable file, bad JSON,
or html asked for before @portable-doc/react is built, 3 rendered with --round-trip but some blocks
not kept (listed on stderr).`;

const flags = { '--format': 'format=', '--round-trip': 'roundTrip', '--output': 'output=', '-o': 'output=', '--force': 'force' };
const FORMATS = ['html', 'markdown', 'text'];

export async function run(args, io) {
  const { files, opts } = parseArgs(flags, args);
  if (files.length > 1) throw new UsageError('render takes one file');
  const format = opts.format ?? 'markdown';
  if (!FORMATS.includes(format)) throw new UsageError(`--format must be html, markdown or text, not "${shown(format)}"`);
  if (opts.roundTrip && format !== 'markdown') throw new UsageError('--round-trip is for --format markdown');
  if (!files.length && io.stdinIsTTY) throw new UsageError('give a file, or pipe a doc to stdin');
  const output = opts.output === '-' ? undefined : opts.output;
  if (output !== undefined && sameFile(files[0] ?? '-', output)) throw new UsageError('-o would overwrite the input file');
  const input = await load(files[0] ?? '-', io);
  if (input.failure) return io.stderr(`${input.name}: ${input.failure.message}\n`), 2;
  const result = validate(input.doc);
  if (!result.ok) {
    io.stderr(result.errors.map((e) => `${errorLine(input.name, e)}\n`).join('') + moreLine(input.name, result.more));
    if (!opts.force) return io.stderr(`${input.name}: not rendered, the doc is invalid (--force renders it anyway)\n`), 1;
  }
  let out;
  let lost = null;
  if (format === 'html') {
    const r = await renderHtml(isRenderable(input.doc) ? input.doc : []);
    if (r.missing) return io.stderr(`portable-doc: ${r.missing}\n`), 2;
    out = r.html;
  } else if (opts.roundTrip) ({ markdown: out, lost } = toMarkdown(input.doc, { mode: 'round-trip' }));
  else out = format === 'markdown' ? toMarkdown(input.doc) : toPlainText(input.doc);
  // Round-trip mode always reports: each block it could not keep, then how many it kept; the exit says so too.
  const done = () => (lost === null ? 0 : (io.stderr(`${lost.map((l) => `${lostLine(input.name, l)}\n`).join('')}${keptLine(input.name, input.doc, lost)}\n`), lost.length ? 3 : 0));
  if (output === undefined) return io.stdout(out), done();
  try {
    fs.writeFileSync(output, out);
  } catch (error) {
    return io.stderr(`${shown(output)}: cannot write: ${shown(error.message)}\n`), 2;
  }
  return done();
}

const REASONS = {
  type: 'a portabledoc fence may not hold its type, or a block in it',
  address: 'it holds an address import does not allow',
  invalid: 'it does not validate',
  depth: 'it nests too deep',
  id: 'an earlier fence uses its id',
  count: 'a fence holds 1 to 50 blocks',
  changed: 'its fence reads back different',
  neighbours: 'the blocks around it change how it reads',
  'not-a-block': 'it is not a block',
};
const keptLine = (name, doc, lost) => {
  const total = (Array.isArray(doc) ? doc : doc !== null && typeof doc === 'object' && Array.isArray(doc.blocks) ? doc.blocks : []).length;
  const of = `${total - lost.length} of ${total} block${total === 1 ? '' : 's'}`;
  return lost.length ? `${name}: kept ${of}` : `${name}: kept every block, ${of}`;
};
const lostLine = (name, l) =>
  `${name}: ${l.path}${l.type === null ? '' : ` ${shown(l.type)}`}${l.id === null ? '' : ` id ${shown(l.id)}`}: not kept, written readably: ${REASONS[l.reason] ?? l.reason}`;

export const readme = `## Render

\`\`\`console
$ npx portable-doc render notes.json --format markdown -o notes.md
$ cat notes.json | npx portable-doc render --format text
\`\`\`

- \`--format markdown\` (the default) and \`--format text\` use \`@portable-doc/text\`.
- \`--format html\` prints the React renderer's markup inside
  \`<div class="bp-paper-surface">\`, with field and embed blocks on. Style it
  with \`@portable-doc/react/paper-surface.css\`. It loads the built package, so
  run \`npm run react:build\` once first; without it, or without \`react\`
  installed, the command exits 2 and says what to run.
- \`--round-trip\` writes Markdown that \`import\` reads back as the same blocks,
  for each block import accepts (the types are listed in the text package's
  README). Each block it cannot keep that way is written readably and listed on
  stderr with its path, type, id and reason, and the exit is then 3. stderr ends
  with \`kept N of M blocks\`, or \`kept every block, M of M blocks\`. No flag
  hides it.
- \`-o -\` writes to stdout. \`-o\` never replaces the input file, by any path,
  symlink or hard link to it.
- An invalid doc is not rendered: its errors go to stderr and the exit is 1.
  \`--force\` renders it anyway, after printing the errors.`;
