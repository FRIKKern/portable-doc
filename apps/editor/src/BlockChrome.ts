/**
 * A2 — block-chrome DOM helpers.
 *
 * The chrome (drag handle, type label, delete, "+" between-blocks) is plain
 * DOM that lives inside the TipTap node-view wrapper. We do NOT use React
 * here: the node-view runs outside React's reconciler, so any reconciliation
 * cost would be wasted. Three exported helpers keep `withBlockChrome.ts`
 * legible:
 *
 *   renderChromeDom(blockType)
 *     -> builds the toolbar element (drag · label · delete) and the "+"
 *        between-blocks button, returning the wrapper that the node-view
 *        will splice into its `paper-block` parent. Includes the empty
 *        `.paper-block__variant-slot` (A5 populates it).
 *
 *   bindChromeHandlers(parts, editor, getPos)
 *     -> wires the delete button + "+" between-blocks button to TipTap
 *        commands. Keyboard `Enter` activates each focusable control.
 *
 *   updateChromeForSelection(blockEl, selectionEmpty)
 *     -> toggles `.is-selecting` on the `paper-block` wrapper; the CSS
 *        in paper.css then collapses the chrome opacity to 0 while a
 *        text selection is active (grill Q3 — BubbleMenu wins z-stack).
 *
 * Drag binding is deferred to A6; the handle is a button with the right
 * a11y + visual treatment only. Slash menu trigger is A3. Variant chip
 * paint is A5 — the slot exists here, empty.
 */
import type { Editor } from '@tiptap/core';

// ---------------------------------------------------------------------------
// Block-type → human label (for `aria-label` strings + the toolbar label)
// ---------------------------------------------------------------------------

const HUMAN_LABEL: Record<string, string> = {
  paragraph: 'Paragraph',
  heading: 'Heading',
  bulletList: 'List',
  orderedList: 'List',
  blockquote: 'Callout',
  codeBlock: 'Code',
  horizontalRule: 'Divider',
};

export function humanLabelFor(blockType: string): string {
  return HUMAN_LABEL[blockType] ?? 'Block';
}

// ---------------------------------------------------------------------------
// Build the chrome DOM
// ---------------------------------------------------------------------------

export interface ChromeParts {
  /** The toolbar that sits above the block. */
  toolbar: HTMLDivElement;
  /** The drag handle button (no actual drag in A2 — A6 wires dnd-kit). */
  dragBtn: HTMLButtonElement;
  /** The block-type label span. */
  labelEl: HTMLSpanElement;
  /** The variant-chip slot (A5 fills this). */
  variantSlot: HTMLDivElement;
  /** The delete button. */
  deleteBtn: HTMLButtonElement;
  /** The "+" between-blocks button (rendered below the wrapper). */
  insertBtn: HTMLButtonElement;
}

/**
 * Render the chrome DOM for a block of type `blockType` and return the parts
 * so the caller can wire handlers + slot the pieces into the node-view.
 */
export function renderChromeDom(blockType: string): ChromeParts {
  const label = humanLabelFor(blockType);
  const lower = label.toLowerCase();

  const toolbar = document.createElement('div');
  toolbar.className = 'paper-block__chrome';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', `${label} block toolbar`);

  const dragBtn = document.createElement('button');
  dragBtn.type = 'button';
  dragBtn.className = 'paper-block-drag-handle';
  dragBtn.setAttribute('aria-label', `Drag ${lower}`);
  dragBtn.setAttribute('data-block-type', blockType);
  dragBtn.textContent = '⋮⋮'; // ⋮⋮

  const labelEl = document.createElement('span');
  labelEl.className = 'paper-block__label';
  labelEl.textContent = label;

  const variantSlot = document.createElement('div');
  variantSlot.className = 'paper-block__variant-slot';
  variantSlot.setAttribute('data-block-type', blockType);
  // empty in A2 — A5 paints the variant chip into this slot.

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'paper-block-delete';
  deleteBtn.setAttribute('aria-label', `Delete ${lower}`);
  deleteBtn.setAttribute('data-block-type', blockType);
  deleteBtn.textContent = '×'; // ×

  toolbar.append(dragBtn, labelEl, variantSlot, deleteBtn);

  const insertBtn = document.createElement('button');
  insertBtn.type = 'button';
  insertBtn.className = 'paper-block__insert';
  insertBtn.setAttribute('aria-label', 'Insert block below');
  insertBtn.setAttribute('data-block-type', blockType);
  insertBtn.textContent = '+';

  return { toolbar, dragBtn, labelEl, variantSlot, deleteBtn, insertBtn };
}

// ---------------------------------------------------------------------------
// Wire handlers (delete + insert; drag is A6)
// ---------------------------------------------------------------------------

/**
 * Wire the chrome handlers — delete + insert. The drag handle is a
 * keyboard-focusable button with no behavior in A2 (A6 wires drag).
 *
 * `getPos` is the TipTap node-view callback that returns this block's
 * current ProseMirror position; we re-read it on every event so that
 * insertions / deletions higher in the doc don't stale the index.
 */
export function bindChromeHandlers(
  parts: ChromeParts,
  editor: Editor,
  getPos: () => number | undefined,
): void {
  const { deleteBtn, insertBtn } = parts;

  // Delete this block. We use `deleteRange` instead of the
  // setNodeSelection → deleteSelection chain so the operation is a single
  // dispatch that doesn't depend on editor focus state (happy-dom + tests
  // don't reliably propagate focus on synthetic mousedown).
  const deleteThisBlock = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
    const pos = getPos();
    if (pos == null) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    editor.commands.deleteRange({ from: pos, to: pos + node.nodeSize });
  };
  deleteBtn.addEventListener('mousedown', deleteThisBlock);
  deleteBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') deleteThisBlock(e);
  });

  // Insert a paragraph after this block. `insertContentAt` accepts a JSON
  // node; we pass an explicit empty paragraph so the schema doesn't try to
  // wrap our content into a fragment of multiple nodes.
  const insertBelow = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
    const pos = getPos();
    if (pos == null) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    const after = pos + node.nodeSize;
    editor.commands.insertContentAt(after, { type: 'paragraph' });
  };
  insertBtn.addEventListener('mousedown', insertBelow);
  insertBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') insertBelow(e);
  });
}

// ---------------------------------------------------------------------------
// Selection-driven chrome visibility
// ---------------------------------------------------------------------------

/**
 * Toggle `.is-selecting` on the `paper-block` wrapper. When a text selection
 * is non-empty anywhere in the editor we hide block chrome so the BubbleMenu
 * (A4) wins the visual layer — grill Q3.
 */
export function updateChromeForSelection(
  blockEl: HTMLElement,
  selectionEmpty: boolean,
): void {
  if (selectionEmpty) {
    blockEl.classList.remove('is-selecting');
  } else {
    blockEl.classList.add('is-selecting');
  }
}
