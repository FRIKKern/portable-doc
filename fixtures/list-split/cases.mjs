// SPDX-License-Identifier: Apache-2.0
// The inputs of the list-split cases: name → Markdown. scripts/write-shared-cases.mjs reads each
// with readMarkdown and writes <name>.json as { markdown, blocks, notices }.

// One item `depth` lists down (each item in the one before): text, a nested list two deep, then
// more text after the nested list.
const deep = (depth) => {
  const lines = [];
  for (let i = 0; i < depth; i++) lines.push(`${'  '.repeat(i)}- d${i}`);
  lines.push(`${'  '.repeat(depth)}- w0`, `${'  '.repeat(depth + 1)}- w1`, `${'  '.repeat(depth + 2)}- w2`, '', `${'  '.repeat(depth + 1)}w3 after the nested list`);
  return lines.join('\n');
};

export const CASES = {
  'list-item-text-after-nested-list': '- w0\n  - w1\n    - w2\n\n  w3 after the nested list',
  'list-item-text-around-nested-list': '- a\n\n  b\n\n  - c\n\n  d',
  // The item after the split takes the next number: w4, item 2 in the source, is item 3.
  'list-item-text-after-nested-list-numbered': '1. w0\n   1. w1\n      1. w2\n\n   w3 after the nested list\n2. w4',
  // Text after a later nested list splits again; the moved text spans its blank line.
  'list-item-text-after-two-nested-lists': '- a\n  - b\n\n  c\n\n  more c\n\n  - d\n\n  e',
  // A split inside a nested list, then one outside it, in source order.
  'list-item-split-inside-then-outside-nested-list': '- x\n  - y\n    - z\n\n    z2\n\n  x2',
  // 98 deep the text splits off with a notice; 99 deep (the deepest list validate allows) the
  // nested list is the item's text, and the text after it stays in place, with a notice that
  // the list keeps nesting as text and no split.
  'list-item-text-after-nested-list-deep-98': deep(98),
  'list-item-text-after-nested-list-deep-99': deep(99),
};
