/**
 * Block-chrome helpers — small lib used by `BlockChromeView.tsx` (the React
 * NodeView that paints chrome around every top-level block). Originally
 * lived at `src/BlockChrome.ts` back when chrome rendering happened here
 * imperatively; after the React NodeView refactor only the helpers below
 * remain, so the file moved to `src/lib/` where it belongs.
 *
 * Three responsibilities:
 *
 *   1. `humanLabelFor`     pure: block-type → "Paragraph" / "Heading" / …
 *   2. `pdBlockTypeFor`    pure: tiptap node name → PortableDoc block type
 *                          (null for blocks without a variant catalog entry)
 *   3. `bindDragHandlers`  imperative: wires native HTML5 drag-and-drop on
 *                          the chrome's `⋮⋮` button so block drops respect
 *                          slot semantics (above-midline = slot N,
 *                          below-midline = slot N+1) and dispatch the
 *                          `moveBlock` editor command. Schema-level
 *                          `draggable: true` + `data-drag-handle` are also
 *                          set on the button — TipTap's NodeView.onDragStart
 *                          uses them to hand a clean drag image to the OS.
 *                          But the drop side is OURS: PM's default drops
 *                          at text-coords, not block slots, so we own the
 *                          drop handler + the indicator paint.
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

/** Returned by `bindDragHandlers` so the NodeView can detach all
 *  listeners on `destroy` without re-deriving handler identity. */
export interface DragHandle {
  destroy(): void;
}

/**
 * Wire native HTML5 drag-and-drop onto a block's drag handle + wrapper.
 *
 * The handle (the `⋮⋮` button) gets `dragstart` — writes the source
 * index into the `DataTransfer` payload via our custom MIME. The wrapper
 * itself listens for `dragover` (paint the drop-indicator above or
 * below depending on which half of the wrapper the pointer is over),
 * `dragleave` (hide indicator), and `drop` (read source idx, compute
 * slot-style `toIdx`, dispatch `editor.commands.moveBlock`).
 *
 * `getBlockIdx` returns this block's current top-level index — re-read
 * lazily on every event so inserts/deletes above don't stale the value.
 */
export function bindDragHandlers(
  dragBtn: HTMLButtonElement,
  wrapper: HTMLElement,
  editor: Editor,
  getBlockIdx: () => number | undefined,
): DragHandle {
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

  const onDragOver = (e: DragEvent): void => {
    const dt = e.dataTransfer;
    if (!dt || !Array.from(dt.types).includes(DRAG_MIME)) return;
    e.preventDefault();
    dt.dropEffect = 'move';
    const rect = wrapper.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    showIndicator(e.clientY < mid ? 'above' : 'below');
  };
  const onDragLeave = (e: DragEvent): void => {
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
    const rect = wrapper.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const toIdx = e.clientY < mid ? targetIdx : targetIdx + 1;
    hideIndicator();
    wrapper.classList.remove('is-dragging');
    // moveBlock's own no-op short-circuits handle the identity cases.
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
