// SPDX-License-Identifier: Apache-2.0
// The hostile shapes the import's count is checked on (import-work.test.mjs), and the seeds of
// the neighbour search (import-work-search.test.mjs).

const X = (n, c = 'x') => c.repeat(n);

// markdown-it's own count (parsedWork) is what reading the text costs; the text's count may
// be more, never less, for the whole text and for every run of first lines (what the import
// reads before a cut).
export const CASES = {
  'lazy lines under a deep quote': `${X(300, '> ')}l0${'\nl1'.repeat(150)}`,
  'quoted lines under a deep quote': `${X(300, '> ')}l0${'\n> l1'.repeat(150)}`,
  'lazy lines under quote markers with no spaces': `${X(300, '>')}l0${'\nlxxxxxxxxxxxxxxx'.repeat(150)}`,
  'a lazy line that looks like a list marker': `${X(120, '> ')}a\n- b\n${X(120, '> ')}c\n1. d\n* e`,
  'a lazy line that looks like a fence': `${X(120, '> ')}a\n\`\`\`\ncode\n\`\`\`\n${X(60, '- ')}b\n~~~\nx`,
  'a blank line inside a fenced block under quotes': `${X(80, '> ')}\`\`\`\n${X(80, '> ')}a\n\n${X(80, '> ')}b\n${X(80, '> ')}\`\`\`\n`,
  'tabs versus spaces before markers': [...Array.from({ length: 80 }, (_, i) => `${X(i, '\t')}- t${i}`), ...Array.from({ length: 80 }, (_, i) => `${X(i, '  ')}- s${i}`)].join('\n'),
  'tabs between markers': `${X(150, '>\t')}a\n${X(150, '-\t')}b`,
  'a setext underline under a deep quote': `${X(150, '> ')}Title\n===\n${X(150, '> ')}Sub\n---\n${X(70, '- ')}x\n  ---`,
  'one long line of list markers': `${X(3000, '- ')}end`,
  'one long line of quote markers': `${X(3000, '> ')}end`,
  'ordered markers': `${X(400, '1. ')}x\n${X(400, '2) ')}y`,
  'list items continued by indentation after blank lines': Array.from({ length: 60 }, (_, i) => `${X(i, '  ')}- i${i}\n\n${X(i + 1, '  ')}more ${i}\n`).join('\n'),
  'a list item that starts with a blank line': Array.from({ length: 60 }, (_, i) => `${X(i, '  ')}-\n${X(i + 1, '  ')}text ${i}`).join('\n'),
  'a quote under each list item': Array.from({ length: 120 }, (_, i) => `${X(i, '  ')}- > q${i}`).join('\n'),
  'deep then shallow then deep': `${X(200, '- ')}a\nb\n\nc\n${X(200, '> ')}d`,
  'html and tables deep': ['<div>', 'x</div>', '| a | b |', '| - | - |', '| 1 | 2 |'].map((l) => `${X(120, '> ')}${l}`).join('\n'),
  'carriage returns': `${X(150, '> ')}a\r\n> b\r\n\r\n${X(100, '- ')}c\r\n`,
  'lone carriage returns under deep quotes': `x\r${X(200, `${X(200, '> ')}y\r`)}`,
  'lone carriage returns under deep list items': `x\r${X(200, `${X(200, '- ')}y\r`)}`,
  'a carriage return inside each list prefix': X(100, `${X(10, '- \r- ')}y\n`),
  'tabs after markers at every column': Array.from({ length: 120 }, (_, i) => `${X(i % 7, ' ')}${X(i, i % 2 ? '>\t' : '-\t')}t${i}`).join('\n'),
  // Lines a fence tracker could wrongly take for code, each followed by deep lines.
  ...Object.fromEntries(Object.entries({
    'a fence in a list item inside a quote, then the item ends': `> - a\n>\n>   \`\`\`\n> x`,
    'a quote marker indented differently from the item line': ` > - a\n>   \`\`\`\n> x`,
    'a closing fence shorter than its opener': '````\ncode\n```\nx',
    'an info string with a backtick': '``` a`b\nx',
    'a tilde fence closed by backticks': '~~~\nx\n```\ny',
    'a fence left open': '```\ncode',
    'a fence its list item ends': '- ```\n  code\nx',
    'a fence its quote ends': '> ```\n> code\n\nx',
    'a fence-like line in indented code': '    ```\nx',
    'a fence after an HTML block': '<div>\n```\nx\n```\ny',
    'a fence after an HTML comment across a blank line': '<!--\n\n```\n-->\nx\n```\ny',
    'a fence in a link reference definition': '[a]:\n```\nx\n```\ny',
    'a fence indented 3 to 5 columns into its item': '- a\n\n      ```\n  x\n```\ny',
    'a fence between an item\'s least and true content column': '-   a\n\n  ```\nx\n```\ny',
    'a closing fence indented 4 columns': '```\n    ```\ncode\n```\ny',
    'a closing fence indented 4 columns in a quote': '> ```\n>     ```\n> code\n> ```\n> y',
    'tabs before a fence in a quote': '>\t```\n>\tx\n> ```\ny',
    'indentation before a marker after a fence': '- a\n  ```\n  b\n  ```\n    - c',
  }).map(([name, md]) => [name, md.replace(/\bx\b/g, `${X(40, '> ')}x\n${X(40, '- ')}x\n${X(20, '  - ')}x`).replace(/\by\b/g, `${X(40, '> ')}y`)])),
  // A list marker that may continue a paragraph lazily keeps the items it would close open.
  'nested empty items, each next marker 4 to 5 columns past the content before it': X(60, '  - -\n\t     -\n              -\n                   - s\n                    -\n                     - s\n\n'),
  'a list marker 4 columns past its item\'s parent, left of its content': Array.from({ length: 40 }, (_, i) => `${X(i * 5, ' ')}- s${i}\n${X(i * 5 + 1, ' ')}- t${i}`).join('\n'),
  'a list marker that may continue a quote in an item lazily': Array.from({ length: 30 }, (_, i) => `${X(i, '  ')}- > - s${i}\n${X(i, '  ')}      - t${i}\n${X(i, '  ')}  >   - u${i}`).join('\n'),
  'wide ordered markers': Array.from({ length: 30 }, (_, i) => `${X(i * 5, ' ')}123456. s${i}\n${X(i * 5 + 4, ' ')}1. t${i}`).join('\n'),
  // A fence-like line is a fence only where its markers surely are markers, and the items open are sure.
  'a list marker 4 columns into a quote\'s paragraph, then a fence-like line': X(30, `>s\n    - \`\`\`\n      >${X(30, '1. ')}x\n${X(30, '      > 1. ')}y\n\n`),
  'an item in quotes inside an item a quote marker closes': X(20, `>>>1. >>>>>>>-\n>>>>>>>>>>   >\`\`\`\n>>>>>>>>>>>\`\`\`\n${X(19, '>')}1. >>>>>>- 1. ${X(30, '- ')}x\n\n`),
  'NULs under a deep quote': `${X(150, '> ')}${X(300, '\0')}\n${X(150, '> ')}a`,
};

/** A seeded run of numbers in [0, n), the same on every machine. */
export function seeded(seed) {
  let s = seed >>> 0;
  return (n) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return Math.floor((((x ^ (x >>> 14)) >>> 0) / 4294967296) * n);
  };
}
