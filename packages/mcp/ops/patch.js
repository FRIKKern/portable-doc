import { coerceFieldPatch } from './fields.js';
import { canonical, get, isMap, refusal, same, termOrder } from './terms.js';
import { blockId, directFigureChildId, idExists, lockedAtId, patchAuthoredIds, transform } from './tree.js';

const FIGURE_CHILD = 'figure must contain exactly one child';

const has = (op, ...keys) => keys.every((k) => Object.hasOwn(op, k));

export function applyPatch(docOrBlocks, op) {
  if (isMap(docOrBlocks) && Array.isArray(docOrBlocks.blocks)) {
    const r = applyPatch(docOrBlocks.blocks, op);
    return r.ok ? { ok: true, value: { ...docOrBlocks, blocks: r.value } } : r;
  }
  const r = applyToBlocks(docOrBlocks, op);
  if (!r.ok) return r;
  return checkLockedPlacement(docOrBlocks, r.value, op) ?? checkDuplicateRatchet(docOrBlocks, r.value, op) ?? r;
}

const ok = (value) => ({ ok: true, value });
const fail = (code, target, op) => ({ ok: false, error: refusal(code, target, op) });
const invalid = (op) => ({ ok: false, error: { code: 'invalid_op', op } });

function applyToBlocks(blocks, op) {
  if (!isMap(op)) return invalid(op);
  switch (op.op) {
    case 'append-block':
      if (!has(op, 'block')) break;
      return idExists(blocks, blockId(op.block)) ? fail('duplicate_id', blockId(op.block), 'append-block') : ok([...blocks, op.block]);
    case 'insert-after':
      if (!has(op, 'afterId', 'block')) break;
      return insertAfter(blocks, op.afterId, op.block);
    case 'patch-block':
      if (!has(op, 'id', 'patch') || !isMap(op.patch)) break;
      return patchBlock(blocks, op.id, op.patch);
    case 'replace-block':
      if (!has(op, 'id', 'block')) break;
      return replaceBlock(blocks, op.id, op.block);
    case 'remove-block':
      if (!has(op, 'id')) break;
      return removeBlock(blocks, op.id);
    case 'move-block':
      if (!has(op, 'id')) break;
      return moveBlock(blocks, op.id, get(op, 'after'));
  }
  return invalid(op);
}

function insertAfter(blocks, afterId, block) {
  if (idExists(blocks, blockId(block))) return fail('duplicate_id', blockId(block), 'insert-after');
  if (directFigureChildId(blocks, afterId)) return fail('constraint', FIGURE_CHILD, 'insert-after');
  const r = transform(blocks, afterId, (target) => ({ list: [target, block], flag: false }));
  return r ? ok(r.list) : fail('block_not_found', afterId, 'insert-after');
}

function patchBlock(blocks, id, patch) {
  const r = transform(blocks, id, (target) => {
    if (!isMap(target)) return { list: [target], flag: 'not_a_block' };
    const patchType = get(patch, 'type');
    if (patchType !== null && !same(patchType, get(target, 'type'))) return { list: [target], flag: 'type_mismatch' };
    const { locked, role, ...content } = patch;
    const coerced = coerceFieldPatch(target, content);
    if (!coerced) return { list: [target], flag: 'invalid_value' };
    return { list: [{ ...target, ...coerced, id: get(target, 'id'), type: get(target, 'type') }], flag: false };
  });
  if (!r) return fail('block_not_found', id, 'patch-block');
  if (r.flag === 'type_mismatch') return fail('type_mismatch', id, 'patch-block');
  if (r.flag) return invalid({ op: 'patch-block', id, patch });
  return ok(r.list);
}

function replaceBlock(blocks, id, block) {
  if (lockedAtId(blocks, id)) return fail('locked_block', id, 'replace-block');
  if (directFigureChildId(blocks, id) && !isMap(block)) return fail('constraint', FIGURE_CHILD, 'replace-block');
  const r = transform(blocks, id, () => ({ list: [block], flag: false }));
  return r ? ok(r.list) : fail('block_not_found', id, 'replace-block');
}

function removeBlock(blocks, id) {
  if (lockedAtId(blocks, id)) return fail('locked_block', id, 'remove-block');
  if (directFigureChildId(blocks, id)) return fail('constraint', FIGURE_CHILD, 'remove-block');
  const r = transform(blocks, id, () => ({ list: [], flag: false }));
  return ok(r ? r.list : blocks);
}

function moveBlock(blocks, id, after) {
  if (lockedAtId(blocks, id)) return fail('locked_block', id, 'move-block');
  const at = (anchor) => (b) => same(blockId(b), anchor);
  if (!blocks.some(at(id))) return ok(blocks);
  if (same(after, id)) return ok(blocks);
  if (after !== null && !blocks.some(at(after))) return fail('block_not_found', after, 'move-block');
  const moved = blocks.find(at(id));
  const without = blocks.filter((b) => !at(id)(b));
  if (after === null) return ok([moved, ...without]);
  const idx = without.findIndex(at(after));
  return ok([...without.slice(0, idx + 1), moved, ...without.slice(idx + 1)]);
}

const idKey = (id) => (typeof id === 'string' ? `s${id}` : `j${canonical(id)}`);

function lockedIndex(blocks) {
  const index = new Map();
  blocks.forEach((b, i) => {
    if (isMap(b) && b.locked === true) index.set(idKey(blockId(b)), { id: blockId(b), idx: i });
  });
  return index;
}

function checkLockedPlacement(before, after, op) {
  const locked = lockedIndex(before);
  if (locked.size === 0) return null;
  const now = lockedIndex(after);
  const moved = [...locked].filter(([key, { idx }]) => now.get(key)?.idx !== idx).map(([, e]) => e.id).sort(termOrder);
  return moved.length ? fail('locked_block', moved[0], get(op, 'op')) : null;
}

function checkDuplicateRatchet(before, after, op) {
  const tally = new Map();
  for (const id of patchAuthoredIds(before)) tally.set(id, (tally.get(id) ?? 0) - 1);
  const ids = patchAuthoredIds(after);
  const now = new Map();
  for (const id of ids) now.set(id, (now.get(id) ?? 0) + 1);
  const dup = ids.find((id) => now.get(id) > 1 && now.get(id) + (tally.get(id) ?? 0) > 0);
  return dup === undefined ? null : fail('duplicate_id', dup, op.op);
}
