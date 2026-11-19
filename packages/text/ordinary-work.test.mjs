import assert from 'node:assert/strict';
import { test } from 'node:test';
import { underBudget } from '../../scripts/lib/cpu-budget.mjs';
import { readPlan } from './from-markdown.js';
import { IMPORT_WORK, planText } from './import-work.js';

// What ordinary text costs: nine ordinary documents of 500 kB, one shape each. This test owns
// the README's number. Each counts at most a sixth of the budget (the headroom) and is never
// counted below what markdown-it does to read it (the safety), and imports whole, with no notice.
const SIZE = 500_000;
const fill = (unit) => {
  let md = '';
  for (let n = 0; md.length < SIZE; n++) md += unit(n);
  return md;
};
// Go, indented with tabs 1 to 5 deep, `ind` before each line.
const go = (n, ind) => ['func f' + n + '(xs []int) int {', '\tfor _, x := range xs {', '\t\tif x > 0 {', '\t\t\tswitch {', '\t\t\tcase x > 10:', '\t\t\t\tif x%2 == 0 {', '\t\t\t\t\treturn x', '\t\t\t\t}', '\t\t\t}', '\t\t}', '\t}', `\treturn ${n}`, '}'].map((l) => ind + l).join('\n');
const ORDINARY = {
  'plain prose': fill((n) => `Paragraph ${n} runs on as prose does, with **bold**, *emphasis*, \`code\` and [a link](https://example.com/${n}).\nIt wraps onto a second line and ends here.\n\n`),
  'a long flat list': fill((n) => `- Item ${n}, a short point with *a mark*\n`),
  'lists nested three deep': fill((n) => `- Point ${n}\n  - A nested point\n    - Deeper still, with *marks*\n`),
  'tab-indented code': fill((n) => `\`\`\`js\nfunction f${n}(x) {\n\tif (x) {\n\t\tfor (const y of x) {\n\t\t\tif (y) return y;\n\t\t}\n\t}\n\treturn ${n};\n}\n\`\`\`\n\n`),
  'space-indented code': fill((n) => `Code ${n}:\n\n    function f${n}(x) {\n        if (x) {\n            for (const y of x) {\n                if (y) return y;\n            }\n        }\n        return ${n};\n    }\n\n`),
  'a table': `| Name | Value | Note |\n| --- | ---: | --- |\n${fill((n) => `| row ${n} | ${n * 7} | a *short* note |\n`)}`,
  'a long quote': fill((n) => `> Line ${n} of a long quote, with **bold** and a [link](https://example.com/${n}).\n`),
  'Go in fences': fill((n) => `\`\`\`go\n${go(n, '')}\n\`\`\`\n\n`),
  'Go as indented code': fill((n) => `Func ${n}:\n\n${go(n, '\t')}\n\n`),
};

test('each ordinary 500 kB document counts at most a sixth of the budget, never below markdown-it, and imports with no notice', () => {
  for (const [name, md] of Object.entries(ORDINARY)) {
    // readMarkdown's two steps, so the one parse also gives markdown-it's own count.
    const { work, read } = underBudget(4_000, () => {
      const plan = planText(md);
      return { work: plan.work, read: readPlan(plan, IMPORT_WORK) };
    });
    assert.deepEqual(read.notices, [], name);
    assert.ok(work <= IMPORT_WORK.budget / 6, `${name}: work ${work}, a sixth of the budget is ${IMPORT_WORK.budget / 6}`);
    assert.ok(work >= read.parsed, `${name}: the text's count ${work} is below markdown-it's ${read.parsed}`);
  }
});
