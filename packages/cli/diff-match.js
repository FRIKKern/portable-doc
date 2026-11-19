// SPDX-License-Identifier: Apache-2.0
// Which block in one doc is which block in the other, and which pairs moved.
// Linear in the doc's size except the similarity step, which stops after a
// fixed amount of work, so the git driver stays fast on any doc.

import { blockId, blockType, canon, isMap } from './diff-shared.js';

const SIMILAR = 0.5;
/** Work units for the similarity step: one per pair looked at, plus one per distinct word compared. */
export const MAX_SIMILARITY_WORK = 20_000_000;

/** A block's words as a bag: { bag: Map(word → count), total }. Its id and type are not words. */
function wordBag(block) {
  const bag = new Map();
  let total = 0;
  const stack = [block];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === 'string') {
      for (const w of v.split(/\s+/)) if (w) bag.set(w, (bag.get(w) ?? 0) + 1), total++;
    } else if (Array.isArray(v)) for (const x of v) stack.push(x);
    else if (isMap(v)) for (const [k, x] of Object.entries(v)) if (k !== 'id' && k !== 'type') stack.push(x);
  }
  return { bag, total };
}

/**
 * Pairs [i, j] of blocks A[i] and B[j] that are the same block, sorted by j.
 * 1. By id: a non-empty string id, the first block with it on each side.
 * 2. The rest without such an id, in order: first the first unpaired block
 *    equal to it, then the most similar unpaired block of its type (a bag Dice
 *    score of at least 0.5 on their words), until MAX_SIMILARITY_WORK is spent.
 * A block with an id never pairs with a block without one.
 * `stats`, when given, is filled with { canon, work, stopped }: the canon calls of the
 * equality step, the similarity work spent, and whether it stopped at the cap.
 */
export function matchBlocks(A, B, stats = {}) {
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

  // Equal blocks: each canonical form holds a queue of B indexes, taken in order.
  // One canon per block left over: stats.canon counts them.
  stats.canon = 0;
  const queues = new Map();
  for (const j of rest(B, kb)) {
    stats.canon++;
    const c = canon(B[j]);
    if (!queues.has(c)) queues.set(c, { list: [], next: 0 });
    queues.get(c).list.push(j);
  }
  const left = [];
  for (const i of rest(A, ka)) {
    stats.canon++;
    const q = queues.get(canon(A[i]));
    if (q && q.next < q.list.length) {
      const j = q.list[q.next++];
      pairs.push([i, j]);
      usedB.add(j);
    } else left.push(i);
  }

  // Similar blocks of one type, each block's bag built once.
  const byType = new Map();
  for (const q of queues.values()) {
    for (const j of q.list.slice(q.next)) {
      const t = blockType(B[j]);
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push({ j, ...wordBag(B[j]) });
    }
  }
  for (const list of byType.values()) list.sort((p, q) => p.j - q.j);
  let work = 0;
  stats.stopped = false;
  scoring: for (const i of left) {
    const a = wordBag(A[i]);
    let best = null;
    for (const b of byType.get(blockType(A[i])) ?? []) {
      if (++work > MAX_SIMILARITY_WORK) {
        stats.stopped = true;
        break scoring;
      }
      if (usedB.has(b.j)) continue;
      const sum = a.total + b.total;
      if (sum === 0) {
        if (best === null || best.s < 1) best = { j: b.j, s: 1 };
        continue;
      }
      // The best a pair can score, from its sizes alone; skip it when that cannot win.
      const ceiling = (2 * Math.min(a.total, b.total)) / sum;
      if (ceiling < SIMILAR || (best !== null && ceiling <= best.s)) continue;
      const [small, large] = a.bag.size <= b.bag.size ? [a.bag, b.bag] : [b.bag, a.bag];
      work += small.size;
      let common = 0;
      for (const [w, n] of small) common += Math.min(n, large.get(w) ?? 0);
      const s = (2 * common) / sum;
      if (s >= SIMILAR && (best === null || s > best.s)) best = { j: b.j, s };
    }
    if (best) pairs.push([i, best.j]), usedB.add(best.j);
  }
  stats.work = work;
  return pairs.sort((p, q) => p[1] - q[1]);
}

/** The pairs (sorted by j) that keep their order: the longest run increasing in i. The others moved. */
export function inOrder(pairs) {
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
