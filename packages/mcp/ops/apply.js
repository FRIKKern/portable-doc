import { lowerEditorOp } from './intents.js';
import { applyPatch } from './patch.js';
import { get, refusal } from './terms.js';

export function applyOp(doc, op) {
  const blocks = Array.isArray(doc) ? doc : doc?.blocks;
  if (!Array.isArray(blocks)) return { ok: false, error: refusal('invalid_doc', null, get(op, 'op')) };
  const lowered = lowerEditorOp(blocks, op);
  return lowered.ok ? applyPatch(doc, lowered.value) : lowered;
}

export function applyOps(doc, ops) {
  let current = doc;
  for (const [index, op] of ops.entries()) {
    const r = applyOp(current, op);
    if (!r.ok) return { ok: false, index, error: r.error };
    current = r.value;
  }
  return { ok: true, value: current };
}
