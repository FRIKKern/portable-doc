/**
 * A2 — block-chrome DOM helpers; A5 — VariantChip mount bridge;
 * A6 — native HTML5 drag wiring + drop indicator.
 *
 * The chrome (drag handle, type label, delete, "+" between-blocks) is plain
 * DOM that lives inside the TipTap node-view wrapper. We do NOT use React
 * here: the node-view runs outside React's reconciler, so any reconciliation
 * cost would be wasted. Helpers:
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
 *   mountVariantChip(slot, blockType, attrs, onChange) -> handle
 *     -> A5 bridge. Mounts the React VariantChip component into the
 *        plain-DOM `paper-block__variant-slot` element via
 *        `ReactDOM.createRoot`. The returned handle exposes `update(attrs)`
 *        and `unmount()` for the NodeView's lifecycle. Only fires for
 *        block types whose PortableDoc name is callout/action/section/code
 *        (TipTap names are translated by `pdBlockTypeFor`).
 *
 *   bindDragHandlers(parts, wrapper, editor, getBlockIdx)
 *     -> A6. Wires the drag handle to native HTML5 drag-and-drop. The
 *        handle gets `draggable="true"` + `dragstart` (which writes the
 *        source idx into `DataTransfer`); the wrapper gets `dragover`
 *        (which paints the drop indicator above/below itself based on
 *        the pointer's vertical position relative to the wrapper rect)
 *        and `drop` (which calls `editor.commands.moveBlock(from, to)`).
 *        Slash menu trigger is A3.
 */
import type { Editor } from '@tiptap/core';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VariantChip } from './VariantChip.js';

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
  /** The drag handle button (A6 wires native HTML5 drag onto it). */
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
  // A6 — native HTML5 drag opt-in. The wrapper's dragstart handler reads
  // the source block index from `data-block-idx` (set in withBlockChrome's
  // NodeView `update`); the handle's title surfaces the keyboard fallback.
  dragBtn.setAttribute('draggable', 'true');
  dragBtn.setAttribute(
    'title',
    `Drag to reorder · Cmd+Shift+↑↓ from any cursor in the ${lower}`,
  );
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

  // Insert an empty paragraph after this block, drop the caret into it,
  // and type `/` so the slash menu (A3) opens immediately. The writer
  // gets the same block vocabulary they'd see by typing `/` in any
  // empty paragraph — heading, list, callout, code, etc. — instead of
  // the old behavior of always inserting a paragraph and forcing them
  // to retype `/` themselves.
  const insertBelow = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
    const pos = getPos();
    if (pos == null) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    const after = pos + node.nodeSize;
    // Chain the three operations into one TipTap pipeline so the
    // slash-trigger sees the editor in the post-insert state (with the
    // caret already inside the new paragraph). `insertContentAt` adds
    // the paragraph; `setTextSelection(after + 1)` lands the caret at
    // the start of that paragraph's content; `insertContent('/')`
    // writes the trigger character that opens the slash menu.
    editor
      .chain()
      .focus()
      .insertContentAt(after, { type: 'paragraph' })
      .setTextSelection(after + 1)
      .insertContent('/')
      .run();
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

// ---------------------------------------------------------------------------
// A5 — VariantChip mount bridge (React → plain-DOM slot)
// ---------------------------------------------------------------------------

/** Map a TipTap node-name to its PortableDoc block type (the name the
 *  variant catalog keys on). Returns `null` for nodes without variants
 *  (paragraph, heading, list, divider). */
export function pdBlockTypeFor(tiptapName: string): string | null {
  switch (tiptapName) {
    case 'blockquote':
      return 'callout';
    case 'codeBlock':
      return 'code';
    // A5 wires only the two TipTap-native variant types. action + section
    // are first-class PortableDoc types but ship as their own TipTap nodes
    // in a later task; VariantChip itself supports them via direct
    // blockType prop, so unit tests cover all four.
    default:
      return null;
  }
}

export interface VariantChipHandle {
  /** Re-render with a fresh attrs object. */
  update(attrs: Record<string, unknown>): void;
  /** Tear down the React root and detach. */
  unmount(): void;
}

