/**
 * Block-chrome helpers — small lib used by `BlockChromeView.tsx` (the React
 * NodeView for every paperflow block) and `FloatingBlockChrome.tsx` (the
 * single floating chrome cluster).
 *
 * Three responsibilities:
 *
 *   1. `humanLabelFor`                 pure: block-type → "Paragraph" /
 *                                       "Heading" / …
 *   2. `pdBlockTypeFor`                pure: tiptap node name → PortableDoc
 *                                       block type (null for blocks without
 *                                       a variant catalog entry).
 *   3. `bindEditorLevelDragHandlers`   imperative: wires native HTML5 drag-
 *                                       and-drop. dragstart on a single
 *                                       floating drag button (which carries
 *                                       the CURRENT target block's idx),
 *                                       dragover/dragleave/drop ONCE at the
 *                                       editor surface (the listener walks
 *                                       `event.target` up to the nearest
 *                                       `.react-renderer` wrapper to find
 *                                       the drop's target block).
 *
 * Schema-level `draggable: true` + the `data-drag-handle` attribute on the
 * drag button hand TipTap's NodeView.onDragStart a clean drag image and a
 * NodeSelection. The drop side is OURS — PM's default drops at text-coords,
 * not block slots, so the drop handler computes slot semantics (above-
 * midline = slot N, below-midline = slot N+1) and dispatches the
 * `moveBlock` editor command.
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
// PortableDoc block-type mapping (for the variant-chip wire-up)
// ---------------------------------------------------------------------------

/** Map a TipTap node name to its PortableDoc block type (the name the
 *  variant catalog keys on). Returns `null` for nodes without variants
 *  (paragraph, heading, list, divider, image, table). */
