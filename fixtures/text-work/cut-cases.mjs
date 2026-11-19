// Writes cut-cases.json: { rules, cases: { name: { markdown | generator, limits, blocks, notices, work } } },
// each read by readMarkdown from the checkout given as argv[2], starting from the cases in argv[3].
import fs from 'node:fs';
import { RULES } from './rules.mjs';
const [REPO, FROM, OUT] = process.argv.slice(2);
const { readMarkdown } = await import(`${REPO}/packages/text/index.js`);
const base = JSON.parse(fs.readFileSync(FROM, 'utf8'));
const old = base.cases ?? base;
const cases = {};
const read = (markdown, limits) => {
  const { blocks, notices, work } = readMarkdown(markdown, { ...limits, notice: 'import_work_spent' });
  return { blocks, notices, work };
};
for (const [name, c] of Object.entries(old)) {
  if (c.markdown !== undefined) cases[name] = { markdown: c.markdown, limits: c.limits, ...read(c.markdown, c.limits) };
}
// The generator case: the text is too big to store; its one paragraph is described.
const big = `${'- '.repeat(100_000)}a0\n\nb0\n\n${'> '.repeat(300)}c0`;
const g = read(big, { budget: 16_000_000, lineBytes: null });
const gname = Object.keys(old).find((k) => old[k].generator);
if (g.blocks.length !== 1 || g.blocks[0].content[0].value !== big.replace(/\s+/g, ' ').trim()) throw new Error('generator case changed');
cases[gname] = { ...old[gname], notices: g.notices, work: g.work };
const NO_LINE = { budget: 16_000_000, lineBytes: null };
const add = (name, markdown, limits = NO_LINE) => { cases[name] = { markdown, limits, ...read(markdown, limits) }; };
add('budget: lone carriage returns under deep quotes', `x\r${`${'> '.repeat(200)}y\r`.repeat(200)}`);
add('budget: lone carriage returns under deep list items', `x\r${`${'- '.repeat(200)}y\r`.repeat(200)}`);
add('budget: a carriage return inside each list prefix', `${'- \r- '.repeat(10)}y\n`.repeat(100));
add('line: lone carriage returns end lines for the line rule', `short\r${'x'.repeat(41)}\rafter`, { budget: 16_000_000, lineBytes: 40 });
add('budget: NULs read as U+FFFD', `${'> '.repeat(2)}a\0b`);
const rules = {
  ...RULES,
  limits: 'Each case gives its own limits; lineBytes null means no line rule. A notice with rule "net" never appears in these cases.',
  budget: 'Where the running sum passes limits.budget, that line and every line after it are one top-level paragraph, whitespace collapsed; the lines before it are read as a document. One notice: rule "budget", its first line (from 1) and how many lines it cut.',
  long: 'With limits.lineBytes set, a non-blank line of more than lineBytes UTF-8 bytes is never parsed: it costs its bytes once, it is one top-level paragraph as typed, the text before it is read as a document and the text after it is read afresh; the line after it takes its own depth, as after a blank line. One notice for all such lines before the budget cut: rule "line", the first one\'s line (from 1) and how many there are.',
  fence: 'A fence is tracked from a line, not in a fence and not long, whose text after its prefix starts with 3 or more "`" with no "`" after them, or 3 or more "~". The opener\'s containers are its prefix\'s markers. Each later line first walks those containers: for a ">", any spaces and tabs then the ">"; for a list item, spaces and tabs up to its least content column (its marker\'s end plus one, in columns from the line start); a line that lacks a ">" or has text before that column leaves them, and the fence ends there. Otherwise a line that is not long ends the fence when, after the containers, it has any spaces and tabs, at least as many of the opener\'s character, then only spaces and tabs. When a long line sits in a tracked fence, the text after it starts with the fence\'s opening line again, charged once more at that line\'s own depth (m + floor(w / 2)), so the code stays code.',
};
// One case per line, so a deep case stays a line, not thousands of indented ones.
const body = Object.entries(cases).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
fs.writeFileSync(OUT, `{\n "rules": ${JSON.stringify(rules, null, 2).replace(/\n/g, '\n ')},\n "cases": {\n${body}\n }\n}\n`);
for (const [k, v] of Object.entries(cases)) {
  const o = old[k];
  const same = o && JSON.stringify(o.blocks) === JSON.stringify(v.blocks) && JSON.stringify(o.notices) === JSON.stringify(v.notices) && o.work === v.work;
  console.log(o ? (same ? 'same ' : 'MOVED') : 'new  ', k, same ? '' : `work ${o?.work} -> ${v.work} ${JSON.stringify(v.notices)}`);
  if (v.notices.some((n) => n.rule === 'net')) throw new Error(`net fired: ${k}`);
}
