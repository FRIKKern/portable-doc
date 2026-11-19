// SPDX-License-Identifier: Apache-2.0
// `portable-doc validate`: check docs against the PortableDoc schema.

import { check } from '../check.js';
import { parseArgs } from '../shared.js';

export const order = 1;
export const synopsis = '[file...]';
export const summary = 'check docs against the PortableDoc schema';
export const usage = `Usage: portable-doc validate [file...] [--json]

Prints one line per error: "file: code at /path: message".
  --json   print the results as JSON
Exit: 0 every doc is valid, 1 some doc is invalid, 2 usage error, unreadable file or bad JSON.`;

const flags = { '--json': 'json' };

export async function run(args, io) {
  const { files, opts } = parseArgs(flags, args);
  return check('validate', files, opts, io);
}

export const readme = `## Validate

\`\`\`console
$ npx portable-doc validate notes.json broken.json
notes.json: ok
broken.json: unknown_block_type at /blocks/1/type: "nope" is not a PortableDoc block type
broken.json: value_not_allowed at /blocks/2/level: 9 is above 6
\`\`\`

One line per error: \`file: code at /path: message\`. The codes and their rules
are in [\`CODES.md\`](../validate/CODES.md). A doc lists at most
\`MAX_ERRORS\` (1,000) errors, then one line \`file: N more errors, not listed\`.
\`--json\` prints \`{ ok, files: [{ file, ok, errors | error, more }] }\` for
scripts, with \`more\` only when errors were left out.

Exit codes, the same for \`explain\`:

| Exit | When |
|---|---|
| 0 | every doc is valid |
| 1 | some doc is invalid |
| 2 | a usage error, a file that cannot be read, or bad JSON (with its line and column) |`;