export function pdBlockTypeFor(tiptapName: string): string | null {
  switch (tiptapName) {
    case 'blockquote':
      return 'callout';
    case 'codeBlock':
      return 'code';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Native HTML5 drag wiring + drop indicator
// ---------------------------------------------------------------------------

/** Data-transfer MIME the drag pipeline uses to carry the source idx.
 *  Plain `text/plain` would collide with anything else the page drops
 *  into the editor (URLs, copied text); a custom MIME keeps the channel
 *  unambiguous. */
const DRAG_MIME = 'application/x-paper-block-idx';

/** Returned by drag-handler binders so the React side can detach all
 *  listeners on `destroy` without re-deriving handler identity. */
export interface DragHandle {
  destroy(): void;
}

/** Walk `el` and its ancestors to find the top-level block wrapper —
 *  the `.paper-block` element carrying `data-block-idx`. (Nested
 *  `.paper-block-nested` wrappers don't have the attribute, so this
 *  walk skips past them and stops at the top-level block.) Returns
 *  `null` for events outside any block. */
function closestTopLevelBlockWrapper(el: Element | null): HTMLElement | null {
  let cur: Element | null = el;
  while (cur != null) {
    if (cur instanceof HTMLElement && cur.dataset.blockIdx !== undefined) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Editor-level drag wiring.
 *
 * One dragstart listener on the floating drag button (its target idx is
 * resolved lazily via `getCurrentBlockIdx` at drag time). One
 * dragover/dragleave/drop trio on the editor surface (each event resolves
 * the target wrapper from `event.target.closest('.react-renderer')`).
 *
 * The drop indicator is appended to / removed from the target wrapper —
 * its `data-side` ("above" / "below") follows the midline of the wrapper
 * the pointer is currently over.
 *
 * `onDragStart` and `onDragEnd` callbacks let the caller flip a
 * `isDragging` ref (so the floating chrome doesn't hide-hysteresis itself
 * while a drag is in flight).
 */
export function bindEditorLevelDragHandlers(
  editor: Editor,
  dragBtn: HTMLButtonElement,
  getCurrentBlockIdx: () => number | undefined,
  onDragStart?: () => void,
  onDragEnd?: () => void,
): DragHandle {
  const surface = editor.view.dom as HTMLElement;
  let currentIndicatorParent: HTMLElement | null = null;
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
    if (indicator && currentIndicatorParent && indicator.parentNode === currentIndicatorParent) {
      currentIndicatorParent.removeChild(indicator);
    }
    currentIndicatorParent = null;
  };
  const showIndicator = (wrapper: HTMLElement, side: 'above' | 'below'): void => {
    const el = ensureIndicator();
    el.dataset.side = side;
    if (currentIndicatorParent && currentIndicatorParent !== wrapper) {
      if (el.parentNode === currentIndicatorParent) {
        currentIndicatorParent.removeChild(el);
      }
    }
    // The drop indicator is positioned absolute against the wrapper;
    // ensure the wrapper itself is positioned so the indicator's top/
    // bottom anchor correctly.
    if (getComputedStyle(wrapper).position === 'static') {
      wrapper.style.position = 'relative';
    }
    if (el.parentNode !== wrapper) wrapper.appendChild(el);
    currentIndicatorParent = wrapper;
  };

  const handleDragStart = (e: DragEvent): void => {
    const idx = getCurrentBlockIdx();
    if (idx == null) return;
    const dt = e.dataTransfer;
    if (!dt) return;
    dt.setData(DRAG_MIME, String(idx));
    dt.effectAllowed = 'move';
    onDragStart?.();
  };
  const handleDragEnd = (): void => {
    hideIndicator();
    onDragEnd?.();
  };
  dragBtn.addEventListener('dragstart', handleDragStart);
  dragBtn.addEventListener('dragend', handleDragEnd);

  const handleDragOver = (e: DragEvent): void => {
    const dt = e.dataTransfer;
    if (!dt) return;
    if (!Array.from(dt.types).includes(DRAG_MIME)) return;
    const wrapper = closestTopLevelBlockWrapper(e.target as Element | null);
    if (!wrapper) return;
    e.preventDefault();
    dt.dropEffect = 'move';
    const rect = wrapper.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    showIndicator(wrapper, e.clientY < mid ? 'above' : 'below');
  };
  const handleDragLeave = (e: DragEvent): void => {
    // Only hide when the pointer leaves the editor surface entirely.
    const next = e.relatedTarget as Node | null;
    if (next && surface.contains(next)) return;
    hideIndicator();
  };
  const handleDrop = (e: DragEvent): void => {
    const dt = e.dataTransfer;
    if (!dt) return;
    const raw = dt.getData(DRAG_MIME);
    if (!raw) return;
    const wrapper = closestTopLevelBlockWrapper(e.target as Element | null);
    if (!wrapper) {
      hideIndicator();
      return;
    }
    const idxRaw = wrapper.dataset.blockIdx;
    const targetIdx = idxRaw === undefined ? NaN : Number(idxRaw);
    const fromIdx = Number(raw);
    if (!Number.isFinite(fromIdx) || !Number.isFinite(targetIdx)) {
      hideIndicator();
      return;
    }
    e.preventDefault();
    const rect = wrapper.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const toIdx = e.clientY < mid ? targetIdx : targetIdx + 1;
    hideIndicator();
    // moveBlock's own no-op short-circuits handle the identity cases.
    editor.commands.moveBlock(fromIdx, toIdx);
  };
  surface.addEventListener('dragover', handleDragOver);
  surface.addEventListener('dragleave', handleDragLeave);
  surface.addEventListener('drop', handleDrop);

  return {
    destroy() {
      dragBtn.removeEventListener('dragstart', handleDragStart);
      dragBtn.removeEventListener('dragend', handleDragEnd);
      surface.removeEventListener('dragover', handleDragOver);
      surface.removeEventListener('dragleave', handleDragLeave);
      surface.removeEventListener('drop', handleDrop);
      hideIndicator();
    },
  };
}

/**
 * @deprecated Use `bindEditorLevelDragHandlers` — the per-block binder is
 * retained as a no-op shim so callers that haven't migrated still
 * type-check. New code should bind once at the editor surface level via
 * `bindEditorLevelDragHandlers`.
 */
export function bindDragHandlers(
  _dragBtn: HTMLButtonElement,
  _wrapper: HTMLElement,
  _editor: Editor,
  _getBlockIdx: () => number | undefined,
): DragHandle {
  return { destroy() {} };
}
