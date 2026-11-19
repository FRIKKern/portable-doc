// Writes the shared work cases: { rules, cases: { name: { markdown, depths, work, cut } } }, from
// the checkout in argv[2]: the hostile cases of its import-work-cases.mjs, and the old file's cases.
// cut is the first line (from 0) past the budget, or null; work is the count of the whole text.
import fs from 'node:fs';
import { RULES } from './rules.mjs';
const [REPO, FROM, OUT] = process.argv.slice(2);
const { planText, normalize } = await import(`${REPO}/packages/text/import-work.js`);
// The depths, from the rules text alone (markers and depth), not from the module.
const SP = (c) => c === ' ' || c === '\t';
function own(line) {
  let i = 0, col = 0, m = 0, w = 0;
  for (;;) {
    while (i < line.length && SP(line[i])) { const width = line[i] === '\t' ? 4 - (col % 4) : 1; w += width; col += width; i++; }
    if (line[i] === '>') { m++; i++; col++; continue; }
    const mk = /^(?:[-+*]|[0-9]{1,9}[.)])(?=[ \t]|$)/.exec(line.slice(i));
    if (!mk) return m + Math.floor(w / 2);
    m++; i += mk[0].length; col += mk[0].length;
  }
}
function depthReader() {
  let before = 0, afterBlank = true;
  return { next(line) {
    const blank = /^[ \t]*$/.test(line);
    const d = blank ? before : afterBlank ? own(line) : Math.max(own(line), before);
    before = d; afterBlank = blank; return d;
  } };
}
const BUDGET = 16_000_000;
const NO_LIMIT = { budget: Infinity, lineBytes: null };
const X = (n, c = 'x') => c.repeat(n);
const { CASES } = await import(`${REPO}/packages/text/import-work-cases.mjs`);
const old = JSON.parse(fs.readFileSync(FROM, 'utf8'));
const oldCases = old.cases ?? old;
const out = {};
const add = (name, markdown, keep = true) => {
  const lines = normalize(markdown).split('\n');
  const reader = depthReader();
  const depths = lines.map((l) => reader.next(l));
  let sum = 0;
  let cut = null;
  depths.forEach((d, i) => { sum += (d + 1) * (2 + Buffer.byteLength(lines[i])); if (cut === null && sum > BUDGET) cut = i; });
  if (sum !== planText(markdown, NO_LIMIT).work) throw new Error(`depths and planText disagree: ${name}`);
  out[name] = keep ? { markdown, depths, work: sum, cut } : { generator: name, work: sum, cut, lines: lines.length, bytes: Buffer.byteLength(markdown) };
};
for (const [name, c] of Object.entries(oldCases)) if (c.markdown !== undefined) add(name, c.markdown);
for (const [name, md] of Object.entries(CASES)) if (!(name in out)) add(name, md);
let lazy = `${'> '.repeat(300)}l0`;
for (let i = 1; lazy.length < 500_000; i++) lazy += `\n> l${i}`;
add("'> ' x 300 + 'l0', then '\\n> l' + i for i = 1, 2, … until 500,000 characters", lazy, false);
let lazyBare = `${'> '.repeat(300)}l0`;
for (let i = 1; lazyBare.length < 500_000; i++) lazyBare += `\nl${i}`;
add("'> ' x 300 + 'l0', then '\\nl' + i for i = 1, 2, … until 500,000 characters (lazy lines)", lazyBare, false);
add("'- ' x 250,000 + 'end' (one line)", `${'- '.repeat(250_000)}end`, false);
const body = Object.entries(out).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
fs.writeFileSync(OUT, `{\n "rules": ${JSON.stringify(RULES, null, 2).replace(/\n/g, '\n ')},\n "cases": {\n${body}\n }\n}\n`);
for (const [k, v] of Object.entries(out)) {
  const o = oldCases[k];
  const moved = !o ? 'new  ' : o.work !== v.work || o.cut !== v.cut ? 'MOVED' : 'same ';
  console.log(moved, k, o && moved === 'MOVED' ? `work ${o.work} -> ${v.work}, cut ${o.cut} -> ${v.cut}` : moved === 'new  ' ? `work ${v.work}, cut ${v.cut}` : '');
}
