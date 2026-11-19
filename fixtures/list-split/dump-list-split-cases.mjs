import fs from 'node:fs';
const [textDir, outDir] = process.argv.slice(2);
const { readMarkdown } = await import(textDir + '/index.js');
// One item at `depth` (items above it, each in the one before): text, a nested list two deep, then more text.
const deep = (depth) => {
  const lines = [];
  for (let i = 0; i < depth; i++) lines.push(`${'  '.repeat(i)}- d${i}`);
  lines.push(`${'  '.repeat(depth)}- w0`, `${'  '.repeat(depth + 1)}- w1`, `${'  '.repeat(depth + 2)}- w2`, '', `${'  '.repeat(depth + 1)}w3 after the nested list`);
  return lines.join('\n');
};
const cases = {
  'list-item-text-after-nested-list': '- w0\n  - w1\n    - w2\n\n  w3 after the nested list',
  'list-item-text-around-nested-list': '- a\n\n  b\n\n  - c\n\n  d',
  'list-item-text-after-nested-list-numbered': '1. w0\n   1. w1\n      1. w2\n\n   w3 after the nested list\n2. w4',
  'list-item-text-after-nested-list-deep-49': deep(49),
  'list-item-text-after-nested-list-deep-50': deep(50),
};
for (const [name, markdown] of Object.entries(cases)) {
  const { blocks, notices } = readMarkdown(markdown);
  fs.writeFileSync(`${outDir}/${name}.json`, JSON.stringify({ markdown, blocks, notices }, null, 2) + '\n');
}
console.log(Object.keys(cases).length, 'cases');
