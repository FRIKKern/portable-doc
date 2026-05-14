/**
 * Block-chrome helpers used by the React NodeView (`BlockChromeView.tsx`)
 * and the legacy unit tests.
 *
 * Slim post-refactor: chrome DOM, variant-chip mount bridge, and selection-
 * class toggling all moved into the React component. What remains:
 *
 *   - `humanLabelFor`      pure: block-type → "Paragraph" / "Heading" / …
 *   - `pdBlockTypeFor`     pure: tiptap node name → PortableDoc block type
 *                          (returns null for blocks without variants)
 *   - `bindDragHandlers`   imperative: wires native HTML5 drag-and-drop onto
 *                          the chrome's `⋮⋮` button + the wrapper element.
 *                          Called from the React NodeView via useEffect.
 *
 * `ChromeParts` is a typing helper the React NodeView passes a minimal
 * subset of when binding drag handlers — only `dragBtn` is actually
 * read inside `bindDragHandlers`, but the interface stays compatible
 * with the older tests' expectations.
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
// Chrome parts (interface preserved for tests + bindDragHandlers signature)
// ---------------------------------------------------------------------------

export interface ChromeParts {
  /** The drag handle button (HTML5 dragstart writes the source idx). */
  dragBtn: HTMLButtonElement;
  /** Container the React NodeView places the drag handle into. Drag-test
   *  scaffolds append this to a synthetic wrapper to mimic the production
   *  DOM tree. The React NodeView still builds an equivalent
   *  `.paper-block__chrome` div in its JSX, but doesn't expose it through
   *  this interface. */
  toolbar: HTMLDivElement;
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
    // `action` and `section` aren't standalone TipTap nodes in v0.4 — the
    // catalog has schemas for them but the editor doesn't surface them
    // yet. Returning null here is correct.
    default:
      return null;
  }
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
  // bottom edge on hover.
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
