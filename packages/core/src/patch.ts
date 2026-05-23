/**
 * Pure, immutable patch operations over a {@link PortableDoc}.
 *
 * `applyDocPatch` is the headless core the editor reducer should have been:
 *   - pure (no React, no module state, never throws),
 *   - recursive (a block can live inside a `section` at any depth),
 *   - type-safe on patch (no cross-type field bleed; `id`+`type` are immutable).
 *
 * Immutability is structural sharing — only the path from the document root
 * down to the target block is copied; every untouched subtree keeps its
 * identity. Failures are structured returns (`applied:false` + `error`),
 * never thrown exceptions and never silent no-ops.
 */

import type { Block, PortableDoc, SectionBlock } from './ast.js';

export type DocPatchOp =
  | { op: 'append-block'; block: Block }
  | { op: 'insert-after'; afterId: string; block: Block }
  | { op: 'patch-block'; id: string; patch: Partial<Block> }
  | { op: 'replace-block'; id: string; block: Block }
  | { op: 'remove-block'; id: string };

export type DocPatchError = 'block-not-found' | 'type-mismatch' | 'duplicate-id';

export interface DocPatchResult {
  doc: PortableDoc;
  applied: boolean;
  error?: DocPatchError;
}

/** True when `id` names any block anywhere in `blocks` (recurses sections). */
function idExists(blocks: Block[], id: string): boolean {
  for (const block of blocks) {
    if (block.id === id) return true;
    if (block.type === 'section' && idExists(block.blocks, id)) return true;
  }
  return false;
}

/**
 * Transform a block list, applying `fn` to the matching block at any depth.
 *
 * `fn` returns the replacement block list for the *array slot* it was handed
 * (one block in → zero or more blocks out), letting a single helper drive
 * patch (1→1), replace (1→1), insert-after (1→2) and remove (1→0).
 *
 * Returns `null` (sentinel, distinct from the empty array) when `id` was not
 * found at this level or below — so callers can tell "not found" from "found
 * and removed". Untouched subtrees are returned by identity (structural
 * sharing); only the branch containing the target is rebuilt.
 */
function transformAtId(
  blocks: Block[],
  id: string,
  fn: (block: Block) => Block[],
): Block[] | null {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i] as Block;
    if (block.id === id) {
      const replacement = fn(block);
      return [...blocks.slice(0, i), ...replacement, ...blocks.slice(i + 1)];
    }
    if (block.type === 'section') {
      const nestedBlocks = transformAtId(block.blocks, id, fn);
      if (nestedBlocks !== null) {
        const nextSection: SectionBlock = { ...block, blocks: nestedBlocks };
        return [...blocks.slice(0, i), nextSection, ...blocks.slice(i + 1)];
      }
    }
  }
  return null;
}

export function applyDocPatch(doc: PortableDoc, op: DocPatchOp): DocPatchResult {
  switch (op.op) {
    case 'append-block': {
      if (idExists(doc.blocks, op.block.id)) {
        return { doc, applied: false, error: 'duplicate-id' };
      }
      return { doc: { ...doc, blocks: [...doc.blocks, op.block] }, applied: true };
    }

    case 'insert-after': {
      if (idExists(doc.blocks, op.block.id)) {
        return { doc, applied: false, error: 'duplicate-id' };
      }
      const blocks = transformAtId(doc.blocks, op.afterId, (target) => [target, op.block]);
      if (blocks === null) {
        return { doc, applied: false, error: 'block-not-found' };
      }
      return { doc: { ...doc, blocks }, applied: true };
    }

    case 'patch-block': {
      let typeMismatch = false;
      const blocks = transformAtId(doc.blocks, op.id, (target) => {
        const patch = op.patch as Partial<Block> & { type?: Block['type'] };
        if (patch.type !== undefined && patch.type !== target.type) {
          typeMismatch = true;
          return [target];
        }
        // Same-type shallow merge, then re-pin id+type so a patch can never
        // mutate the block's identity or kind. Same-type means same shape —
        // no foreign fields can enter, so there is no cross-type bleed.
        const merged = { ...target, ...patch, id: target.id, type: target.type };
        return [merged as Block];
      });
      if (blocks === null) {
        return { doc, applied: false, error: 'block-not-found' };
      }
      if (typeMismatch) {
        return { doc, applied: false, error: 'type-mismatch' };
      }
      return { doc: { ...doc, blocks }, applied: true };
    }

    case 'replace-block': {
      const blocks = transformAtId(doc.blocks, op.id, () => [op.block]);
      if (blocks === null) {
        return { doc, applied: false, error: 'block-not-found' };
      }
      return { doc: { ...doc, blocks }, applied: true };
    }

    case 'remove-block': {
      const blocks = transformAtId(doc.blocks, op.id, () => []);
      if (blocks === null) {
        return { doc, applied: false, error: 'block-not-found' };
      }
      return { doc: { ...doc, blocks }, applied: true };
    }
  }
}
