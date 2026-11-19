import assert from 'node:assert/strict';
import { test } from 'node:test';
import { underBudget } from '../../scripts/lib/cpu-budget.mjs';
import { parsedWork } from './from-markdown.js';
import { IMPORT_WORK, readMarkdown } from './index.js';

// What ordinary text costs: seven ordinary documents of 500 kB, one shape each. This test owns
// the README's number. Each counts at most a quarter of the budget (the headroom) and is never
// counted below what markdown-it does to read it (the safety), and imports whole, with no notice.
const SIZE = 500_000;
const fill = (unit) => {
  let md = '';
  for (let n = 0; md.length < SIZE; n++) md += unit(n);
  return md;
};
const ORDINARY = {
  'plain prose': fill((n) => `Paragraph ${n} runs on as prose does, with **bold**, *emphasis*, \`code\` and [a link](https://example.com/${n}).\nIt wraps onto a second line and ends here.\n\n`),
  'a long flat list': fill((n) => `- Item ${n}, a short point with *a mark*\n`),
  'lists nested three deep': fill((n) => `- Point ${n}\n  - A nested point\n    - Deeper still, with *marks*\n`),
  'tab-indented code': fill((n) => `\`\`\`js\nfunction f${n}(x) {\n\tif (x) {\n\t\tfor (const y of x) {\n\t\t\tif (y) return y;\n\t\t}\n\t}\n\treturn ${n};\n}\n\`\`\`\n\n`),
  'space-indented code': fill((n) => `Code ${n}:\n\n    function f${n}(x) {\n        if (x) {\n            for (const y of x) {\n                if (y) return y;\n            }\n        }\n        return ${n};\n    }\n\n`),
  'a table': `| Name | Value | Note |\n| --- | ---: | --- |\n${fill((n) => `| row ${n} | ${n * 7} | a *short* note |\n`)}`,
  'a long quote': fill((n) => `> Line ${n} of a long quote, with **bold** and a [link](https://example.com/${n}).\n`),
};

test('each ordinary 500 kB document counts at most a quarter of the budget, never below markdown-it, and imports with no notice', () => {
  for (const [name, md] of Object.entries(ORDINARY)) {
    const { notices, work } = underBudget(4_000, () => readMarkdown(md));
    assert.deepEqual(notices, [], name);
    assert.ok(work <= IMPORT_WORK.budget / 4, `${name}: work ${work}, a quarter of the budget is ${IMPORT_WORK.budget / 4}`);
    const real = parsedWork(md);
    assert.ok(work >= real, `${name}: the text's count ${work} is below markdown-it's ${real}`);
  }
});
