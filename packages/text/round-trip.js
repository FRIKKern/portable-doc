// SPDX-License-Identifier: Apache-2.0
// toMarkdown's round-trip mode: Markdown that fromMarkdown reads back as the same blocks,
// for every block import accepts.
// Decided by doing, never by a list of types: each block is written, read back and
// compared, so a new block type is kept the day import can read it back.

import { checkFence, fromMarkdown } from './from-markdown.js';
import { MAX_NEST } from './from-markdown-inline.js';
import { isMap } from './util.js';

const sortKeys = (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]])) : value;
/** The same JSON value, whatever the order of its keys. */
const same = (a, b) => JSON.stringify(a, sortKeys) === JSON.stringify(b, sortKeys);
const readsBack = (markdown, blocks) => same(fromMarkdown(markdown), blocks);

/** A block as a ```portabledoc fence holding it, in the form of a code block for the readable writer. */
const fenced = (block) => ({ type: 'code', lang: 'portabledoc', value: JSON.stringify([block]) });

/** A callout's body, when it has blocks: import reads a `> [!tone]` quote's blocks back into it. */
const calloutBody = (b) => (b.type === 'callout' && isMap(b.slots) && Array.isArray(b.slots.body) && b.slots.body.length ? b.slots.body : null);
/** How many callouts deep a block's callouts in callouts go, counted to MAX_NEST + 1. */
function calloutDepth(block) {
  let n = 0;
  for (let at = [block]; n <= MAX_NEST; n++) {
    at = at.flatMap((b) => (isMap(b) && calloutBody(b)) || []);
    if (!at.length) break;
  }
  return n;
}

/**
 * A callout without its body: what its own `> [!tone]` line holds, and what import reads from
 * that line alone (no `slots` when nothing else is in it).
 */
function head(b) {
  const { slots, ...rest } = b;
  if (!isMap(slots)) return rest;
  const { body: _body, ...others } = slots;
  return Object.keys(others).length ? { ...rest, slots: others } : rest;
}

/**
 * One list of blocks, the doc's or a callout's body, planned: each kept block's entry is the
 * block (its own Markdown), a fence of it, or, for a callout, the callout with its body planned
 * in turn (`levels` maps that entry to its body's level). `lost` maps a place in `list` to why
 * the block there is not kept; `lossy` is set when it, or a level in it, lists one.
 *
 * Each level is checked on its own, a planned callout in it by its `> [!tone]` line alone: the
 * blocks in a quote read as they do outside it, so no level reads back what is under it again,
 * and the whole is read back once at the end (roundTrip).
 */
function planLevel(list, base, write, levels, depth = 0) {
  const lost = new Map();
  const kept = [];
  list.forEach((block, at) => (isMap(block) ? kept.push({ at, block }) : lost.set(at, 'not-a-block')));
  const blocks = kept.map(({ block }) => block);
  const level = { base, list, kept, blocks, lost, plan: [], lossy: false };
  const fence = (i) => {
    const check = checkFence([blocks[i]], new Set());
    if (check.reason) return lost.set(kept[i].at, check.reason), blocks[i];
    const f = fenced(blocks[i]);
    return readsBack(write([f]), [blocks[i]]) ? f : (lost.set(kept[i].at, 'changed'), blocks[i]);
  };
  // A callout with a body, in its own Markdown, its body planned as a level of its own: each
  // block in it is itself, a fence, or listed under its own path. When part of the body cannot
  // be kept, a fence of the whole callout is used instead where import splices it. Only to
  // MAX_NEST callouts deep, as far as import reads quotes in quotes.
  const nest = (i) => {
    if (!readsBack(write([head(blocks[i])]), [head(blocks[i])])) return fence(i);
    const inner = planLevel(blocks[i].slots.body, `${base}/${kept[i].at}/slots/body`, write, levels, depth + 1);
    if (inner.lossy && !checkFence([blocks[i]], new Set()).reason) return fence(i);
    const entry = { ...blocks[i], slots: { ...blocks[i].slots, body: inner.plan } };
    levels.set(entry, inner);
    return entry;
  };
  const own = (i) => (readsBack(write([blocks[i]]), [blocks[i]]) ? blocks[i] : fence(i));
  level.plan = blocks.map((block, i) => (calloutBody(block) && depth + calloutDepth(block) <= MAX_NEST ? nest(i) : own(i)));
  const { plan } = level;
  // A planned callout stands in as its line alone, and is never fenced for its neighbours.
  const shown = (entry) => (levels.has(entry) ? head(entry) : entry);
  const wanted = (i) => (levels.has(plan[i]) ? head(blocks[i]) : blocks[i]);
  const lossyAt = (i) => lost.has(kept[i].at) || levels.get(plan[i])?.lossy === true;
  if (!readsBack(write(plan.map(shown)), blocks.map((_, i) => wanted(i)))) {
    for (let i = 1; i < plan.length; i++) {
      if (plan[i] !== blocks[i] || lossyAt(i) || lossyAt(i - 1)) continue;
      if (!readsBack(write([shown(plan[i - 1]), plan[i]]), [wanted(i - 1), blocks[i]])) plan[i] = fence(i);
    }
  }
  level.lossy = plan.some((_, i) => lossyAt(i)) || lost.size > 0;
  return level;
}

