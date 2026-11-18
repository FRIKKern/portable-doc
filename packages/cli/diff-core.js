// SPDX-License-Identifier: Apache-2.0
// Compare two PortableDoc docs block by block: match the blocks, then name
// what was added, removed, moved and changed, down to the word or field.
// Pure: no I/O, no escaping. diff.js prints the result.

import { toMarkdown } from '@portable-doc/text';

const MAX_CELLS = 4_000_000;
const SIMILAR = 0.5;
const MAX_SCORED = 250_000;

const isMap = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** JSON with keys sorted at every level: equal for docs that differ only in key order. */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isMap(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

/** { blocks, rest } of a blocks array or a { blocks: [...] } doc, or null when it is neither. */
export function asDoc(value) {
  if (Array.isArray(value)) return { blocks: value, rest: {} };
  if (!isMap(value) || !Array.isArray(value.blocks)) return null;
  const { blocks, ...rest } = value;
  return { blocks, rest };
}

export const blockType = (b) => (isMap(b) && typeof b.type === 'string' && b.type !== '' ? b.type : '(not a block)');
const blockId = (b) => (isMap(b) && typeof b.id === 'string' && b.id !== '' ? b.id : null);

// ---- words ----

const tokens = (s) => s.match(/\s+|[^\s]+/g) ?? [];

/** A word diff of two strings: [{ op: '=' | '-' | '+', text }], runs merged, removals before additions. */
export function wordDiff(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  let ops;
  if (x.length * y.length > MAX_CELLS) ops = [...x.map((t) => ['-', t]), ...y.map((t) => ['+', t])];
  else {
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

/** What differs between two values, as [{ path, from?, to? } | { path, words }]; a side that is absent has no from or to. */
export function fieldDiff(a, b, at = '', out = []) {
  if (canon(a) === canon(b)) return out;
  if (a !== undefined && b !== undefined) {
    if (typeof a === 'string' && typeof b === 'string' && /\s/.test(a + b)) return out.push({ path: at, words: wordDiff(a, b) }), out;
    if (/(^|\.)content$/.test(at) && Array.isArray(a) && Array.isArray(b)) {
      const [x, y] = [inlineText(a), inlineText(b)];
      if (x !== y) return out.push({ path: at, words: wordDiff(x, y) }), out;
    }
    if (isMap(a) && isMap(b)) {
      for (const k of [...Object.keys(a), ...Object.keys(b).filter((k) => !Object.hasOwn(a, k))]) fieldDiff(a[k], b[k], pathOf(at, k), out);
      return out;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.max(a.length, b.length); i++) fieldDiff(a[i], b[i], pathOf(at, i), out);
      return out;
    }
  }
  out.push({ path: at, ...(a !== undefined && { from: a }), ...(b !== undefined && { to: b }) });
  return out;
}

// ---- matching ----

function words(v, out = []) {
  if (typeof v === 'string') out.push(...v.split(/\s+/).filter(Boolean));
  else if (Array.isArray(v)) v.forEach((x) => words(x, out));
  else if (isMap(v)) for (const [k, x] of Object.entries(v)) if (k !== 'id' && k !== 'type') words(x, out);
  return out;
}

/** 0..1: how many words two blocks share (a bag Dice score); 1 for two blocks with no words. */
export function similarity(a, b) {
  const [x, y] = [words(a), words(b)];
  if (!x.length && !y.length) return 1;
  const bag = new Map();
  for (const w of x) bag.set(w, (bag.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of y) if (bag.get(w) > 0) bag.set(w, bag.get(w) - 1), common++;
  return (2 * common) / (x.length + y.length);
}

/**
 * Pairs [i, j] of blocks A[i] and B[j] that are the same block.
 * 1. By id: a non-empty string id, the first block with it on each side.
 * 2. The rest without such an id, in order: first a block equal to it, then
 *    the most similar block of its type (at least half its words shared),
 *    unless that means scoring more than MAX_SCORED pairs.
 * A block with an id never matches a block without one.
 */
export function matchBlocks(A, B) {
  const keyed = (list) => {
    const seen = new Map();
    list.forEach((b, i) => {
      const id = blockId(b);
      if (id !== null && !seen.has(id)) seen.set(id, i);
    });
    return seen;
  };
  const [ka, kb] = [keyed(A), keyed(B)];
  const pairs = [];
  const usedB = new Set();
  for (const [id, i] of ka) if (kb.has(id)) pairs.push([i, kb.get(id)]), usedB.add(kb.get(id));
  const rest = (list, keys) => list.map((_, i) => i).filter((i) => keys.get(blockId(list[i])) !== i);
  const restA = rest(A, ka);
  const restB = rest(B, kb);
  const left = new Set(restA);
  const canonB = new Map(restB.map((j) => [j, canon(B[j])]));
  for (const i of restA) {
    const c = canon(A[i]);
    const j = restB.find((j) => !usedB.has(j) && canonB.get(j) === c);
    if (j !== undefined) pairs.push([i, j]), usedB.add(j), left.delete(i);
  }
  // Scoring every pair costs |A| × |B|; past that, unmatched blocks stay added and removed.
  if (left.size * restB.length > MAX_SCORED) return pairs.sort((p, q) => p[1] - q[1]);
  for (const i of left) {
    let best = null;
    for (const j of restB) {
      if (usedB.has(j) || blockType(B[j]) !== blockType(A[i])) continue;
      const s = similarity(A[i], B[j]);
      if (s >= SIMILAR && (best === null || s > best.s)) best = { j, s };
    }
    if (best) pairs.push([i, best.j]), usedB.add(best.j);
  }
  return pairs.sort((p, q) => p[1] - q[1]);
}

/** The pairs (sorted by j) that keep their order: the longest run increasing in i. The others moved. */
function inOrder(pairs) {
  const tails = [];
  const prev = new Array(pairs.length);
  pairs.forEach(([i], k) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][0] < i) lo = mid + 1;
      else hi = mid;
    }
    prev[k] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = k;
  });
  const keep = new Set();
  for (let k = tails.at(-1) ?? -1; k !== -1; k = prev[k]) keep.add(k);
  return keep;
}

