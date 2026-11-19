// SPDX-License-Identifier: Apache-2.0
// toMarkdown's lossless mode: Markdown that fromMarkdown reads back as the same blocks.
// Decided by doing, never by a list of types: each block is written, read back and
// compared, so a new block type is kept the day import can read it back.

import { checkFence, fromMarkdown } from './from-markdown.js';
import { isMap } from './util.js';

const sortKeys = (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]])) : value;
/** The same JSON value, whatever the order of its keys. */
const same = (a, b) => JSON.stringify(a, sortKeys) === JSON.stringify(b, sortKeys);
const readsBack = (markdown, blocks) => same(fromMarkdown(markdown), blocks);

/** A block as a ```portabledoc fence holding it, in the form of a code block for the readable writer. */
const fenced = (block) => ({ type: 'code', lang: 'portabledoc', value: JSON.stringify([block]) });

/**
 * `doc`'s blocks as Markdown that fromMarkdown reads back as exactly those blocks: ids,
 * inline shapes, every field. `write` is the readable writer (blocks → Markdown). Returns
 * { markdown, lost }: `lost` lists each block it could not keep as { path, id, type, reason },
 * in the shape of the importer's kept-back fences, and is empty when the whole comes back.
 *
 * Each block is written in its own Markdown form when that reads back as the block, else as
 * a portabledoc fence when import splices that back (checkFence, the importer's own rule).
 * A block neither brings back keeps its own form and is listed, with the fence's reason.
 * Then the whole is read back: where a block and the one before it read back as something
 * else together (an emphasised paragraph right after a diagram reads as its caption), the
 * second is fenced. Fences are counted in order, as import counts them, so one that reuses
 * an earlier fence's id is lost. Never throws for a lost block.
 */
export function lossless(doc, write) {
  const entries = doc.map((block, at) => ({ at, block }));
  const lost = new Map();
  for (const { at, block } of entries) if (!isMap(block)) lost.set(at, 'not-a-block');
  const kept = entries.filter(({ at }) => !lost.has(at));
  const blocks = kept.map(({ block }) => block);
  const fence = (i) => {
    const check = checkFence([blocks[i]], new Set());
    if (check.reason) return lost.set(kept[i].at, check.reason), blocks[i];
    const f = fenced(blocks[i]);
    return readsBack(write([f]), [blocks[i]]) ? f : (lost.set(kept[i].at, 'changed'), blocks[i]);
  };
  const plan = blocks.map((block, i) => (readsBack(write([block]), [block]) ? block : fence(i)));
  if (!readsBack(write(plan), blocks)) {
    for (let i = 1; i < plan.length; i++) {
      if (plan[i] === blocks[i] && !lost.has(kept[i].at) && !readsBack(write([plan[i - 1], plan[i]]), [blocks[i - 1], blocks[i]])) plan[i] = fence(i);
    }
  }
  const used = new Set();
  plan.forEach((entry, i) => {
    if (entry === blocks[i]) return;
    const check = checkFence([blocks[i]], used);
    if (check.reason) return lost.set(kept[i].at, check.reason), (plan[i] = blocks[i]);
    for (const id of check.ids) used.add(id);
  });
  const markdown = write(plan);
  // Never silently lossy: if the whole still does not come back and no block is listed, list
  // every block written in its own form, the only ones a neighbour can have changed.
  if (lost.size === 0 && !readsBack(markdown, blocks)) plan.forEach((entry, i) => entry === blocks[i] && lost.set(kept[i].at, 'neighbours'));
  const list = [...lost].sort(([a], [b]) => a - b).map(([at, reason]) => ({
    path: `/blocks/${at}`,
    id: isMap(doc[at]) && typeof doc[at].id === 'string' ? doc[at].id : null,
    type: isMap(doc[at]) && typeof doc[at].type === 'string' ? doc[at].type : null,
    reason,
  }));
  return { markdown, lost: list };
}
