// An implementation of the case files' rules text alone, compared with the module's planText:
// work and notices, on the cut cases, the hostile cases, and a seeded sweep with lineBytes 40.
import fs from 'node:fs';
const [REPO] = process.argv.slice(2);
const { planText } = await import(`${REPO}/packages/text/import-work.js`);
const { CASES, seeded } = await import(`${REPO}/packages/text/import-work-cases.mjs`);
const SP = (c) => c === ' ' || c === '\t';
const blank = (l) => /^[ \t]*$/.test(l);
// markers: the prefix, its m, w, end, and containers (">" or an item's least content column).
function prefix(line) {
  let i = 0, col = 0, m = 0, w = 0; const cs = [];
  for (;;) {
    while (i < line.length && SP(line[i])) { const wd = line[i] === '\t' ? 4 - (col % 4) : 1; w += wd; col += wd; i++; }
    if (line[i] === '>') { m++; i++; col++; cs.push('>'); continue; }
    const mk = /^(?:[-+*]|[0-9]{1,9}[.)])(?=[ \t]|$)/.exec(line.slice(i));
    if (!mk) return { D: m + Math.floor(w / 2), at: i, cs };
    m++; i += mk[0].length; col += mk[0].length; cs.push(col + 1);
  }
}
// fence: walk the opener's containers; -1 when the line leaves them.
function walk(line, cs) {
  let i = 0, col = 0;
  const sp = () => { col = line[i] === '\t' ? col + 4 - (col % 4) : col + 1; i++; };
  for (const c of cs) {
    if (c === '>') { while (i < line.length && SP(line[i])) sp(); if (line[i] !== '>') return -1; i++; col++; }
    else { while (i < line.length && col < c && SP(line[i])) sp(); if (col < c && i < line.length) return -1; }
  }
  return i;
}
const opens = (t) => { const b = /^(`{3,})/.exec(t); if (b) return t.indexOf('`', b[1].length) === -1 ? { ch: '`', n: b[1].length } : null; const s = /^(~{3,})/.exec(t); return s ? { ch: '~', n: s[1].length } : null; };
function plan(md, { budget, lineBytes }) {
  const lines = md.replace(/\r\n?/g, '\n').replace(/\0/g, '�').split('\n');
  let work = 0, before = 0, afterBlank = true, fence = null, spent = false; const notes = {};
  lines.forEach((line, n) => {
    const b = blank(line), long = lineBytes !== null && !b && Buffer.byteLength(line) > lineBytes;
    const at = fence ? walk(line, fence.cs) : -1;
    if (fence && at === -1) fence = null;
    let cost;
    if (long) { cost = Buffer.byteLength(line); before = 0; afterBlank = true; }
    else {
      const p = prefix(line);
      const D = b ? before : afterBlank ? p.D : Math.max(p.D, before);
      cost = (D + 1) * (2 + Buffer.byteLength(line)); before = D; afterBlank = b;
      if (fence) { const t = line.slice(at).replace(/^[ \t]*/, ''); const r = new RegExp(`^\\${fence.ch}{${fence.n},}[ \\t]*$`); if (r.test(t)) fence = null; }
      else { const f = opens(line.slice(p.at)); if (f) fence = { ...f, cs: p.cs, line }; }
    }
    if (!spent && work + cost > budget) { spent = true; notes.budget = { rule: 'budget', line: n + 1, lines: lines.length - n }; }
    work += cost;
    if (spent) return;
    if (long) { notes.line ? notes.line.lines++ : (notes.line = { rule: 'line', line: n + 1, lines: 1 }); if (fence) work += (prefix(fence.line).D + 1) * (2 + Buffer.byteLength(fence.line)); }
  });
  return { work, notices: Object.values(notes) };
}
const cut = JSON.parse(fs.readFileSync('cut-cases.json', 'utf8')).cases;
const docs = [];
for (const c of Object.values(cut)) if (c.markdown !== undefined) docs.push([c.markdown, c.limits]);
for (const md of Object.values(CASES)) for (const lb of [null, 40, 7]) docs.push([md, { budget: 16_000_000, lineBytes: lb }]);
const rnd = seeded(5); const pick = (a) => a[rnd(a.length)];
const P = ['> ', '>', '- ', '1. ', '  ', '\t', '>\t', '-\t', ' ', '    '], T = ['```', '~~~', '````', '``` x', '```a`', 'text', '', 'x'.repeat(45), '~~~~ ', '   ```', '\t```'];
for (let d = 0; d < 20000; d++) { const L = []; for (let i = 2 + rnd(12); i > 0; i--) { let p = ''; for (let k = rnd(4); k > 0; k--) p += pick(P); L.push(p + pick(T)); } docs.push([L.join(pick(['\n', '\r\n', '\r'])), { budget: 50 + rnd(3000), lineBytes: pick([null, 40, 10]) }]); }
let bad = 0;
for (const [md, lim] of docs) {
  const a = plan(md, lim), b = planText(md, { ...lim, notice: 'x' });
  const bn = b.notices.map(({ rule, line, lines }) => ({ rule, line, lines }));
  const key = (ns) => JSON.stringify([...ns].sort((x, y) => x.rule.localeCompare(y.rule)));
  if (a.work !== b.work || key(a.notices) !== key(bn)) { if (bad++ < 3) console.log('DIFF', JSON.stringify(md).slice(0, 150), lim, a.work, b.work, key(a.notices), key(bn)); }
}
console.log(`docs ${docs.length}, rules text vs planText differ: ${bad}`);
