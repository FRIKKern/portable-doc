/**
 * BlockBubble — the ONE floating toolbar.
 *
 * Lives once per editor, positioned ABOVE the currently-active block
 * (the block containing the caret/selection, or — when the editor
 * isn't focused — the block under the pointer). Contains every
 * block-level affordance and inline-format button in a single
 * cluster, so the writer sees exactly one floating UI at a time:
 *
 *   [ ⋮⋮ ] [ B ] [ I ] [ </> ] [ link ] [ chip ] [ × ]
 *
 *   ⋮⋮     draggable button — onDragStart sets a NodeSelection at the
 *          active block's pos and serializes for clipboard so PM's
 *          drop machinery can move the block.
 *   B/I/</>/link
 *          canonical inline format. Active state mirrors the editor's
 *          mark state via useEditorState. Link button surfaces an
 *          inline URL input when there's a non-empty selection.
 *   chip   variant chip — renders only for blocks with catalog
 *          entries (callout, code).
 *   ×      delete block.
 *
 * Position is `top - bubble.height - 10` and `left = block.left`; the
 * bubble floats just above the block's first line, flush to the
 * block's left margin. Falls below the block when there's no room
 * above (e.g. first heading at top of viewport).
 *
 * This replaces the v0.4-era split of `FormatBubble` (selection-anchored)
 * + `FloatingBlockChrome` (gutter-anchored) — the user-requested
 * shape is one toolbar.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Editor as TipTapEditor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { NodeSelection } from 'prosemirror-state';
import { VariantChip } from './VariantChip.js';
import { humanLabelFor, pdBlockTypeFor } from './lib/block-chrome-helpers.js';

interface FloatingBlockChromeProps {
  editor: TipTapEditor | null;
}

interface TargetBlock {
  /** Top-level child index (0-based). */
  idx: number;
  /** TipTap node name at the top-level position. */
  blockType: string;
  /** Doc-position of the block node — the slot BEFORE the top-level child. */
  pos: number;
  /** Where the target came from — drives subtle UX differences. */
  source: 'selection' | 'hover';
}

/** Hide hysteresis — applied only to hover-derived targets. Selection-
 *  derived targets don't hide (the caret is in the doc, the bubble
 *  stays). 600ms is the noticeably-stable feel; tighter values flicker,
 *  looser feel laggy. */
const HIDE_HYSTERESIS_MS = 600;

/** Vertical gap between the bubble and the block, in px. */
const BUBBLE_GAP_PX = 10;

/** Inline-style URL validator — matches the StarterKit link config so
 *  the chrome's link affordance only accepts the same URL shapes the
 *  paste-handler would. */
function isAllowedLink(href: string): boolean {
  return /^https?:\/\//i.test(href) || /^mailto:/i.test(href);
}

/** Walk to the top-level child of the doc that contains `pos`. Returns
 *  the index, block-pos (before the child), and node name. */
function topLevelAtPos(
  editor: TipTapEditor,
  pos: number,
): { idx: number; blockPos: number; blockType: string } | null {
  if (pos < 0 || pos > editor.state.doc.content.size) return null;
  const $pos = editor.state.doc.resolve(pos);
  if ($pos.depth === 0) {
    // Position is at the doc level itself. Use the previous top-level
    // child (so a click between blocks lands on the block above the cursor).
    const idx = Math.max(0, ($pos.index(0) || 1) - 1);
    let i = 0;
    let blockPos = 0;
    let blockType = '';
    editor.state.doc.forEach((node, offset) => {
      if (i === idx) {
        blockPos = offset;
        blockType = node.type.name;
      }
      i += 1;
    });
    return blockType ? { idx, blockPos, blockType } : null;
  }
  const idx = $pos.index(0);
  const blockPos = $pos.before(1);
  const node = editor.state.doc.nodeAt(blockPos);
  if (!node) return null;
  return { idx, blockPos, blockType: node.type.name };
}

/** Resolve the doc-position of the top-level block at idx `n`. Used by
 *  delete / variant / drag handlers that must re-resolve `pos` at
 *  command-time (the cached `target.pos` can go stale across edits). */
function topLevelBlockPos(editor: TipTapEditor, idx: number): number | null {
  let i = 0;
  let pos: number | null = null;
  editor.state.doc.forEach((_node, offset) => {
    if (i === idx) pos = offset;
    i += 1;
  });
  return pos;
}

/** Resolve the block under the pointer via canonical PM APIs. Falls
 *  back to `view.posAtDOM(el, 0)` when posAtCoords yields nothing
 *  (jsdom / happy-dom don't run layout). */
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
  const top = topLevelAtPos(editor, pos);
  if (!top) return null;
  return {
    idx: top.idx,
    blockType: top.blockType,
    pos: top.blockPos,
    source: 'hover',
  };
}

/** Fetch the DOM element for a top-level block at `blockPos`. Uses the
 *  canonical `view.nodeDOM` API so this code path is independent of
 *  paperflow's class naming. */