/**
 * Mount the React VariantChip into a chrome's variant slot.
 *
 * Returns a handle the NodeView holds onto for re-renders on attribute
 * changes and for cleanup on `destroy`. Returns `null` when the block type
 * has no variants (caller can skip without branching here).
 *
 * The bridge isolates the React side: the NodeView stays plain-DOM, the
 * chip stays React. `createRoot` is called exactly once per slot.
 */
export function mountVariantChip(
  slot: HTMLElement,
  pdBlockType: string,
  initialAttrs: Record<string, unknown>,
  onChange: (next: Record<string, string>) => void,
): VariantChipHandle | null {
  // Guardrail: only the four PortableDoc variant types render anything.
  // VariantChip itself returns null for non-variant types, but checking
  // here avoids an unnecessary createRoot allocation.
  const VARIANT_TYPES = new Set(['callout', 'action', 'section', 'code']);
  if (!VARIANT_TYPES.has(pdBlockType)) return null;

  const root: Root = createRoot(slot);
  let currentAttrs = initialAttrs;
  let pendingRender = false;
  let unmounted = false;

  // Defer renders to a microtask so root.render() is never called during
  // ProseMirror's NodeView update cycle (which can itself be inside a
  // React render via @tiptap/react's hooks). A synchronous render in
  // that window fires DOM events during reconciliation that re-trigger
  // ProseMirror transactions → another NodeView.update → another
  // chipHandle.update → … 4000+ slot churn events per click on the
  // editor. Coalesce: multiple update() calls in the same tick only
  // produce one render with the latest attrs.
  const flushRender = (): void => {
    pendingRender = false;
    if (unmounted) return;
    root.render(
      createElement(VariantChip, {
        blockType: pdBlockType,
        attrs: currentAttrs,
        onChange,
      }),
    );
  };
  const scheduleRender = (): void => {
    if (pendingRender) return;
    pendingRender = true;
    queueMicrotask(flushRender);
  };
  scheduleRender();

  return {
    update(attrs: Record<string, unknown>) {
      currentAttrs = attrs;
      scheduleRender();
    },
    unmount() {
      // Defer unmount for the same reason — NodeView.destroy() can fire
      // mid-render. queueMicrotask gets us safely out of the React frame.
      unmounted = true;
      queueMicrotask(() => root.unmount());
    },
  };
}

// ---------------------------------------------------------------------------
// A6 — native HTML5 drag wiring + drop indicator
// ---------------------------------------------------------------------------

/** Data-transfer MIME the drag pipeline uses to carry the source idx.
 *  Plain `text/plain` would collide with anything else the page drops
 *  into the editor (URLs, copied text); a custom MIME keeps the channel
 *  unambiguous. */
const DRAG_MIME = 'application/x-paper-block-idx';

/** Returned by `bindDragHandlers` so the NodeView can detach all
 *  listeners on `destroy` without re-deriving handler identity. */
export interface DragHandle {
  destroy(): void;
}

/**
 * Wire native HTML5 drag-and-drop onto a block's chrome.
 *
 * The handle (the `⋮⋮` button) gets `dragstart` — it writes the source
 * index into the `DataTransfer` payload. The wrapper itself listens for
 * `dragover` (paint the drop-indicator above or below depending on which
 * half of the wrapper the pointer is over) and `drop` (read the source
 * idx out of the payload, compute the slot-style `toIdx`, and call
 * `editor.commands.moveBlock(fromIdx, toIdx)`).
 *
 * `getBlockIdx` returns this block's current top-level index — re-read
 * lazily on every event so inserts/deletes above don't stale the value.
 */
