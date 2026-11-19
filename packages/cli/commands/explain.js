// SPDX-License-Identifier: Apache-2.0
// `portable-doc explain`: validate, with each error explained in full.

import { check } from '../check.js';
import { parseArgs } from '../shared.js';

export const order = 2;
export const synopsis = '[file...]';
export const summary = 'the same, with each error explained in full';
export const usage = `Usage: portable-doc explain [file...] [--json]

Like validate, with where each error is, what is wrong and the rule it breaks.
  --json   print the results as JSON
Exit: 0 every doc is valid, 1 some doc is invalid, 2 usage error, unreadable file or bad JSON.`;

const flags = { '--json': 'json' };

export async function run(args, io) {
  const { files, opts } = parseArgs(flags, args);
  return check('explain', files, opts, io);
}

export const readme = `## Explain

\`\`\`console
$ npx portable-doc explain broken.json
broken.json: 2 errors

1. unknown_block_type at /blocks/1/type, in the nope block at /blocks/1
   "nope" is not a PortableDoc block type.
   Refused when a block's type is not in the schema's type enum.
...
\`\`\`

Each error gets the block it sits in, the validator's message and the rule it
breaks, from the "Refused when" column of \`CODES.md\`. \`--json\` adds
\`explanation\` and \`refusedWhen\` to each error; the doc's text in them is
escaped once, by JSON itself.`;