function nodeDOMAt(editor: TipTapEditor, blockPos: number): HTMLElement | null {
  const dom = editor.view.nodeDOM(blockPos);
  return dom instanceof HTMLElement ? dom : null;
}

/** Lucide-style link glyph; mirrors the previous FormatBubble icon. */
function LinkIcon(): JSX.Element {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable={false}
    >
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  );
}

export function FloatingBlockChrome({
  editor,
}: FloatingBlockChromeProps): JSX.Element | null {
  const [hoverTarget, setHoverTarget] = useState<TargetBlock | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [chromeHovered, setChromeHovered] = useState(false);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const chromeElRef = useRef<HTMLDivElement | null>(null);

  // Inline-link UI state — when the writer clicks the link button,
  // toggle to an inline URL input. Mirrors the previous FormatBubble
  // affordance, ported into the unified bubble.
  const [linkMode, setLinkMode] = useState<'closed' | 'editing'>('closed');
  const [linkValue, setLinkValue] = useState('');
  const linkInputRef = useRef<HTMLInputElement | null>(null);

  // ONE selector that captures everything the bubble needs from the
  // editor state — top-level block index at the caret, the mark
  // states, selection emptiness, focused flag. useEditorState only
  // re-renders on shallow-changes, so this is cheap.
  const stateInfo = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) {
        return {
          selectionTarget: null as TargetBlock | null,
          selectionEmpty: true,
          isFocused: false,
          isInTable: false,
          bold: false,
          italic: false,
          code: false,
          link: false,
        };
      }
      const { from } = e.state.selection;
      const top = topLevelAtPos(e, from);
      return {
        selectionTarget: top
          ? ({
              idx: top.idx,
              blockType: top.blockType,
              pos: top.blockPos,
              source: 'selection' as const,
            } satisfies TargetBlock)
          : null,
        selectionEmpty: e.state.selection.empty,
        isFocused: e.isFocused,
        // Table cells have their own contextual bubble (TableMenu); the
        // block-level bubble would fight it inside tables.
        isInTable: e.isActive('tableCell') || e.isActive('tableHeader'),
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        code: e.isActive('code'),
        link: e.isActive('link'),
      };
    },
  });

  // Active target: selection wins when the editor is focused; hover
  // is the fallback so the bubble can preview a block before the
  // caret lands there.
  const target: TargetBlock | null = stateInfo.isFocused
    ? stateInfo.selectionTarget
    : (hoverTarget ?? stateInfo.selectionTarget);

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
      setHoverTarget(null);
      hideTimerRef.current = undefined;
    }, HIDE_HYSTERESIS_MS);
  }, [clearHideTimer]);

  // Recompute cached attrs on every editor transaction that may have
  // changed the active block.
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

  // Reposition above the block whenever the target or layout changes.
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
    const blockRect = blockDOM.getBoundingClientRect();
    const chromeRect = chromeElRef.current.getBoundingClientRect();
    const chromeHeight = chromeRect.height > 0 ? chromeRect.height : 36;
    // Default: above the block. Fall below if there isn't room above.
    let top = blockRect.top - chromeHeight - BUBBLE_GAP_PX;
    if (top < 8) top = blockRect.bottom + BUBBLE_GAP_PX;
    const left = blockRect.left;
    setPosition({ top, left });
  }, [editor, target]);

  // Reposition AFTER paint so chrome has a measured size. useLayoutEffect
  // prevents a flicker where the bubble is briefly off-screen on first
  // render.
  useLayoutEffect(() => {
    reposition();
  }, [reposition, targetAttrs]);

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

  // Hover tracking — drives the fallback target when the editor isn't
  // focused. When focused, the selection-target wins and hover is
  // effectively ignored.
  useEffect(() => {
    if (!editor) return;
    const surface = editor.view.dom as HTMLElement;

    const processEvent = (e: MouseEvent): void => {
      const next = targetBlockFromEvent(editor, e);
      if (!next) {
        if (!chromeHovered) scheduleHide();
        return;
      }
      clearHideTimer();
      setHoverTarget((prev) => {
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

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  // Pre-fill the URL input when entering link mode.
  useEffect(() => {
    if (linkMode === 'editing' && editor) {
      const href = editor.getAttributes('link')?.href as string | undefined;
      setLinkValue(typeof href === 'string' ? href : '');
      queueMicrotask(() => linkInputRef.current?.focus());
    }
  }, [linkMode, editor]);

  // -------- Block-level actions ---------------------------------------

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
      setHoverTarget(null);
    },
    [editor, target],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLButtonElement>): void => {
      if (!editor || !target || !e.dataTransfer) return;
      const view = editor.view;
      const pos = topLevelBlockPos(editor, target.idx);
      if (pos == null) return;
      view.focus();
      const selection = NodeSelection.create(view.state.doc, pos);
      view.dispatch(view.state.tr.setSelection(selection));
      const slice = view.state.selection.content();
      const { dom, text } = view.serializeForClipboard(slice);
      e.dataTransfer.clearData();
      e.dataTransfer.setData('text/html', dom.innerHTML);
      e.dataTransfer.setData('text/plain', text);
      e.dataTransfer.effectAllowed = 'copyMove';
      (view as unknown as { dragging: { slice: typeof slice; move: boolean } })
        .dragging = { slice, move: true };
      setHoverTarget(null);
    },
    [editor, target],
  );

  // -------- Inline-mark commands --------------------------------------

  const toggleBold = useCallback(() => {
    editor?.chain().focus().toggleBold().run();
  }, [editor]);
  const toggleItalic = useCallback(() => {
    editor?.chain().focus().toggleItalic().run();
  }, [editor]);
  const toggleCode = useCallback(() => {
    editor?.chain().focus().toggleCode().run();
  }, [editor]);

  const applyLink = useCallback((): void => {
    if (!editor) return;
    const href = linkValue.trim();
    if (!href || !isAllowedLink(href)) {
      setLinkMode('closed');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setLinkMode('closed');
  }, [editor, linkValue]);

  const removeLink = useCallback((): void => {
    if (!editor) return;
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkMode('closed');
  }, [editor]);

  const onLinkButton = useCallback((): void => {
    setLinkMode((prev) => (prev === 'editing' ? 'closed' : 'editing'));
  }, []);

  // -------- Render ---------------------------------------------------

  const blockType = target?.blockType ?? 'paragraph';
  const pdType = useMemo(() => pdBlockTypeFor(blockType), [blockType]);
  const headingLevel =
    blockType === 'heading' && targetAttrs
      ? Number(targetAttrs.level ?? 1)
      : null;
  const baseLabel = humanLabelFor(blockType);
  const lower =
    (headingLevel != null && Number.isFinite(headingLevel)
      ? `${baseLabel} ${headingLevel}`
      : baseLabel
    ).toLowerCase();

  const visible = editor != null && target != null && !stateInfo.isInTable;
  // Link button is disabled when there's nothing to mark (and no
  // existing link to edit at the caret).
  const linkActionable = !stateInfo.selectionEmpty || stateInfo.link;

  return (
    <div
      ref={chromeElRef}
      className={
        'paper-floating-chrome' + (visible ? ' is-tracking' : '')
      }
      data-block-type={target?.blockType}
      role="toolbar"
      aria-label="Block toolbar"
      aria-hidden={!visible}
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
      <button
        type="button"
        className="paper-block__drag-handle"
        aria-label={`Drag ${lower}`}
        title="Drag to reorder"
        draggable
        data-drag-handle
        onDragStart={handleDragStart}
      >
        ⋮⋮
      </button>
      <span className="paper-format-bubble__sep" aria-hidden="true" />
      <button
        type="button"
        className={
          'paper-format-bubble__btn paper-format-bubble__btn--bold' +
          (stateInfo.bold ? ' paper-format-bubble__btn--active' : '')
        }
        aria-label="Bold"
        aria-pressed={stateInfo.bold}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggleBold}
      >
        B
      </button>
      <button
        type="button"
        className={
          'paper-format-bubble__btn paper-format-bubble__btn--italic' +
          (stateInfo.italic ? ' paper-format-bubble__btn--active' : '')
        }
        aria-label="Italic"
        aria-pressed={stateInfo.italic}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggleItalic}
      >
        I
      </button>
      <button
        type="button"
        className={
          'paper-format-bubble__btn paper-format-bubble__btn--code' +
          (stateInfo.code ? ' paper-format-bubble__btn--active' : '')
        }
        aria-label="Inline code"
        aria-pressed={stateInfo.code}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggleCode}
      >
        {'</>'}
      </button>
      <button
        type="button"
        className={
          'paper-format-bubble__btn paper-format-bubble__btn--link' +
          (stateInfo.link ? ' paper-format-bubble__btn--active' : '')
        }
        aria-label={stateInfo.link ? 'Edit or remove link' : 'Link'}
        aria-pressed={stateInfo.link}
        data-link-state={stateInfo.link ? 'linked' : 'unlinked'}
        disabled={!linkActionable}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onLinkButton}
      >
        <LinkIcon />
      </button>
      {linkMode === 'editing' && linkActionable ? (
        <div className="paper-format-bubble__link-row" data-testid="bubble-link-row">
          <input
            ref={linkInputRef}
            type="url"
            className="paper-format-bubble__link-input"
            aria-label="Link URL"
            placeholder="https://"
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setLinkMode('closed');
              }
            }}
            onMouseDown={(e) => e.stopPropagation()}
          />
          {stateInfo.link ? (
            <button
              type="button"
              className="paper-format-bubble__link-remove"
              aria-label="Remove link"
              onMouseDown={(e) => e.preventDefault()}
              onClick={removeLink}
            >
              Remove
            </button>
          ) : null}
        </div>
      ) : null}
      <span className="paper-format-bubble__sep" aria-hidden="true" />
      <div className="paper-block__variant-slot">
        {pdType !== null && target && targetAttrs ? (
          <VariantChip
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
