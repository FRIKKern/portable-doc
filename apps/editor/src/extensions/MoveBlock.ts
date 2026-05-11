/**
 * A6 — MoveBlock TipTap Extension.
 *
 * Exposes `editor.commands.moveBlock(fromIdx, toIdx)` as a single
 * ProseMirror transaction (`tr.delete().insert()`) so block reorder
 * never re-renders the whole doc via `setContent` (which flashes).
 *
 * The command is the single source of truth for reorder, so:
 *   - the native HTML5 drag handler in `BlockChrome.ts` calls it on
 *     `drop` with `[fromIdx, toIdx]`,
 *   - keyboard reorder via `Cmd+Shift+ArrowUp` / `Cmd+Shift+ArrowDown`
 *     (`addKeyboardShortcuts`) calls it with `[currentIdx, currentIdx ± 1]`.
 *
 * Doc-position math (translate top-level child index → absolute doc
 * position; account for `nodeSize` shifts after delete) lives entirely
 * inside the extension. The drag layer never touches ProseMirror
 * internals — it just hands two integers to a command.
 */
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    moveBlock: {
      /**
       * Move the top-level block at `fromIdx` to land at `toIdx` in the
       * doc's child list. `toIdx` is interpreted in the SLOT semantics
       * sortable APIs use: `toIdx = doc.childCount` means "after the
       * last block"; `toIdx = fromIdx` is a no-op (returns `false`).
       */
      moveBlock: (fromIdx: number, toIdx: number) => ReturnType;
    };
  }
}

/**
 * Find the top-level block index containing the current selection.
 *
 * Walk top-level children accumulating `pos` over each child's
 * `nodeSize`. The cursor `from` lands inside child i when
 * `from < startOfChild_i + nodeSize_i`. Returns `-1` if the selection
 * is somehow detached from any top-level block (shouldn't happen but
 * keeps the keyboard shortcut from blowing up on an empty doc).
 */
export function currentBlockIdx(editor: Editor): number {
  const { from } = editor.state.selection;
  let pos = 0;
  for (let i = 0; i < editor.state.doc.childCount; i++) {
    pos += editor.state.doc.child(i).nodeSize;
    if (from < pos) return i;
  }
  return -1;
}

export const MoveBlock = Extension.create({
  name: 'moveBlock',

  addCommands() {
    return {
      moveBlock:
        (fromIdx: number, toIdx: number) =>
        ({ state, dispatch }) => {
          const doc = state.doc;

          // Cheap guard: anything that would no-op or crash returns
          // `false` so chained `.run()` short-circuits to "nothing
          // happened" rather than dispatching an empty transaction.
          if (fromIdx === toIdx) return false;
          if (fromIdx < 0 || fromIdx >= doc.childCount) return false;
          if (toIdx < 0 || toIdx > doc.childCount) return false;

          const node = doc.child(fromIdx);
          const tr = state.tr;

          // Absolute position of the FROM block in the doc. Top-level
          // children start at offset 0; each prior child contributes
          // its own `nodeSize` to the running total.
          let fromPos = 0;
          for (let i = 0; i < fromIdx; i++) {
            fromPos += doc.child(i).nodeSize;
          }
          const nodeSize = node.nodeSize;

          // Delete the source block from the transaction's doc.
          tr.delete(fromPos, fromPos + nodeSize);

          // After the delete, every position after `fromPos` shifts by
          // `-nodeSize`. Re-walk the MUTATED doc to compute the insert
          // position. `toIdx` is the slot index in the ORIGINAL doc;
          // if it's after `fromIdx`, the deletion bumped its slot down
          // by one.
          const targetIdx = toIdx > fromIdx ? toIdx - 1 : toIdx;
          let toPos = 0;
          for (let i = 0; i < targetIdx; i++) {
            toPos += tr.doc.child(i).nodeSize;
          }

          tr.insert(toPos, node);

          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Cmd+Shift+↑ on macOS / Ctrl+Shift+↑ elsewhere — move the
      // current block up by one slot. Returns `false` (so the binding
      // chain continues) when the block is already at index 0; the
      // command itself short-circuits via the range guard, but
      // returning `false` here lets future extensions chain on it.
      'Mod-Shift-ArrowUp': ({ editor }) => {
        const idx = currentBlockIdx(editor);
        if (idx <= 0) return false;
        return editor.commands.moveBlock(idx, idx - 1);
      },
      'Mod-Shift-ArrowDown': ({ editor }) => {
        const idx = currentBlockIdx(editor);
        if (idx < 0) return false;
        if (idx >= editor.state.doc.childCount - 1) return false;
        // To move "down by one slot" we insert AFTER the next sibling
        // — that slot index in the original doc is `idx + 2`.
        return editor.commands.moveBlock(idx, idx + 2);
      },
    };
  },
});
