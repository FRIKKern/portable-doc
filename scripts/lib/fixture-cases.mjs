// SPDX-License-Identifier: Apache-2.0
// Every shared case in fixtures/, read from disk: one reader per folder, so a test that walks
// "every fixture case" reads them all the same way. A folder with no reader here, and not named
// in NOT_READ with why, throws; so does a folder that gives no case. The word test
// (packages/text/writers-keep-words.test.mjs) and the round-trip list-item walk
// (packages/text/round-trip-list-items.test.mjs) read through this.
import fs from 'node:fs';
import path from 'node:path';
import { validate } from '@portable-doc/validate';
import { fromMarkdown, readMarkdown } from '../../packages/text/index.js';
import { sharedCases } from '../write-shared-cases.mjs';

export const FIXTURES = new URL('../../fixtures/', import.meta.url);

/** The .json files of a folder under fixtures/, as [`fixtures/<dir>/<file>`, parsed]. */
export const json = (dir) =>
  fs.readdirSync(new URL(`${dir}/`, FIXTURES)).filter((f) => f.endsWith('.json')).sort().map((f) => [`fixtures/${dir}/${f}`, JSON.parse(fs.readFileSync(new URL(`${dir}/${f}`, FIXTURES), 'utf8'))]);

/** Folders whose cases are not read, each with why. */
export const NOT_READ = { broken: 'docs that fail validation; writers owe only a valid doc its words' };

/** Folders whose cases are Markdown a person writes, read by import: their blocks are what import makes. */
export const FROM_MARKDOWN = ['headings', 'list-split', 'nesting', 'text-work'];

const markdownCases = async (folder) => Object.entries((await import(new URL(`${folder}/cases.mjs`, FIXTURES).href)).CASES).map(([name, markdown]) => ({ name, blocks: readMarkdown(markdown).blocks }));

// Each folder's cases as { name, blocks, reads? }.
const READERS = {
  nesting: () => markdownCases('nesting'),
  headings: () => markdownCases('headings'),
  'list-split': () => markdownCases('list-split'),
  'text-work': async () => {
    const { CUT, CUT_GENERATED, MARKED_PARAGRAPH, SPLIT_ITEMS, WORK, WORK_GENERATED, markedParagraph, splitItems } = await import(new URL('text-work/cases.mjs', FIXTURES).href);
    // The 120,000-item and the 70,000-mark cases are read here at 1,000, their shapes checked
    // through every writer; the import tests read them at 20,000 on a small stack.
    const generated = { ...WORK_GENERATED, [SPLIT_ITEMS]: splitItems(1_000), [MARKED_PARAGRAPH]: markedParagraph(1_000) };
    const cut = [...Object.entries(CUT), [CUT_GENERATED.name, [CUT_GENERATED.markdown, CUT_GENERATED.limits]]];
    return [
      ...Object.entries({ ...WORK, ...generated }).map(([name, markdown]) => ({ name, blocks: readMarkdown(markdown).blocks })),
      ...cut.map(([name, [markdown, limits]]) => ({ name, blocks: readMarkdown(markdown, limits).blocks })),
    ];
  },
  'round-trip': () => Object.entries(JSON.parse(sharedCases()[path.posix.join('round-trip', 'round-trip-cases.json')])).map(([name, { markdown }]) => ({ name, blocks: fromMarkdown(markdown) })),
  valid: () => json('valid').map(([name, doc]) => ({ name, blocks: Array.isArray(doc) ? doc : doc.blocks })),
  writers: () => json('writers').map(([name, { blocks }]) => ({ name, blocks })),
  // An alias case's block holds a field under two names; `reads` names the one a reader takes.
  // A block that does not validate pins only the alias reader: writers owe a valid doc's words.
  aliases: () => json('aliases').filter(([, c]) => validate({ blocks: [c.block] }).ok).map(([name, { block, reads }]) => ({ name, blocks: [block], reads })),
};

/** Every shared case as { folder, name, blocks, reads? }, read from each folder under fixtures/. */
export async function fixtureCases() {
  const folders = fs.readdirSync(FIXTURES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const unread = folders.filter((f) => !(f in READERS) && !(f in NOT_READ));
  if (unread.length) throw new Error(`fixtures/: no reader for ${unread.join(', ')}; add one to scripts/lib/fixture-cases.mjs, or name it in NOT_READ with why`);
  const all = [];
  for (const folder of folders.filter((f) => f in READERS)) {
    const got = await READERS[folder]();
    if (!got.length) throw new Error(`fixtures/${folder}: no case read`);
    all.push(...got.map((c) => ({ folder, ...c })));
  }
  return all;
}
