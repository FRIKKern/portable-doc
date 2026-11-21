// SPDX-License-Identifier: Apache-2.0
// The import's work, counted from the Markdown text alone, before any parse, so every
// importer that reads the same text cuts it at the same line.
//
// The text is first normalized as markdown-it 15 does before it parses (its core rule
// 'normalize', src/rules_core/normalize.ts: /\r\n?/g to "\n", then /\0/g to U+FFFD), and
// split at "\n" as its StateBlock does. So "\n", "\r\n" and a lone "\r" each end a line,
// and a NUL counts as the three bytes of U+FFFD. The count, the long-line rule and the line
// numbers in notices all see these lines.
//
// Per line:
//   blank   = empty, or only spaces and tabs;
//   prefix  = its leading container markers (`>`, `-` `+` `*` or 1 to 9 digits and `.` or `)`,
//             a list marker followed by a space, a tab or the line end) and the spaces and
//             tabs among them; m = the markers, w = the spaces and tabs in columns, a tab
//             to the next tab stop of 4, as markdown-it counts them;
//   depth D = m + floor(w / 2). A blank line takes the depth before it, and a line right
//             after a non-blank line takes at least that line's depth (it may be lazy);
//   cost    = (D + 1) × (2 + its UTF-8 bytes): one scan of the line and its line end for
//             each container it may sit in, and one at the top.
// The work is the sum. It is never below what markdown-it does to parse the same lines
// (the import-work test shows it), so an import within IMPORT_WORK.budget is bounded.
//
// Two rules cut the text, and what they cut is kept as plain text, every word:
// - A line longer than IMPORT_WORK.lineBytes (and not blank) is never parsed. The text
//   before it is read as a document, so the containers open there close; the line is one
//   top-level paragraph, as typed; the text after it is read afresh. It is charged its bytes
//   once, and the depth starts again at 0. Inside an open code fence that the line belongs
//   to, the text after it starts with the fence's opening line again, so the code stays code.
// - Where the running sum passes IMPORT_WORK.budget, that line and every line after it are
//   one top-level paragraph, whitespace collapsed.
// The budget gives at most one notice per document: its first line and how many lines it cut.
// The line rule gives one per run of cut lines (cut lines with consecutive numbers; any line not
// cut ends a run, and a fence opened again after a cut line does not): its first line and how many,
// up to MAX_LINE_NOTICES runs. One more notice stands for every run after those.

/**
 * The import's limits and the notice it gives past them. lineBytes is the pack's value; null
 * until it lands. An ordinary 500 kB document uses at most a third of the budget
 * (ordinary-work.test.mjs).
 */
export const IMPORT_WORK = Object.freeze({ budget: 16_000_000, lineBytes: null, notice: 'import_work_spent' });

/**
 * The most run notices a text gets from the line rule. Runs can be as many as cut lines, and the
 * budget allows a great many; a notice for each would outweigh the text itself, so past this bound
 * one notice counts the rest (LINE_NOTICES_CAPPED). The line notices are at most
 * MAX_LINE_NOTICES + 1.
 */
export const MAX_LINE_NOTICES = 1000;

/** The code of that last line notice: the first line it covers, how many runs and how many lines. */
export const LINE_NOTICES_CAPPED = 'import_line_notices_capped';

