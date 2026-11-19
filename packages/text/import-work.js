// SPDX-License-Identifier: Apache-2.0
import { closes, depthReader, isBlank, opener, prefix, within } from './import-depth.js';

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
//   markers = its leading container markers (`>`, `-` `+` `*` or 1 to 9 digits and `.` or
//             `)`, a list marker followed by a space, a tab or the line end);
//   depth D = how many containers it may sit in (import-depth.js): its markers, plus the list
//             items open from earlier marker lines that its text sits inside; inside a code
//             fence the tracker is sure of, the fence's opening line's depth. A blank line
//             takes the depth before it, and a line right after a non-blank line takes at
//             least that line's depth (it may be lazy);
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
// Each rule gives at most one notice per document: its first line and how many lines it cut.

/**
 * The import's limits and the notice it gives past them. lineBytes is the pack's value; null
 * until it lands. An ordinary 500 kB document uses at most a sixth of the budget
 * (ordinary-work.test.mjs).
 */
export const IMPORT_WORK = Object.freeze({ budget: 16_000_000, lineBytes: null, notice: 'import_work_spent' });

export { prefix };

const bytes = (line) => Buffer.byteLength(line);

/** The text as markdown-it's core rule 'normalize' leaves it. */
export const normalize = (markdown) => markdown.replace(/\r\n?/g, '\n').replace(/\0/g, '\uFFFD');

/**
 * The text's plan: { work, parts, notices }. `parts` are, in order, { read: text, line } to parse
 * as a document, `line` the source line (from 0) its first line stands for, and
 * { plain: text, rule } to keep as one top-level paragraph. `notices` are
 * { rule, line, lines }, at most one per rule: 'line' (a line past lineBytes) and 'budget'
 * (the lines from where the work passed the budget), `line` counted from 1.
 */
export function planText(markdown, limits = IMPORT_WORK) {
  const lines = normalize(markdown).split('\n');
  const parts = [];
  const notices = new Map();
  const note = (rule, n, count) => {
    const seen = notices.get(rule);
    if (seen) seen.lines += count;
    else notices.set(rule, { rule, line: n + 1, lines: count });
  };
  let read = [];
  let start = 0;
  const flush = () => {
    if (read.length) parts.push({ read: read.join('\n'), line: start });
    read = [];
  };
  let work = 0;
  let spent = false;
  const depth = depthReader();
  let fence = null; // { containers, char, len, line }
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const blank = isBlank(line);
    const long = limits.lineBytes !== null && !blank && bytes(line) > limits.lineBytes;
    const inside = fence ? within(line, fence.containers) : null;
    if (fence && inside === null) fence = null; // its container ended, and the fence with it
    let cost;
    if (long) {
      cost = bytes(line);
      depth.reset();
    } else {
      cost = (depth.next(line) + 1) * (2 + bytes(line));
      if (fence) {
        if (closes(line, inside.at, fence)) fence = null;
      } else {
        const p = prefix(line);
        const f = opener(line, p.at);
        if (f) fence = { ...f, containers: p.containers, line };
      }
    }
    if (!spent && work + cost > limits.budget) {
      spent = true;
      flush();
      const rest = lines.slice(n).join('\n').replace(/\s+/g, ' ').trim();
      if (rest) parts.push({ plain: rest, rule: 'budget' });
      note('budget', n, lines.length - n);
    }
    work += cost;
    if (spent) continue;
    if (long) {
      flush();
      parts.push({ plain: line, rule: 'line' });
      note('line', n, 1);
      if (fence) {
        // The code goes on after the line: read it as if the fence opened again there.
        // Its opening line is read twice, and charged twice, at its own depth. It stands at
        // the long line's place, so the lines after it keep their numbers.
        start = n;
        read.push(fence.line);
        work += (depth.next(fence.line) + 1) * (2 + bytes(fence.line));
      }
    } else {
      if (!read.length) start = n;
      read.push(line);
    }
  }
  flush();
  return { work, parts, notices: [...notices.values()] };
}