/**
 * Every difference between two docs, in a stable order: the doc's own keys
 * first, then blocks by position (a removed block by its old one).
 * Change: { kind: 'doc' | 'added' | 'removed' | 'moved' | 'changed', type, id, from, to, fields }.
 */
export function diffDocs(a, b) {
  const changes = [];
  const docFields = fieldDiff(a.rest, b.rest);
  if (docFields.length) changes.push({ kind: 'doc', type: null, id: null, from: null, to: null, fields: docFields });
  const pairs = matchBlocks(a.blocks, b.blocks);
  const keep = inOrder(pairs);
  const block = (kind, blk, from, to, fields = []) => ({ kind, type: blockType(blk), id: blockId(blk), from, to, fields });
  const rows = [];
  pairs.forEach(([i, j], k) => {
    const fields = fieldDiff(a.blocks[i], b.blocks[j]);
    if (!keep.has(k)) rows.push([j, 1, block('moved', b.blocks[j], i, j, fields)]);
    else if (fields.length) rows.push([j, 1, block('changed', b.blocks[j], i, j, fields)]);
  });
  const matchedA = new Set(pairs.map(([i]) => i));
  const matchedB = new Set(pairs.map(([, j]) => j));
  a.blocks.forEach((blk, i) => matchedA.has(i) || rows.push([i, 0, block('removed', blk, i, null)]));
  b.blocks.forEach((blk, j) => matchedB.has(j) || rows.push([j, 2, block('added', blk, null, j)]));
  rows.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  changes.push(...rows.map(([, , c]) => c));
  const count = (kind) => changes.filter((c) => c.kind === kind).length;
  return { equal: changes.length === 0, summary: { added: count('added'), removed: count('removed'), moved: count('moved'), changed: count('changed') }, changes };
}