export function bindDragHandlers(
  parts: ChromeParts,
  wrapper: HTMLElement,
  editor: Editor,
  getBlockIdx: () => number | undefined,
): DragHandle {
  const { dragBtn } = parts;

  // The drop indicator is a singleton per-wrapper: one absolutely-
  // positioned rule that we move between the wrapper's top edge and
  // bottom edge on hover. Building it lazily keeps the rest-state
  // DOM identical to A5 (the existing chrome specs count children).
  let indicator: HTMLDivElement | null = null;
  const ensureIndicator = (): HTMLDivElement => {
    if (indicator) return indicator;
    const el = document.createElement('div');
    el.className = 'paper-drop-indicator';
    el.setAttribute('aria-hidden', 'true');
    indicator = el;
    return el;
  };
  const hideIndicator = (): void => {
    if (indicator && indicator.parentNode === wrapper) {
      wrapper.removeChild(indicator);
    }
  };
  const showIndicator = (side: 'above' | 'below'): void => {
    const el = ensureIndicator();
    el.dataset.side = side;
    if (el.parentNode !== wrapper) wrapper.appendChild(el);
  };

  // ---- dragstart on the handle ----
  // Writes the source block idx into `DataTransfer` so the drop target
  // (any other block's wrapper) can read it back. `effectAllowed=move`
  // keeps macOS from showing the "+" copy cursor.
  const onDragStart = (e: DragEvent): void => {
    const idx = getBlockIdx();
    if (idx == null) return;
    const dt = e.dataTransfer;
    if (!dt) return;
    dt.setData(DRAG_MIME, String(idx));
    dt.effectAllowed = 'move';
    wrapper.classList.add('is-dragging');
  };
  const onDragEnd = (): void => {
    wrapper.classList.remove('is-dragging');
    hideIndicator();
  };
  dragBtn.addEventListener('dragstart', onDragStart);
  dragBtn.addEventListener('dragend', onDragEnd);

  // ---- dragover on the wrapper ----
  // Calling `preventDefault` is what tells the browser this element is
  // a valid drop target; without it the `drop` event never fires.
  // We compute the side (above / below) from the pointer's y relative
  // to the wrapper's midline.
  const onDragOver = (e: DragEvent): void => {
    // Only react to in-editor block drags — text selection drags etc.
    // shouldn't paint the indicator.
    const dt = e.dataTransfer;
    if (!dt || !Array.from(dt.types).includes(DRAG_MIME)) return;
    e.preventDefault();
    dt.dropEffect = 'move';
    const rect = wrapper.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    showIndicator(e.clientY < mid ? 'above' : 'below');
  };
  const onDragLeave = (e: DragEvent): void => {
    // `dragleave` fires when the pointer crosses any descendant
    // boundary, so we check the relatedTarget — if it's still inside
    // the wrapper, ignore.
    const next = e.relatedTarget as Node | null;
    if (next && wrapper.contains(next)) return;
    hideIndicator();
  };
  const onDrop = (e: DragEvent): void => {
    const dt = e.dataTransfer;
    if (!dt) return;
    const raw = dt.getData(DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    const fromIdx = Number(raw);
    const targetIdx = getBlockIdx();
    if (!Number.isFinite(fromIdx) || targetIdx == null) {
      hideIndicator();
      return;
    }
    // Slot semantics: dropping ABOVE block N goes to slot N; dropping
    // BELOW block N goes to slot N+1.
    const rect = wrapper.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const toIdx = e.clientY < mid ? targetIdx : targetIdx + 1;
    hideIndicator();
    wrapper.classList.remove('is-dragging');
    // Bail on the no-op cases without dispatching a transaction.
    if (toIdx === fromIdx || toIdx === fromIdx + 1) return;
    editor.commands.moveBlock(fromIdx, toIdx);
  };
  wrapper.addEventListener('dragover', onDragOver);
  wrapper.addEventListener('dragleave', onDragLeave);
  wrapper.addEventListener('drop', onDrop);

  return {
    destroy() {
      dragBtn.removeEventListener('dragstart', onDragStart);
      dragBtn.removeEventListener('dragend', onDragEnd);
      wrapper.removeEventListener('dragover', onDragOver);
      wrapper.removeEventListener('dragleave', onDragLeave);
      wrapper.removeEventListener('drop', onDrop);
      hideIndicator();
    },
  };
}
