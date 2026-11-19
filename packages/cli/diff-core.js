// SPDX-License-Identifier: Apache-2.0
// Compare two PortableDoc docs block by block: match the blocks, then name
// what was added, removed, moved and changed, down to the word or field.
// Pure: no I/O, no escaping. commands/diff.js prints the result.

import { toMarkdown } from '@portable-doc/text';
import { inOrder, matchBlocks } from './diff-match.js';
import { blockId, blockType, canon, isMap } from './diff-shared.js';

export { canon } from './diff-shared.js';

/** LCS cells for one word diff, and for all of one doc diff; past either, a text shows as all removed then all added. */
const MAX_CELLS = 4_000_000;
const MAX_TOTAL_CELLS = 40_000_000;

/** { blocks, rest } of a blocks array or a { blocks: [...] } doc, or null when it is neither. */
export function asDoc(value) {
  if (Array.isArray(value)) return { blocks: value, rest: {} };
  if (!isMap(value) || !Array.isArray(value.blocks)) return null;
  const { blocks, ...rest } = value;
  return { blocks, rest };
}

// ---- words ----

const tokens = (s) => s.match(/\s+|[^\s]+/g) ?? [];

/** A word diff of two strings: [{ op: '=' | '-' | '+', text }], runs merged, removals before additions. */
export function wordDiff(a, b, budget = { cells: MAX_TOTAL_CELLS }) {
  const all = [tokens(a), tokens(b)];
  // The common head and tail need no table.
  let head = 0;
  while (head < all[0].length && head < all[1].length && all[0][head] === all[1][head]) head++;
  let tail = 0;
  while (tail < all[0].length - head && tail < all[1].length - head && all[0].at(-1 - tail) === all[1].at(-1 - tail)) tail++;
  const x = all[0].slice(head, all[0].length - tail);
  const y = all[1].slice(head, all[1].length - tail);
  const cells = x.length * y.length;
  let ops;
  if (cells > MAX_CELLS || cells > budget.cells) ops = [...x.map((t) => ['-', t]), ...y.map((t) => ['+', t])];
  else {
    budget.cells -= cells;
    const dp = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    ops = [];
    let i = 0;
    let j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) ops.push(['=', x[i++]]), j++;
      else if (j >= y.length || (i < x.length && dp[i + 1][j] >= dp[i][j + 1])) ops.push(['-', x[i++]]);
      else ops.push(['+', y[j++]]);
    }
  }
  ops = [...all[0].slice(0, head).map((t) => ['=', t]), ...ops, ...all[0].slice(all[0].length - tail).map((t) => ['=', t])];
  // Merge runs; between two unchanged runs, the removed text comes before the added.
  const out = [];
  let del = '';
  let ins = '';
  const flush = () => {
    if (del) out.push({ op: '-', text: del });
    if (ins) out.push({ op: '+', text: ins });
    del = ins = '';
  };
  for (const [op, text] of ops) {
    if (op === '-') del += text;
    else if (op === '+') ins += text;
    else {
      flush();
      if (out.at(-1)?.op === '=') out.at(-1).text += text;
      else out.push({ op, text });
    }
  }
  flush();
  return out;
}

// ---- fields ----

/** Inline content as text with its marks noted, the way Markdown writes them. */
const inlineText = (content) => toMarkdown([{ type: 'paragraph', content }]).trim();

const pathOf = (at, key) => (typeof key === 'number' ? `${at}[${key}]` : at ? `${at}.${key}` : key);

/**
 * What differs between two values, as [{ path, from?, to? } | { path, words }]; a side that is absent has no from or to.
 * Equality is decided bottom-up: two maps or two arrays are equal when nothing under them differs, so each
 * value is read once, however deep. Only scalars and values of different kinds go through `canon`.
 * Inline `content` is read as Markdown once, at the outermost `content`; below it, parts compare by position.
 */
export function fieldDiff(a, b, at = '', out = [], budget = { cells: MAX_TOTAL_CELLS }, inContent = false) {
  if (a !== undefined && b !== undefined) {
    if (typeof a === 'string' && typeof b === 'string') {
      if (a === b) return out;
      if (/\s/.test(a + b)) return out.push({ path: at, words: wordDiff(a, b, budget) }), out;
    }
    if (!inContent && /(^|\.)content$/.test(at) && Array.isArray(a) && Array.isArray(b)) {
      const [x, y] = [inlineText(a), inlineText(b)];
      if (x !== y) return out.push({ path: at, words: wordDiff(x, y, budget) }), out;
      inContent = true;
    }
    if (isMap(a) && isMap(b)) {
      for (const k of [...Object.keys(a), ...Object.keys(b).filter((k) => !Object.hasOwn(a, k))]) fieldDiff(a[k], b[k], pathOf(at, k), out, budget, inContent);
      return out;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.max(a.length, b.length); i++) fieldDiff(a[i], b[i], pathOf(at, i), out, budget, inContent);
      return out;
    }
  }
  // canon writes an absent side as null; a null against an absent value is still a change.
  if (a !== undefined && b !== undefined && canon(a) === canon(b)) return out;
  out.push({ path: at, ...(a !== undefined && { from: a }), ...(b !== undefined && { to: b }) });
  return out;
}

/** fieldDiff of two blocks, or of the doc's own keys: one canon each first, so an equal pair costs one read. */
const pairDiff = (a, b, budget) => (canon(a) === canon(b) ? [] : fieldDiff(a, b, '', [], budget));

/**
 * Every difference between two docs, in a stable order: the doc's own keys
 * first, then blocks by position (a removed block by its old one).
 * Change: { kind: 'doc' | 'added' | 'removed' | 'moved' | 'changed', type, id, from, to, fields }.
 */
export function diffDocs(a, b) {
  const changes = [];
  const budget = { cells: MAX_TOTAL_CELLS };
  const docFields = pairDiff(a.rest, b.rest, budget);
  if (docFields.length) changes.push({ kind: 'doc', type: null, id: null, from: null, to: null, fields: docFields });
  const pairs = matchBlocks(a.blocks, b.blocks);
  const keep = inOrder(pairs);
  const block = (kind, blk, from, to, fields = []) => ({ kind, type: blockType(blk), id: blockId(blk), from, to, fields });
  const rows = [];
  pairs.forEach(([i, j], k) => {
    const fields = pairDiff(a.blocks[i], b.blocks[j], budget);
    if (!keep.has(k)) rows.push([j, 1, block('moved', b.blocks[j], i, j, fields)]);
    else if (fields.length) rows.push([j, 1, block('changed', b.blocks[j], i, j, fields)]);
  });
  const matchedA = new Set(pairs.map(([i]) => i));
  const matchedB = new Set(pairs.map(([, j]) => j));
  a.blocks.forEach((blk, i) => matchedA.has(i) || rows.push([i, 0, block('removed', blk, i, null)]));
  b.blocks.forEach((blk, j) => matchedB.has(j) || rows.push([j, 2, block('added', blk, null, j)]));
  rows.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  for (const [, , c] of rows) changes.push(c);
  const count = (kind) => changes.filter((c) => c.kind === kind).length;
  return { equal: changes.length === 0, summary: { added: count('added'), removed: count('removed'), moved: count('moved'), changed: count('changed') }, changes };
}