const SP = (ch) => ch === 32 || ch === 9;
const isBlank = (line) => {
  for (let i = 0; i < line.length; i++) if (!SP(line.charCodeAt(i))) return false;
  return true;
};
/** UTF-8 bytes of `line`, as TextEncoder makes them (a lone surrogate is U+FFFD, 3 bytes); no Node global, so it runs in a browser. */
function bytes(line) {
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < line.length && (line.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** The text as markdown-it's core rule 'normalize' leaves it. */
export const normalize = (markdown) => markdown.replace(/\r\n?/g, '\n').replace(/\0/g, '\uFFFD');

/** A list marker's end in `line` at `i` (the index after it), or -1. */
function listMarker(line, i) {
  const end = (j) => j >= line.length || SP(line.charCodeAt(j));
  const ch = line.charCodeAt(i);
  if ((ch === 45 || ch === 43 || ch === 42) && end(i + 1)) return i + 1;
  let j = i;
  while (j < line.length && j - i < 9 && line.charCodeAt(j) >= 48 && line.charCodeAt(j) <= 57) j++;
  if (j > i && (line.charCodeAt(j) === 46 || line.charCodeAt(j) === 41) && end(j + 1)) return j + 1;
  return -1;
}

/**
 * The prefix of `line`: m markers, w whitespace columns (a tab to the next stop of 4), `at` where the text after
 * it starts, and its containers in order as `{ quote: true }` or `{ col }`, a list item's
 * least content column (its marker's end plus one), columns counted with tab stops of 4.
 */
export function prefix(line) {
  let i = 0;
  let m = 0;
  let w = 0;
  let col = 0;
  const containers = [];
  for (;;) {
    while (i < line.length && SP(line.charCodeAt(i))) {
      const width = line.charCodeAt(i++) === 9 ? 4 - (col % 4) : 1;
      w += width;
      col += width;
    }
    if (line.charCodeAt(i) === 62) {
      m++;
      i++;
      col++;
      containers.push({ quote: true });
      continue;
    }
    const end = listMarker(line, i);
    if (end === -1) return { m, w, at: i, containers };
    m++;
    col += end - i;
    i = end;
    containers.push({ col: col + 1 });
  }
}

/** Where `line` goes on inside `containers` (the index after their prefix), or -1 when one of them ends. */
function within(line, containers) {
  let i = 0;
  let col = 0;
  const space = () => {
    const tab = line.charCodeAt(i++) === 9;
    col = tab ? col + 4 - (col % 4) : col + 1;
  };
  for (const c of containers) {
    if (c.quote) {
      while (i < line.length && SP(line.charCodeAt(i))) space();
      if (line.charCodeAt(i) !== 62) return -1;
      i++;
      col++;
    } else {
      while (i < line.length && col < c.col && SP(line.charCodeAt(i))) space();
      if (col < c.col && i < line.length) return -1;
    }
  }
  return i;
}

/** A fence opener at `at`: { char, len }, or null. */
function opener(line, at) {
  const ch = line[at];
  if (ch !== '`' && ch !== '~') return null;
  let len = 0;
  while (line[at + len] === ch) len++;
  if (len < 3 || (ch === '`' && line.indexOf('`', at + len) !== -1)) return null;
  return { char: ch, len };
}

/** Whether `line` from `at` closes `fence`: its marker, at least as long, then only spaces and tabs. */
function closes(line, at, fence) {
  let i = at;
  while (i < line.length && SP(line.charCodeAt(i))) i++;
  let len = 0;
  while (line[i + len] === fence.char) len++;
  return len >= fence.len && isBlank(line.slice(i + len));
}

/**
 * The text's plan: { work, parts, notices }. `parts` are, in order, { read: text, line } to parse
 * as a document, `line` the source line (from 0) its first line stands for, and
 * { plain: text, rule, line } to keep as one top-level paragraph, `line` its first source line
 * (from 0). `notices` are { rule, line, lines } in source order, `line` counted from 1: one 'line'
 * per run of lines past lineBytes for the first MAX_LINE_NOTICES runs, then one { rule: 'line',
 * line, lines, runs } for every later run: its first line, and how many lines and runs, the lines
 * not consecutive. So the line notices are at most MAX_LINE_NOTICES + 1, and their `lines` add up
 * to every cut line. At most one 'budget' (the lines from where the work passed the budget).
 */
export function planText(markdown, limits = IMPORT_WORK) {
  const lines = normalize(markdown).split('\n');
  const parts = [];
  const notices = [];
  // One notice per run of cut lines: a line cut right after the last one cut extends its run.
  // Past MAX_LINE_NOTICES runs, `rest` takes every later cut line. Only the budget's notice can
  // follow a line notice, and no line is cut after it, so a run goes on in notices.at(-1).
  let runs = 0;
  let lastCut = -2;
  let rest = null;
  const cut = (n) => {
    const goesOn = n === lastCut + 1;
    lastCut = n;
    if (rest) {
      rest.lines++;
      if (!goesOn) rest.runs++;
    } else if (goesOn) notices.at(-1).lines++;
    else if (runs >= MAX_LINE_NOTICES) notices.push((rest = { rule: 'line', line: n + 1, lines: 1, runs: 1 }));
    else {
      runs++;
      notices.push({ rule: 'line', line: n + 1, lines: 1 });
    }
  };
  let read = [];
  let start = 0;
  const flush = () => {
    if (read.length) parts.push({ read: read.join('\n'), line: start });
    read = [];
  };
  let work = 0;
  let spent = false;
  let before = 0;
  let afterBlank = true;
  let fence = null; // { containers, char, len, line }
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const blank = isBlank(line);
    const long = limits.lineBytes !== null && !blank && bytes(line) > limits.lineBytes;
    const at = fence ? within(line, fence.containers) : -1;
    if (fence && at === -1) fence = null; // its container ended, and the fence with it
    let cost;
    if (long) {
      cost = bytes(line);
      before = 0;
      afterBlank = true;
    } else {
      const p = prefix(line);
      const D = blank ? before : afterBlank ? p.m + Math.floor(p.w / 2) : Math.max(p.m + Math.floor(p.w / 2), before);
      cost = (D + 1) * (2 + bytes(line));
      before = D;
      afterBlank = blank;
      if (fence) {
        if (closes(line, at, fence)) fence = null;
      } else {
        const f = opener(line, p.at);
        if (f) fence = { ...f, containers: p.containers, line };
      }
    }
    if (!spent && work + cost > limits.budget) {
      spent = true;
      flush();
      const rest = lines.slice(n).join('\n').replace(/\s+/g, ' ').trim();
      if (rest) parts.push({ plain: rest, rule: 'budget', line: n });
      notices.push({ rule: 'budget', line: n + 1, lines: lines.length - n });
    }
    work += cost;
    if (spent) continue;
    if (long) {
      flush();
      parts.push({ plain: line, rule: 'line', line: n });
      cut(n);
      if (fence) {
        // The code goes on after the line: read it as if the fence opened again there.
        // Its opening line is read twice, and charged twice, at its own depth. It stands at
        // the long line's place, so the lines after it keep their numbers.
        start = n;
        read.push(fence.line);
        const p = prefix(fence.line);
        work += (p.m + Math.floor(p.w / 2) + 1) * (2 + bytes(fence.line));
      }
    } else {
      if (!read.length) start = n;
      read.push(line);
    }
  }
  flush();
  return { work, parts, notices };
}
