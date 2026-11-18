// SPDX-License-Identifier: Apache-2.0
// The line diff a chat-tool-diff block shows: an LCS diff of an edit's old and
// new text (a write is all additions; a multi-edit is its hunks, separated by a
// gap). Oversized inputs fall back to all-removed-then-all-added, as the
// renderer does (packages/react/src/blocks/chat.ts).

import { asList, isMap } from './util.js';

const MAX_DIFF_LINES = 2000;
const MAX_DIFF_CELLS = 4_000_000;

function splitLines(s) {
  if (typeof s !== 'string' || s === '') return [];
  const lines = s.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function diffWithin(a, b, left) {
  const m = a.length;
  const n = b.length;
  if (m > MAX_DIFF_LINES || n > MAX_DIFF_LINES || m * n > left) {
    return [[...a.map((text) => ({ op: '-', text })), ...b.map((text) => ({ op: '+', text }))], left];
  }
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const out = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) out.push({ op: '=', text: a[--i] }), j--;
    else if (dp[i - 1][j] >= dp[i][j - 1]) out.push({ op: '-', text: a[--i] });
    else out.push({ op: '+', text: b[--j] });
  }
  while (i > 0) out.push({ op: '-', text: a[--i] });
  while (j > 0) out.push({ op: '+', text: b[--j] });
  return [out.reverse(), left - m * n];
}

/** The diff rows for a tool input: [{ op: '+' | '-' | '=' | 'gap', text }]. */
export function diffLines(input) {
  if (!isMap(input) || typeof input.file_path !== 'string') return [];
  if (Array.isArray(input.edits) && input.edits.length) {
    let left = MAX_DIFF_CELLS;
    const out = [];
    for (const e of asList(input.edits).filter(isMap)) {
      const [hunk, rest] = diffWithin(splitLines(e.old_string), splitLines(e.new_string), left);
      left = rest;
      if (!hunk.length) continue;
      if (out.length) out.push({ op: 'gap', text: '' });
      out.push(...hunk);
    }
    return out;
  }
  if (typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    return diffWithin(splitLines(input.old_string), splitLines(input.new_string), MAX_DIFF_CELLS)[0];
  }
  if (typeof input.content === 'string') return diffWithin([], splitLines(input.content), MAX_DIFF_CELLS)[0];
  return [];
}
