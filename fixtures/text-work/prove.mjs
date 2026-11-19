// For each case and a random sweep: the text count never falls below markdown-it's work (the
// #88 counter, budget off), for the whole input and for each prefix of whole lines.
import { lineCosts } from './textwork.mjs';
import { CASES } from './case-list.mjs';
const [REAL] = process.argv.slice(2);
const { readMarkdown } = await import(`${REAL}/packages/text/index.js`);
const real = (md) => readMarkdown(md).work;
function check(name, md, prefixes) {
  const costs = lineCosts(md);
  const lines = md.split('\n');
  let worst = Infinity;
  const at = prefixes ? [...new Set([lines.length, ...Array.from({ length: prefixes }, () => 1 + Math.floor(Math.random() * lines.length))])] : [lines.length];
  for (const n of at) {
    const t = costs.slice(0, n).reduce((a, b) => a + b, 0);
    const r = real(lines.slice(0, n).join('\n'));
    worst = Math.min(worst, t / Math.max(r, 1));
    if (t < r) return { name, ok: false, n, t, r, md: lines.slice(0, n).join('\n') };
  }
  return { name, ok: true, ratio: worst, t: costs.reduce((a, b) => a + b, 0), r: real(md) };
}
const out = [];
for (const [name, md] of Object.entries(CASES)) out.push(check(name, md, 8));
for (const r of out) console.log(r.ok ? 'ok  ' : 'LOW ', r.name.padEnd(56), r.ok ? `text ${r.t} real ${r.r} min ratio ${r.ratio.toFixed(2)}` : `at line ${r.n}: text ${r.t} < real ${r.r}`);
// Random sweep.
const PIECES = ['> ', '>', '>', '- ', '* ', '+ ', '1. ', '2) ', '  ', '  ', ' ', '    ', '\t', '-\t', '>\t', '10. '];
const TAILS = ['text', '', '```', '~~~', '---', '===', '- x', '# h', '| a | b |', '| - | - |', '<div>', '</div>', '***', '> ', '1. y', '    code', '[x]: /u', '\\', '**b**'];
const rnd = (n) => Math.floor(Math.random() * n);
let low = 0;
let n = 0;
let minRatio = Infinity;
const N = Number(process.argv[3] ?? 2000);
for (; n < N; n++) {
  const deep = rnd(4) === 0 ? 150 : 25;
  const lines = Array.from({ length: 1 + rnd(30) }, () => {
    if (rnd(6) === 0) return '';
    if (rnd(4) === 0) return TAILS[rnd(TAILS.length)];
    let s = '';
    const k = rnd(deep);
    for (let i = 0; i < k; i++) s += PIECES[rnd(PIECES.length)];
    return s + TAILS[rnd(TAILS.length)];
  });
  const md = lines.join(rnd(8) === 0 ? '\r\n' : '\n');
  const r = check(`random ${n}`, md, 3);
  if (!r.ok) { low++; if (low <= 5) console.log('LOW', JSON.stringify(r.md.slice(0, 300)), r.t, r.r); }
  else minRatio = Math.min(minRatio, r.ratio);
}
console.log(`random: ${n} docs, ${low} below, min ratio ${minRatio.toFixed(2)}`);
