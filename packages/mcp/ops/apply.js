import { lowerEditorOp } from './intents.js';
import { applyPatch, foldBatch } from './patch.js';
import { withDecodeMemo } from './persist.js';
import { get, refusal } from './terms.js';

export function applyOp(doc, op) {
  const lowered = lower(doc, op);
  return lowered.ok ? applyPatch(doc, lowered.value) : lowered;
}

export const applyOps = (doc, ops) => withDecodeMemo(() => foldBatch(doc, ops, lower));

function lower(doc, op) {
  const blocks = Array.isArray(doc) ? doc : doc?.blocks;
  if (!Array.isArray(blocks)) return { ok: false, error: refusal('invalid_doc', null, get(op, 'op')) };
  return lowerEditorOp(blocks, op);
}
