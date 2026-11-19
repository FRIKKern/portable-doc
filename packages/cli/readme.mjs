// SPDX-License-Identifier: Apache-2.0
// Writes the command sections of README.md, between the commands markers, from
// commands/*.js: a table of the commands, then each command's own section.
// `node packages/cli/readme.mjs` writes it; a test fails when README.md differs.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCommands } from './registry.js';

const FILE = new URL('README.md', import.meta.url);
const START = '<!-- commands:start -->';
const END = '<!-- commands:end -->';
const NOTE = '<!-- Built from commands/*.js by `node packages/cli/readme.mjs`; `npm run check` fails when this part is stale. -->';

const anchor = (title) => title.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');

/** README.md as the generator writes it today. */
export async function readme() {
  const text = fs.readFileSync(FILE, 'utf8');
  const count = (marker) => text.split(marker).length - 1;
  if (count(START) !== 1 || count(END) !== 1 || text.indexOf(START) > text.indexOf(END)) throw new Error(`README.md needs one ${START} and, after it, one ${END}`);
  const commands = [...(await loadCommands()).values()];
  const rows = commands.map((c) => `| [\`${c.name} ${c.synopsis}\`](#${anchor(c.readme.split('\n')[0].slice(3))}) | ${c.summary} |`);
  const block = [START, NOTE, '', '| Command | What it does |', '|---|---|', ...rows, '', commands.map((c) => c.readme).join('\n\n'), END].join('\n');
  return text.slice(0, text.indexOf(START)) + block + text.slice(text.indexOf(END) + END.length);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(FILE, await readme());
  console.log('wrote packages/cli/README.md');
}
