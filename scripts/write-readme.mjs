// Writes the alias rule into packages/text/README.md from its one source, the _comment of
// packages/text/alias-table.js, byte for byte between the README's two alias-rule markers.
// `node scripts/write-readme.mjs` writes it; write-readme.test.mjs checks the README is what it
// writes, and that every other copy of the sentence in the repo is byte-equal to the table's.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TABLE } from '../packages/text/alias-table.js';

export const README = fileURLToPath(new URL('../packages/text/README.md', import.meta.url));
export const START = '<!-- alias-rule:start -->';
export const END = '<!-- alias-rule:end -->';

// The sentence runs from its first words to the end of its last clause, both found once in the _comment.
const FIRST = 'For each field, read the names in order';
const LAST = 'a non-empty object holds a non-whitespace character.';

/** The rule sentence, cut from the table's _comment. */
export function ruleSentence(comment = TABLE._comment) {
  const from = comment.indexOf(FIRST);
  const to = comment.indexOf(LAST);
  if (from < 0 || to < from || comment.indexOf(FIRST, from + 1) >= 0 || comment.indexOf(LAST, to + 1) >= 0) {
    throw new Error(`alias-table.js _comment: the rule must run once from "${FIRST}" to "${LAST}"`);
  }
  return comment.slice(from, to + LAST.length);
}

/** `text` with the sentence written between the markers, on its own line at the markers' indent. */
export function withRule(text, sentence = ruleSentence()) {
  const from = text.indexOf(START);
  const to = text.indexOf(END);
  if (from < 0 || to < from || text.indexOf(START, from + 1) >= 0) throw new Error(`README: needs one ${START} before one ${END}`);
  const indent = text.slice(text.lastIndexOf('\n', from) + 1, from);
  return `${text.slice(0, from + START.length)}\n${indent}${sentence}\n${indent}${text.slice(to)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  fs.writeFileSync(README, withRule(fs.readFileSync(README, 'utf8')));
  console.log(`wrote the alias rule into ${path.relative(process.cwd(), README)}`);
}
