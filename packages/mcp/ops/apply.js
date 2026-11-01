import { lowerEditorOp } from './intents.js';
import { applyPatch } from './patch.js';

export function applyOp(doc, op) {
  const lowered = lowerEditorOp(Array.isArray(doc) ? doc : doc.blocks, op);
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
