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
 * Mouse tracking strategy (canonical ProseMirror)
 * ----------------------------------------------
 * - One `mousemove` listener on the editor's `.ProseMirror` surface.
 * - For each event we call `editor.view.posAtCoords({left, top})` to
 *   resolve the doc-position under the pointer, then walk up its
 *   resolution chain to find the top-level child index. No DOM contract
 *   leaks out of the NodeView — the cluster works on any node, whether
 *   we own its NodeView or not.
 * - The block's DOM element is fetched via `editor.view.nodeDOM(pos)`
 *   (canonical PM API) for `getBoundingClientRect()` positioning;
 *   the cluster sits to the LEFT of that rect, leaving room for the
 *   global drag-handle's 20px slot just to the cluster's right.
 * - 300ms hide hysteresis prevents flicker as the mouse crosses block
 *   boundaries or aims for a button.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor as TipTapEditor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { VariantChip } from './VariantChip.js';
import { humanLabelFor, pdBlockTypeFor } from './lib/block-chrome-helpers.js';

interface FloatingBlockChromeProps {
  editor: TipTapEditor | null;
}

/** Resolved info about the currently-hovered top-level block. */
interface TargetBlock {
  /** Top-level child index — derived from the resolved $pos. */
  idx: number;
  /** TipTap node name at the top-level position. */
  blockType: string;
  /** Doc-position of the block node — the slot BEFORE the top-level child. */
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

/** Resolve the top-level block under the pointer using canonical PM APIs.
 *  - `view.posAtCoords({left, top})` returns the doc position at the given
 *    viewport coordinates (or null if the point is outside the editable
 *    area — e.g. surface padding).
 *  - `state.doc.resolve(pos).index(0)` walks up to depth 0 (the doc node)
 *    and reports which top-level child contains that position.
 *
 *  Falls back to `view.posAtDOM(el, 0)` when posAtCoords yields nothing
 *  (jsdom/happy-dom doesn't run layout, so coord-based hit-testing returns
 *  null there; the DOM-based path still works on synthetic events). The
 *  fallback is the same canonical PM API — no `data-*` attribute walk. */
function targetBlockFromEvent(
  editor: TipTapEditor,
  e: MouseEvent,
): TargetBlock | null {
  const view = editor.view;
  let pos: number | null = null;
  const coordResult = view.posAtCoords({ left: e.clientX, top: e.clientY });
  if (coordResult) {
    pos = coordResult.inside >= 0 ? coordResult.inside : coordResult.pos;
  } else if (e.target instanceof Node && view.dom.contains(e.target)) {
    try {
      pos = view.posAtDOM(e.target, 0);
    } catch {
      pos = null;
    }
  }
  if (pos == null) return null;
  if (pos < 0 || pos > editor.state.doc.content.size) return null;
  const $pos = editor.state.doc.resolve(pos);
  // Walk up to a top-level child of the doc. `$pos.depth === 0` means the
  // position is at the doc level itself (between blocks) — skip.
  if ($pos.depth === 0) return null;
  const idx = $pos.index(0);
  const blockPos = $pos.before(1);
  const node = editor.state.doc.nodeAt(blockPos);
  if (!node) return null;
  return { idx, blockType: node.type.name, pos: blockPos };
}

/** Fetch the DOM element for the top-level block at `blockPos`. Uses the
 *  canonical `view.nodeDOM` API so the cluster works regardless of whether
 *  the block has a paperflow NodeView or a third-party one. */
function nodeDOMAt(editor: TipTapEditor, blockPos: number): HTMLElement | null {
  const dom = editor.view.nodeDOM(blockPos);
  return dom instanceof HTMLElement ? dom : null;
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
  // Subscribe to the editor's selection-empty state via the canonical
  // TipTap 3 `useEditorState` pattern — when the writer has a non-empty
  // selection, BubbleMenu owns the floating layer and we must hide.
  // The library shallow-compares the boolean and only re-renders when
  // it actually flips, which is cheaper than the previous
  // `editor.on('selectionUpdate'/'update', …) + setState` pair.
  // Defaults to `true` while the editor is mounting (no flicker before
  // first selection).
  const selectionEmpty = useEditorState({
    editor,
    selector: ({ editor: e }) => (e ? e.state.selection.empty : true),
  }) ?? true;

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

  // Reposition the chrome whenever target changes or the editor scrolls /
  // is resized. Fetches the block's DOM via `view.nodeDOM(blockPos)` — the
  // canonical PM API that works for any node regardless of which NodeView
  // (if any) owns it. We use `fixed` positioning so the rect's left/top
  // are usable directly against the viewport.
  const reposition = useCallback((): void => {
    if (!editor || !target || !chromeElRef.current) {
      setPosition(null);
      return;
    }
    const blockDOM = nodeDOMAt(editor, target.pos);
    if (!blockDOM) {
      setPosition(null);
      return;
    }
    const wrapperRect = blockDOM.getBoundingClientRect();
    const chromeRect = chromeElRef.current.getBoundingClientRect();
    const chromeWidth = chromeRect.width > 0 ? chromeRect.width : 160;
    const chromeHeight = chromeRect.height > 0 ? chromeRect.height : 28;
    const left = wrapperRect.left - chromeWidth - CHROME_GAP_PX;
    const top = wrapperRect.top + Math.max(0, (wrapperRect.height - chromeHeight) / 2);
    setPosition({ top, left });
  }, [editor, target]);

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

  // The main mousemove tracker — bound on the editor surface root.
  // Resolution is canonical PM (`view.posAtCoords` with a `view.posAtDOM`
  // fallback for layout-less test envs); see `targetBlockFromEvent` above.
  useEffect(() => {
    if (!editor) return;
    const surface = editor.view.dom as HTMLElement;

    const processEvent = (e: MouseEvent): void => {
      const next = targetBlockFromEvent(editor, e);
      if (!next) {
        // Outside any block — schedule hide unless the mouse is over
        // the chrome itself.
        if (!chromeHovered) scheduleHide();
        return;
      }
      clearHideTimer();
      setTarget((prev) => {
        if (
          prev &&
          prev.idx === next.idx &&
          prev.blockType === next.blockType &&
          prev.pos === next.pos
        ) {
          return prev;
        }
        return next;
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

  // Read the live block type so the variant chip + screen-reader labels
  // use the freshest node info (heading level may change without
  // target.idx changing).
  const blockType = target?.blockType ?? 'paragraph';
  const pdType = useMemo(() => pdBlockTypeFor(blockType), [blockType]);

  const headingLevel =
    blockType === 'heading' && targetAttrs
      ? Number(targetAttrs.level ?? 1)
      : null;
  const baseLabel = humanLabelFor(blockType);
  // Screen-reader-only label string (e.g. "heading 2", "callout"). Used
  // by the delete button's aria-label so SR users still hear which block
  // type is being acted on. The label is never rendered visually —
  // Notion / Novel / BlockNote don't show a type label by default, and
  // it's noise for sighted writers.
  const lower =
    (headingLevel != null && Number.isFinite(headingLevel)
      ? `${baseLabel} ${headingLevel}`
      : baseLabel
    ).toLowerCase();

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
      role="toolbar"
      aria-label="Block toolbar"
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
    </div>
  );
}
