import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsedWork } from './from-markdown.js';
import { CASES, seeded } from './import-work-cases.mjs';
import { planText } from './import-work.js';

// A seeded neighbour search, as a reviewer runs one: from the cases whose count is closest
// to markdown-it's, one small edit at a time, always on to the neighbour with the lowest
// count / markdown-it, and the count must never fall below it. IMPORT_WORK_STEPS=2000 runs
// a longer one by hand.
const STEPS = Number(process.env.IMPORT_WORK_STEPS) || 200;
const SEEDS = 6;
const NEIGHBOURS = 12;
const NO_LIMIT = { budget: Infinity, lineBytes: null };

const ratio = (md) => {
  const real = parsedWork(md);
  return real < 50 ? Infinity : planText(md, NO_LIMIT).work / real;
};

test('a seeded neighbour search from the closest cases finds no text the count puts below markdown-it', (t) => {
  const rnd = seeded(99);
  const pick = (a) => a[rnd(a.length)];
  // Each case's first 30 lines, each line at most 300 characters, so a step stays quick.
  const small = (md) => md.split('\n').slice(0, 30).map((l) => l.slice(0, 300)).join('\n');
  const seeds = Object.entries(CASES)
    .map(([name, md]) => ({ name, md: small(md) }))
    .map((s) => ({ ...s, r: ratio(s.md) }))
    .sort((a, b) => a.r - b.r)
    .slice(0, SEEDS);
  const prefixEnd = (line) => line.match(/^[ \t>*+\-\d.)]*/)[0].length;
  const EDITS = [
    (L, i) => { const p = rnd(prefixEnd(L[i]) + 1); L[i] = L[i].slice(0, p) + pick(['- ', '> ', '1. ', '2. ', '* ', '-']) + L[i].slice(p); },
    (L, i) => { L[i] = L[i].replace(pick([/- /, />\s?/, /\d+[.)] /, /\* /]), ''); },
    (L, i) => { L[i] = L[i].replace(/ {2,4}/, '\t'); },
    (L, i) => { L[i] = L[i].replace(/\t/, pick(['  ', '   ', '    '])); },
    (L, i) => { L.splice(i, 0, ''); },
    (L, i) => { const p = L[i].slice(0, prefixEnd(L[i])); L.splice(i, 0, p + pick(['```', '~~~'])); },
    (L, i) => { L[i] = ` ${L[i]}`; },
    (L, i) => { L[i] = `${pick([' ', '    ', '     '])}${L[i]}`; },
    (L, i) => { L[i] = L[i].replace(/^[ \t]/, ''); },
    (L, i) => { L[i] = `> ${L[i]}`; },
    (L, i) => { L[i] = L[i].slice(prefixEnd(L[i])); },
    (L, i) => { L.splice(i, 0, L[i]); },
  ];
  const below = [];
  let least = { r: Infinity };
  for (const seed of seeds) {
    let cur = seed.md;
    let best = seed.r;
    for (let step = 0; step < STEPS; step++) {
      let next = { r: Infinity };
      for (let k = 0; k < NEIGHBOURS; k++) {
        const L = cur.split('\n');
        if (L.length > 40) L.splice(rnd(L.length), 1);
        pick(EDITS)(L, rnd(L.length));
        const md = L.join('\n');
        const r = ratio(md);
        if (r < 1) below.push(md);
        if (r < next.r) next = { r, md };
      }
      if (next.r === Infinity) continue;
      if (next.r <= best + 0.002) cur = next.md; // on, also a little uphill, so it drifts
      best = Math.min(best, next.r);
      if (next.r < least.r) least = { ...next, from: seed.name };
    }
  }
  t.diagnostic(`seeds: ${seeds.map((s) => `${s.name} (${s.r.toFixed(4)})`).join('; ')}`);
  t.diagnostic(`least count / markdown-it: ${least.r.toFixed(4)}, from ${least.from}: ${JSON.stringify(least.md).slice(0, 300)}`);
  assert.deepEqual(below.slice(0, 3), []);
});

// A hunt aimed at fence-like lines a count may take for code: behind container prefixes
// shifted by tabs, 0 to 5 columns into their container, then lines that are deep unless
// they are code. IMPORT_WORK_HUNT=20000 runs a longer one by hand.
const HUNT = Number(process.env.IMPORT_WORK_HUNT) || 1500;

test('a seeded hunt for fence-like lines behind tab-shifted prefixes finds no text the count puts below markdown-it', (t) => {
  const rnd = seeded(7);
  const pick = (a) => a[rnd(a.length)];
  const PRE = ['>', '> ', '>\t', '> \t', '-\t', '- ', ' -\t', '1.\t', '1. ', '\t', ' ', '  ', '   ', '*\t', '>  ', '-  \t'];
  const WS = ['', ' ', '  ', '   ', '    ', '     ', '\t', ' \t', '  \t', '   \t', '\t ', '\t  '];
  const deep = (n) => `${'> '.repeat(n)}x`;
  const below = [];
  let least = { r: Infinity };
  for (let d = 0; d < HUNT; d++) {
    const L = [];
    let p = '';
    for (let i = 1 + rnd(3); i > 0; i--) p += pick(PRE);
    if (rnd(2)) L.push(`${p}item`);
    if (rnd(10) < 3) L.push('');
    const cont = pick([p, p.replace(/[-*]|1\./g, ' '), p.replace(/[^>\t]/g, ' ')]);
    L.push(cont + pick(WS) + pick(['```', '~~~', '````']));
    for (let i = 3 + rnd(12); i > 0; i--) L.push(pick([cont, '', cont + pick(WS)]) + (rnd(4) ? deep(5 + rnd(25)) : `${'>'.repeat(10 + rnd(50))} x`));
    if (rnd(2)) L.push(cont + pick(WS) + '```');
    const md = L.join('\n');
    const r = ratio(md);
    if (r < 1) below.push(md);
    if (r < least.r) least = { r, md };
  }
  t.diagnostic(`hunt: ${HUNT} documents, least count / markdown-it ${least.r.toFixed(4)}: ${JSON.stringify(least.md).slice(0, 200)}`);
  assert.deepEqual(below.slice(0, 3), []);
});
