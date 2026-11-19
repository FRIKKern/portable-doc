// SPDX-License-Identifier: Apache-2.0
// Writes the list of block types round-trip mode keeps into README.md, between the
// round-trip-types markers: the importer's fence types, and every other type with a form
// whose own Markdown reads back as it. Never typed by hand: `node packages/text/readme.mjs`
// writes it, and a test fails when README.md differs.

import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { allForms } from './block-forms.mjs';
import { FENCE_TYPES } from './from-markdown.js';
import { fromMarkdown, toMarkdown } from './index.js';

const FILE = new URL('README.md', import.meta.url);
const START = '<!-- round-trip-types:start -->';
const END = '<!-- round-trip-types:end -->';
const NOTE = '<!-- Built from the fence types and the forms that read back in their own Markdown by `node packages/text/readme.mjs`; `npm run check` fails when this part is stale. -->';

/** The types round-trip mode keeps: { fenced, ownOnly }, each sorted. */
export function keptTypes() {
  const own = new Set();
  for (const [name, block] of allForms()) {
    if (!name.includes(' in a ') && !FENCE_TYPES.has(block.type) && isDeepStrictEqual(fromMarkdown(toMarkdown([block])), [block])) own.add(block.type);
  }
  return { fenced: [...FENCE_TYPES].sort(), ownOnly: [...own].sort() };
}

const code = (types) => types.map((t) => `\`${t}\``).join(', ');

/** README.md as the generator writes it today. */
export function readme() {
  const text = fs.readFileSync(FILE, 'utf8');
  const count = (marker) => text.split(marker).length - 1;
  if (count(START) !== 1 || count(END) !== 1 || text.indexOf(START) > text.indexOf(END)) throw new Error(`README.md needs one ${START} and, after it, one ${END}`);
  const { fenced, ownOnly } = keptTypes();
  const block = [
    START,
    NOTE,
    'The round trip is lossless only for blocks of these types, and only where import accepts the block:',
    '',
    `- in their own Markdown or a portabledoc fence: ${code(fenced)};`,
    `- in their own Markdown only, for the forms that read back as themselves: ${ownOnly.length ? code(ownOnly) : 'none'}.`,
    END,
  ].join('\n');
  return text.slice(0, text.indexOf(START)) + block + text.slice(text.indexOf(END) + END.length);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(FILE, readme());
  console.log('wrote packages/text/README.md');
}
