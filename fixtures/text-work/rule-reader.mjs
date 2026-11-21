// SPDX-License-Identifier: Apache-2.0
// The text-work rules (rules.mjs) done from their words alone, apart from import-work.js:
// each line's depth, and a text's work and notices. The shared-cases test compares this with
// planText, so the words and the code cannot drift apart.
import { MAX_LINE_NOTICES } from '../../packages/text/index.js';

const SP = (c) => c === ' ' || c === '\t';
const blank = (line) => /^[ \t]*$/.test(line);

/** "lines": the text normalized, then split at "\n". */
export const linesOf = (markdown) => markdown.replace(/\r\n?/g, '\n').replace(/\0/g, '�').split('\n');

/** "markers": a line's own depth D = m + floor(w / 2), where its prefix ends, and its containers (">" or an item's least content column). */
export function prefix(line) {
  let i = 0;
  let col = 0;
  let m = 0;
  let w = 0;
  const containers = [];
  for (;;) {
    while (i < line.length && SP(line[i])) {
      const width = line[i] === '\t' ? 4 - (col % 4) : 1;
      w += width;
      col += width;
      i++;
    }
    if (line[i] === '>') {
      m++;
      i++;
      col++;
      containers.push('>');
      continue;
    }
    const marker = /^(?:[-+*]|[0-9]{1,9}[.)])(?=[ \t]|$)/.exec(line.slice(i));
    if (!marker) return { D: m + Math.floor(w / 2), at: i, containers };
    m++;
    i += marker[0].length;
    col += marker[0].length;
    containers.push(col + 1);
  }
}

/** "depth": each line's depth, in order. */
export function depthsOf(markdown) {
  let before = 0;
  let afterBlank = true;
  return linesOf(markdown).map((line) => {
    const isBlank = blank(line);
    const own = isBlank ? before : prefix(line).D;
    const D = isBlank || afterBlank ? own : Math.max(own, before);
    before = D;
    afterBlank = isBlank;
    return D;
  });
}

// "fence": walk the opener's containers; the index after them, or -1 when the line leaves them.
function walk(line, containers) {
  let i = 0;
  let col = 0;
  const space = () => {
    col = line[i] === '\t' ? col + 4 - (col % 4) : col + 1;
    i++;
  };
  for (const c of containers) {
    if (c === '>') {
      while (i < line.length && SP(line[i])) space();
      if (line[i] !== '>') return -1;
      i++;
      col++;
    } else {
      while (i < line.length && col < c && SP(line[i])) space();
      if (col < c && i < line.length) return -1;
    }
  }
  return i;
}
const opens = (text) => {
  const ticks = /^(`{3,})/.exec(text);
  if (ticks) return text.indexOf('`', ticks[1].length) === -1 ? { ch: '`', n: ticks[1].length } : null;
  const tildes = /^(~{3,})/.exec(text);
  return tildes ? { ch: '~', n: tildes[1].length } : null;
};

/** "cost", "budget", "long" and "fence": a text's work and its notices { rule, line, lines }, under `limits`. */
export function plan(markdown, { budget, lineBytes }) {
  const lines = linesOf(markdown);
  let work = 0;
  let before = 0;
  let afterBlank = true;
  let fence = null;
  let spent = false;
  const notes = [];
  let cutBefore = -2;
  lines.forEach((line, n) => {
    const isBlank = blank(line);
    const long = lineBytes !== null && !isBlank && Buffer.byteLength(line) > lineBytes;
    const at = fence ? walk(line, fence.containers) : -1;
    if (fence && at === -1) fence = null;
    let cost;
    if (long) {
      cost = Buffer.byteLength(line);
      before = 0;
      afterBlank = true;
    } else {
      const p = prefix(line);
      const D = isBlank ? before : afterBlank ? p.D : Math.max(p.D, before);
      cost = (D + 1) * (2 + Buffer.byteLength(line));
      before = D;
      afterBlank = isBlank;
      if (fence) {
        const rest = line.slice(at).replace(/^[ \t]*/, '');
        if (new RegExp(`^\\${fence.ch}{${fence.n},}[ \\t]*$`).test(rest)) fence = null;
      } else {
        const opened = opens(line.slice(p.at));
        if (opened) fence = { ...opened, containers: p.containers, line };
      }
    }
    if (!spent && work + cost > budget) {
      spent = true;
      notes.push({ rule: 'budget', line: n + 1, lines: lines.length - n });
    }
    work += cost;
    if (spent || !long) return;
    // "One notice per run": a cut line right after the last cut line goes on its run; past
    // MAX_LINE_NOTICES runs, "one notice stands for every later run".
    const last = notes.at(-1);
    const goesOn = cutBefore === n - 1;
    cutBefore = n;
    if (last?.runs !== undefined) {
      last.lines++;
      if (!goesOn) last.runs++;
    } else if (goesOn) last.lines++;
    else if (notes.filter((note) => note.rule === 'line').length < MAX_LINE_NOTICES) notes.push({ rule: 'line', line: n + 1, lines: 1 });
    else notes.push({ rule: 'line', line: n + 1, lines: 1, runs: 1 });
    if (fence) work += (prefix(fence.line).D + 1) * (2 + Buffer.byteLength(fence.line));
  });
  return { work, notices: notes };
}
