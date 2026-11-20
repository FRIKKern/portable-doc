// SPDX-License-Identifier: Apache-2.0
// The run schema-places.test.mjs pins: the readers (React HTML, Markdown, plain text) on every
// golden and writer-case block, measured by schema-places.mjs. Run directly with --write, it
// writes schema-places.json from that run:
//   node packages/text/schema-places-run.mjs --write
// (after `npm run react:build`). A row that leaves the list is deleted in the change that closes
// its gap; a row it adds is a new gap, for review.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderPortableDocument } from '@portable-doc/react';
import { goldenBlocks, writerCaseBlocks } from './golden-reads.mjs';
import { BLOCK_TYPES, toMarkdown, toPlainText } from './index.js';
import { places } from './schema-places.mjs';

export const PIN = new URL('./schema-places.json', import.meta.url);
export const RENDERS = { html: (blocks) => renderPortableDocument(blocks, {}), markdown: toMarkdown, text: toPlainText };

/** The pinned shape of a run: { counts, gaps, probed, oldNames }. `textAndBlocks` counts the gaps whose kind is more than other values. */
export function measure(cases = [...goldenBlocks(new Set(BLOCK_TYPES)), ...writerCaseBlocks(new Set(BLOCK_TYPES))], renders = RENDERS) {
  const got = places(cases, renders);
  const textAndBlocks = Object.values(got.gaps).filter((kind) => kind.split(' ').some((k) => k !== 'other')).length;
  return { counts: { gaps: Object.keys(got.gaps).length, textAndBlocks, probed: got.probed.length, oldNames: got.oldNames.length }, ...got };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--write')) {
  const run = measure();
  fs.writeFileSync(PIN, `${JSON.stringify(run, null, 2)}\n`);
  console.log(`wrote ${fileURLToPath(PIN)}: ${JSON.stringify(run.counts)}`);
}
