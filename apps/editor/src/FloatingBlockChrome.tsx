/**
 * CW5 / T3b — Floating block-chrome cluster.
 *
 * Renders ONE floating cluster — `[ Label · variant chip · × ]  [ + ]` —
 * to the right of the global drag handle (a sibling element rendered by
 * `tiptap-extension-global-drag-handle`). Tracks the currently-hovered
 * top-level block via a single mousemove listener on the editor surface
 * so the cluster follows the writer's pointer with the canonical Notion /
 * BlockNote / Linear feel.
 *
 * Why this file is now thin
 * -------------------------
 * The previous version (~455 LOC) also owned the drag handle button + its
 * dragstart wiring + the editor-level dragover/drop indicator painter. All
 * of that is now delegated to `tiptap-extension-global-drag-handle` (the
 * same extension Novel uses) — it renders a single `<div class="drag-handle"
 * data-drag-handle>` next to the editor's parent, positions it on
 * mousemove, owns the dragstart slice serialization, and lets PM's
 * built-in drop machinery handle the reorder. We render only the
 * additional affordances (label, variant chip, delete, "+" insert) and
 * position them as a sibling of the extension's handle.
 *
 * Mouse tracking strategy (unchanged from the bespoke version)
 * ------------------------------------------------------------
 * - One `mousemove` listener on the editor's `.ProseMirror` surface.
 * - For each event we walk `event.target` up to the closest element with
 *   `data-block-idx` — the `.paper-block` wrapper BlockChromeView renders.
 *   That wrapper carries `data-block-type` + `data-block-idx`, so
 *   resolving the target block is a constant-time ancestor walk.
 * - Positioning reads the target wrapper's `getBoundingClientRect()` and
 *   places the cluster to the LEFT of the wrapper, leaving room for the
 *   global drag-handle's own 20px slot just to the cluster's right.
 * - 300ms hide hysteresis prevents flicker as the mouse crosses block
 *   boundaries or aims for a button.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor as TipTapEditor } from '@tiptap/react';
import { VariantChip } from './VariantChip.js';
import { humanLabelFor, pdBlockTypeFor } from './lib/block-chrome-helpers.js';

interface FloatingBlockChromeProps {
  editor: TipTapEditor | null;
}

/** Resolved info about the currently-hovered top-level block. */
interface TargetBlock {
  /** The `.paper-block` wrapper BlockChromeView renders for top-level nodes. */
  wrapper: HTMLElement;
  /** Top-level child index — read from `data-block-idx`. */
  idx: number;
  /** TipTap node name — read from `data-block-type`. */
  blockType: string;
  /** Doc-position of the block node (resolved on demand for commands). */
  pos: number;
}

/** Hide hysteresis — match the per-block-chrome 300ms hide delay so the
 *  cluster stays stable while the writer aims at one of its buttons. */
const HIDE_HYSTERESIS_MS = 300;

/** Horizontal gap between the floating chrome and the target block. The
 *  global drag-handle extension lives in the ~20px slot just to the
 *  cluster's right (between cluster and block), so a larger gap leaves
 *  room for it without overlap. */
const CHROME_GAP_PX = 32;

/** Resolve the doc-position of the top-level block at idx `n`. */
function topLevelBlockPos(editor: TipTapEditor, idx: number): number | null {
  let i = 0;
  let pos: number | null = null;
  editor.state.doc.forEach((_node, offset) => {
    if (i === idx) pos = offset;
    i += 1;
  });
  return pos;
}

/** Walk `el` and its ancestors to find the top-level block wrapper —
 *  the `.paper-block` element BlockChromeView renders, carrying
 *  `data-block-idx` (the discriminator: nested `.paper-block-nested`
 *  wrappers don't have it). Returns `null` for events outside any
 *  block (gutter, surface padding). */
