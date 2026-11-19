// SPDX-License-Identifier: Apache-2.0
// The inputs of the shared text-work cases: the text each case reads, and for a cut case its
// limits. scripts/write-shared-cases.mjs reads them with @portable-doc/text and writes
// work-cases.json and cut-cases.json; the outputs are not kept in the repository.

import { CASES as HOSTILE } from '../../packages/text/import-work-cases.mjs';

const X = (n, c = 'x') => c.repeat(n);
const lines = (n, line) => Array.from({ length: n }, (_, i) => line(i)).join('\n');
const BUDGET = 16_000_000;
const LINE = { budget: BUDGET, lineBytes: 40 };
const NO_LINE = { budget: BUDGET, lineBytes: null };

/** Work cases kept from the first shared file: name → text. */
export const FIRST = {
  'lazy lines under a deep quote': `${X(300, '> ')}l0\n${lines(200, (i) => `l${i + 1}`)}`,
  'quoted lines under a deep quote': `${X(300, '> ')}l0\n${lines(200, (i) => `> l${i + 1}`)}`,
  'lazy lines under quote markers with no spaces': `${X(300, '>')}l0${X(200, '\nlxxxxxxxxxxxxxxx')}`,
  'quote markers with no spaces on every line': X(40, `${X(150, '>')}x\n`),
  'empty list items': `${X(50, '-\n')}${X(20, ' ')}x\n${X(50, '1.\n')}`,
  'wide content columns': lines(60, (i) => `${X(i * 5, ' ')}-    x${i}\n\n${X(i * 5 + 5, ' ')}more`),
};

/** The work cases: name → text. Every hostile case of the import-work test, and the first file's own. */
export const WORK = { ...FIRST, ...HOSTILE };

// Texts too big to store, each named by how it is built; the files give their counts only.
const upTo = (head, line) => {
  let s = head;
  for (let i = 1; s.length < 500_000; i++) s += line(i);
  return s;
};
/** The work cases given by their generator only: name → text. */
export const WORK_GENERATED = {
  "'> ' x 300 + 'l0', then '\\n> l' + i for i = 1, 2, … until 500,000 characters": upTo(`${X(300, '> ')}l0`, (i) => `\n> l${i}`),
  "'> ' x 300 + 'l0', then '\\nl' + i for i = 1, 2, … until 500,000 characters (lazy lines)": upTo(`${X(300, '> ')}l0`, (i) => `\nl${i}`),
  "'- ' x 250,000 + 'end' (one line)": `${X(250_000, '- ')}end`,
};

/** The cut cases: name → [text, limits], read by readMarkdown with those limits. */
export const CUT = {
  'line: at the bound': [X(40), LINE],
  'line: one byte over': [X(41), LINE],
  'line: inside a quote': [`> a\n> ${X(41)}\n> b`, LINE],
  'line: inside a list item': [`- a\n  ${X(41)}\n- b`, LINE],
  'line: a table row': [`| a | b |\n| - | - |\n| 1 | 2 |\n| ${X(41)} |\n| 3 | 4 |`, LINE],
  'line: under a paragraph, as a setext underline': [`Title\n${X(41, '=')}`, LINE],
  'line: a link reference definition': [`[ref]: https://example.com/${X(30)}\n\nsee [ref]`, LINE],
  'line: three long lines, one notice': [`${X(41)}\n${X(41, 'y')}\nok\n${X(41, 'z')}`, LINE],
  'line: inside a fence': [`\`\`\`js\nconst a = 1;\n${X(41, 'y')}\nconst b = 2;\n\`\`\`\nafter`, LINE],
  'line: a long fence opener opens nothing': [`\`\`\`${X(41)}\n**a**\nafter`, LINE],
  'line: inside a quoted fence': [`> \`\`\`js\n> one\n> ${X(41)}\n> two\n> \`\`\`\nafter`, LINE],
  'line: inside a list-item fence': [`- \`\`\`js\n  one\n  ${X(41)}\n  two\n  \`\`\`\n- b`, LINE],
  'line: after a fence its quote closed': [`> \`\`\`\n> code\nplain\n${X(41)}\nmore`, LINE],
  'budget: deep list items, then b0, then a deep quote': [`${lines(120, (i) => `${X(300, '- ')}a${i}`)}\n\nb0\n\n${X(300, '> ')}c0`, NO_LINE],
  'budget: lone carriage returns under deep quotes': [`x\r${X(200, `${X(200, '> ')}y\r`)}`, NO_LINE],
  'budget: lone carriage returns under deep list items': [`x\r${X(200, `${X(200, '- ')}y\r`)}`, NO_LINE],
  'budget: a carriage return inside each list prefix': [X(100, `${X(10, '- \r- ')}y\n`), NO_LINE],
  'line: lone carriage returns end lines for the line rule': [`short\r${X(41)}\rafter`, LINE],
  'budget: NULs read as U+FFFD': ['> > a\0b', NO_LINE],
};

/** The cut case given by its generator only: its paragraph is described, not stored. */
export const CUT_GENERATED = {
  name: "budget: '- ' x 100,000 + a0, then b0, then '> ' x 300 + c0 (markdown as generator text)",
  generator: "'- '.repeat(100000) + 'a0\\n\\nb0\\n\\n' + '> '.repeat(300) + 'c0'",
  markdown: `${X(100_000, '- ')}a0\n\nb0\n\n${X(300, '> ')}c0`,
  paragraph: '(- x100000) a0 b0 (> x300) c0, whitespace collapsed',
  limits: NO_LINE,
};