/** Whether a level, or one nested in it, lists a block it cannot keep, as it stands now. */
const lossy = (level, levels) => level.lost.size > 0 || level.plan.some((entry) => levels.has(entry) && lossy(levels.get(entry), levels));

// Fences are counted in the order import reads them, a callout's body where the callout is, so
// one that reuses an earlier fence's id is lost, and written as its block.
function claimIds(level, used, levels) {
  level.plan.forEach((entry, i) => {
    if (entry === level.blocks[i]) return;
    if (levels.has(entry)) return claimIds(levels.get(entry), used, levels);
    const check = checkFence([level.blocks[i]], used);
    if (check.reason) return level.lost.set(level.kept[i].at, check.reason), (level.plan[i] = level.blocks[i]);
    for (const id of check.ids) used.add(id);
  });
}

/** Every block a level and those nested in it could not keep, in document order, as `lost` lists them. */
function collect(level, levels, out = []) {
  const index = new Map(level.kept.map(({ at }, i) => [at, i]));
  level.list.forEach((block, at) => {
    if (level.lost.has(at)) {
      return out.push({
        path: `${level.base}/${at}`,
        id: isMap(block) && typeof block.id === 'string' ? block.id : null,
        type: isMap(block) && typeof block.type === 'string' ? block.type : null,
        reason: level.lost.get(at),
      });
    }
    const inner = levels.get(level.plan[index.get(at)]);
    if (inner) collect(inner, levels, out);
  });
  return out;
}

/**
 * `doc`'s blocks as Markdown that fromMarkdown reads back as exactly those blocks: ids,
 * inline shapes, every field. `write` is the writer (blocks → Markdown), which writes a callout
 * as `> [!tone]` in this mode. Returns { markdown, lost }: `lost` lists each block it could not
 * keep as { path, id, type, reason }, in the shape of the importer's kept-back fences, and is
 * empty when the whole comes back.
 *
 * Each block is written in its own Markdown when that reads back as the block, else, for a
 * callout with a body, in its own Markdown with each block of its body decided the same way,
 * else as a portabledoc fence when import splices that back (checkFence, the importer's own
 * rule). A block neither brings back keeps its own form and is listed, with the fence's reason;
 * inside a callout's body its path is the callout's plus `/slots/body/<n>`. Then each list is
 * read back whole: where a block and the one before it read back as something else together
 * (an emphasised paragraph right after a diagram reads as its caption), the second is fenced.
 * Fences are counted in order, as import counts them, so one that reuses an earlier fence's id
 * is lost. Never throws for a lost block.
 */
export function roundTrip(doc, write) {
  const levels = new Map();
  const top = planLevel(doc, '/blocks', write, levels);
  claimIds(top, new Set(), levels);
  const markdown = write(top.plan);
  // Never silently lossy: if the whole still does not come back and no block is listed, list
  // every block written in its own form and every callout written so, the only ones a neighbour
  // can have changed.
  if (!lossy(top, levels) && !readsBack(markdown, top.blocks)) top.plan.forEach((entry, i) => (entry === top.blocks[i] || levels.has(entry)) && top.lost.set(top.kept[i].at, 'neighbours'));
  return { markdown, lost: collect(top, levels) };
}