function closestBlockWrapper(el: Element | null): HTMLElement | null {
  if (!el) return null;
  let cur: Element | null = el;
  while (cur != null) {
    if (cur instanceof HTMLElement && cur.dataset.blockIdx !== undefined) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

export function FloatingBlockChrome({
  editor,
}: FloatingBlockChromeProps): JSX.Element | null {
  const [target, setTarget] = useState<TargetBlock | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [chromeHovered, setChromeHovered] = useState(false);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const chromeElRef = useRef<HTMLDivElement | null>(null);
  // Subscribe to the editor's selection-empty state — when the writer
  // has a non-empty selection, BubbleMenu owns the floating layer and
  // we must hide.
  const [selectionEmpty, setSelectionEmpty] = useState(true);

  // Cached node attrs at the target block — drives the variant chip.
  const [targetAttrs, setTargetAttrs] = useState<Record<string, unknown> | null>(
    null,
  );

  const clearHideTimer = useCallback((): void => {
    if (hideTimerRef.current !== undefined) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = undefined;
    }
  }, []);

  const scheduleHide = useCallback((): void => {
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      setTarget(null);
      setPosition(null);
      setTargetAttrs(null);
      hideTimerRef.current = undefined;
    }, HIDE_HYSTERESIS_MS);
  }, [clearHideTimer]);

  // Recompute the cached node attrs whenever the target's idx changes
  // (and on any editor transaction that may have changed the node).
  useEffect(() => {
    if (!editor || !target) {
      setTargetAttrs(null);
      return;
    }
    const read = (): void => {
      const pos = topLevelBlockPos(editor, target.idx);
      if (pos == null) {
        setTargetAttrs(null);
        return;
      }
      const node = editor.state.doc.nodeAt(pos);
      setTargetAttrs(node?.attrs ?? null);
    };
    read();
    editor.on('transaction', read);
    return () => {
      editor.off('transaction', read);
    };
  }, [editor, target]);

  // Subscribe to editor selection state. Mirrors the chrome's
  // `.is-selecting` behavior — text-selection bubble menu wins the
  // floating layer.
  useEffect(() => {
    if (!editor) return;
    const update = (): void => setSelectionEmpty(editor.state.selection.empty);
    update();
    editor.on('selectionUpdate', update);
    editor.on('update', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('update', update);
    };
  }, [editor]);

  // Reposition the chrome whenever target changes or the editor scrolls /
  // is resized. Reads the wrapper's rect against viewport — we use `fixed`
  // positioning so the rect's left/top are usable directly.
  const reposition = useCallback((): void => {
    if (!target || !chromeElRef.current) {
      setPosition(null);
      return;
    }
    const wrapperRect = target.wrapper.getBoundingClientRect();
    const chromeRect = chromeElRef.current.getBoundingClientRect();
    const chromeWidth = chromeRect.width > 0 ? chromeRect.width : 160;
    const chromeHeight = chromeRect.height > 0 ? chromeRect.height : 28;
    const left = wrapperRect.left - chromeWidth - CHROME_GAP_PX;
    const top = wrapperRect.top + Math.max(0, (wrapperRect.height - chromeHeight) / 2);
    setPosition({ top, left });
  }, [target]);

  // Recompute position whenever target changes, after the chrome has
  // rendered (so chromeElRef has its measured width).
  useEffect(() => {
    reposition();
  }, [reposition, targetAttrs]);

  // Reposition on scroll + resize. Bound to window in capture phase so
  // nested scroll containers also fire it.
  useEffect(() => {
    if (!target) return;
    const onScrollOrResize = (): void => reposition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [target, reposition]);

  // The main mousemove tracker — bound on the editor surface root. The
  // handler is fast (one DOM walk per move) so we don't bother throttling;
  // an rAF gate added subtle test timing issues that weren't worth the
  // perf savings on a per-block walk.
  useEffect(() => {
    if (!editor) return;
    const surface = editor.view.dom as HTMLElement;

    const processEvent = (e: MouseEvent): void => {
      const targetEl = e.target as Element | null;
      const wrapper = closestBlockWrapper(targetEl);
      if (!wrapper) {
        // Outside any block — schedule hide unless the mouse is over
        // the chrome itself.
        if (!chromeHovered) scheduleHide();
        return;
      }
      const idxRaw = wrapper.dataset.blockIdx;
      const blockType = wrapper.dataset.blockType ?? 'paragraph';
      const idx = idxRaw === undefined ? NaN : Number(idxRaw);
      if (!Number.isFinite(idx)) return;
      const pos = topLevelBlockPos(editor, idx);
      if (pos == null) return;
      clearHideTimer();
      setTarget((prev) => {
        if (
          prev &&
          prev.wrapper === wrapper &&
          prev.idx === idx &&
          prev.blockType === blockType &&
          prev.pos === pos
        ) {
          return prev;
        }
        return { wrapper, idx, blockType, pos };
      });
    };

    const onMouseLeave = (): void => {
      if (!chromeHovered) scheduleHide();
    };

    surface.addEventListener('mousemove', processEvent);
    surface.addEventListener('mouseleave', onMouseLeave);
    return () => {
      surface.removeEventListener('mousemove', processEvent);
      surface.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [editor, chromeHovered, clearHideTimer, scheduleHide]);

  // Cleanup hide timer on unmount.
  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  // Variant chip change handler — merges new axes into the target
  // block's `variant` attr via setNodeMarkup at its current position.
  const onVariantChange = useCallback(
    (next: Record<string, string>): void => {
      if (!editor || !target) return;
      const pos = topLevelBlockPos(editor, target.idx);
      if (pos == null) return;
      const liveNode = editor.state.doc.nodeAt(pos);
      if (!liveNode) return;
      const prev = (liveNode.attrs?.variant as Record<string, string> | null) ?? {};
      const merged = { ...prev, ...next };
      editor
        .chain()
        .command(({ tr }) => {
          tr.setNodeMarkup(pos, undefined, { ...liveNode.attrs, variant: merged });
          return true;
        })
        .run();
    },
    [editor, target],
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (!editor || !target) return;
      const pos = topLevelBlockPos(editor, target.idx);
      if (pos == null) return;
      const liveNode = editor.state.doc.nodeAt(pos);
      if (!liveNode) return;
      editor.commands.deleteRange({ from: pos, to: pos + liveNode.nodeSize });
      setTarget(null);
      setPosition(null);
    },
    [editor, target],
  );

  const handleInsertBelow = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (!editor || !target) return;
      const pos = topLevelBlockPos(editor, target.idx);
      if (pos == null) return;
      const liveNode = editor.state.doc.nodeAt(pos);
      if (!liveNode) return;
      const after = pos + liveNode.nodeSize;
      editor
        .chain()
        .focus()
        .insertContentAt(after, { type: 'paragraph' })
        .setTextSelection(after + 1)
        .insertContent('/')
        .run();
    },
    [editor, target],
  );

  // Read the live block type so the variant chip + label use the freshest
  // node info (heading level may change without target.idx changing).
  const blockType = target?.blockType ?? 'paragraph';
  const pdType = useMemo(() => pdBlockTypeFor(blockType), [blockType]);

  const headingLevel =
    blockType === 'heading' && targetAttrs
      ? Number(targetAttrs.level ?? 1)
      : null;
  const baseLabel = humanLabelFor(blockType);
  const label =
    headingLevel != null && Number.isFinite(headingLevel)
      ? `${baseLabel} ${headingLevel}`
      : baseLabel;
  const lower = label.toLowerCase();

  // Visibility: chrome is mounted at all times (so refs work) but
  // hidden when there's no target, when a text selection is active, or
  // when the editor isn't ready.
  const visible =
    editor != null && target != null && selectionEmpty;

  return (
    <div
      ref={chromeElRef}
      className={
        'paper-floating-chrome' +
        (visible ? ' is-tracking' : '')
      }
      data-block-type={target?.blockType}
      data-block-idx={target?.idx}
      role="toolbar"
      aria-label={`${label} block toolbar`}
      aria-hidden={!visible}
      // `contentEditable={false}` keeps the floating chrome out of
      // ProseMirror's text-selection / drag-handling scope so mousedowns
      // on the delete + insert buttons reliably reach OUR handlers.
      contentEditable={false}
      suppressContentEditableWarning
      style={
        visible && position
          ? {
              position: 'fixed',
              top: `${position.top}px`,
              left: `${position.left}px`,
            }
          : { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }
      }
      onMouseEnter={() => {
        setChromeHovered(true);
        clearHideTimer();
      }}
      onMouseLeave={() => {
        setChromeHovered(false);
        scheduleHide();
      }}
    >
      <span className="paper-block__label">{label}</span>
      <div className="paper-block__variant-slot">
        {pdType !== null && target && targetAttrs ? (
          <VariantChip
            // Re-key by target idx so the chip's local state (`open`,
            // hover) resets when the writer hops to a different block.
            key={`${target.idx}-${blockType}`}
            blockType={pdType}
            attrs={targetAttrs}
            onChange={onVariantChange}
          />
        ) : null}
      </div>
      <button
        type="button"
        className="paper-block-delete"
        aria-label={`Delete ${lower}`}
        data-block-type={target?.blockType}
        onMouseDown={handleDelete}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleDelete(e);
        }}
      >
        ×
      </button>
      <button
        type="button"
        className="paper-block__insert"
        aria-label="Insert block below"
        data-block-type={target?.blockType}
        onMouseDown={handleInsertBelow}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleInsertBelow(e);
        }}
      >
        +
      </button>
    </div>
  );
}
