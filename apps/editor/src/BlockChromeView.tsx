/**
 * BlockChromeView — the canonical React NodeView for every paperflow block.
 *
 * This component replaces v0.4's three-piece custom pipeline:
 *   - hand-rolled DOM in BlockChrome.ts (`renderChromeDom`/`bindChromeHandlers`),
 *   - module-scoped variant-slot registry + portal in Editor.tsx,
 *   - `ignoreMutation` workaround for ProseMirror's MutationObserver.
 *
 * The official TipTap 3 pattern is `ReactNodeViewRenderer(Component)`. Inside
 * the component we use:
 *
 *   <NodeViewWrapper>   — the root DOM element ProseMirror tracks; everything
 *                         inside it lives in the editor's React tree, owned by
 *                         the editor's React root (not a NodeView-local
 *                         createRoot). Mutations to it don't trigger
 *                         ProseMirror's "unexpected mutation" rebuild loop
 *                         because TipTap registers the React-rendered subtree
 *                         with the EditorView.
 *
 *   <NodeViewContent />  — the ProseMirror content placeholder. Whatever tag
 *                         we set via `as` (p / h1-h3 / ul / ol / blockquote /
 *                         pre) becomes the contentDOM that ProseMirror writes
 *                         inline content into.
 *
 *   useEditorState({ editor, selector }) — TipTap 3's official subscription
 *                         hook. The selector runs on every TX and the
 *                         component only re-renders when its output changes.
 *                         We use it to read selection-emptiness (for the
 *                         `.is-selecting` class) and the wrapper's top-level
 *                         index (for `data-block-idx`).
 *
 * What goes in this file:
 *   - the chrome toolbar (drag handle + label + variant chip + delete)
 *   - the "+" between-blocks button
 *   - hover state with 300ms hide hysteresis
 *   - selection-driven `.is-selecting` class
 *   - variant-style application (live preview of variant choices)
 *   - native HTML5 drag wiring via a useEffect adapter
 *
 * What does NOT go in this file:
 *   - block schema (handled by the base TipTap extensions)
 *   - slash menu logic (A3 — separate extension)
 *   - inline format bubble (A4 — separate component)
 *   - variant catalog math (delegated to @portable-doc/variants)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { NodeViewContent, NodeViewWrapper, useEditorState } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';

/** NodeViewContent's `as` prop is generic over `keyof JSX.IntrinsicElements`
 *  with `NoInfer<T>`, so TS can't widen the union — passing a dynamic tag
 *  triggers TS2322. A local re-typing keeps callers clean while preserving
 *  runtime behavior (TipTap spreads `as` as the JSX tag). */
const TagContent = NodeViewContent as unknown as ComponentType<{
  as?: keyof React.JSX.IntrinsicElements;
  className?: string;
  style?: React.CSSProperties;
}>;
import { VARIANT_CATALOG } from '@portable-doc/variants';
import type { BlockType } from '@portable-doc/core';
import { VariantChip } from './VariantChip.js';
import {
  bindDragHandlers,
  humanLabelFor,
  pdBlockTypeFor,
  type ChromeParts,
} from './BlockChrome.js';

/** Tag union we route block types into. Narrowing this lets
 *  `<NodeViewContent as={tag} />` typecheck — its `as` prop is generic over
 *  `keyof React.JSX.IntrinsicElements`. */
type ContentTag =
  | 'p'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'ul'
  | 'ol'
  | 'blockquote'
  | 'pre'
  | 'hr'
  | 'div';

/** Per-node-type contentDOM tag — must match the schema's `toDOM` shape so
 *  ProseMirror writes inline content into the right element. Heading is
 *  level-dependent so the spec for "<h1> exists in the surface" survives
 *  the node-view rewrite. */
function contentTagFor(
  nodeName: string,
  attrs: Record<string, unknown>,
): ContentTag {
  switch (nodeName) {
    case 'heading': {
      const level = Number(attrs?.level ?? 1);
      const clamped = Math.max(1, Math.min(6, Number.isFinite(level) ? level : 1));
      return (`h${clamped}` as ContentTag);
    }
    case 'paragraph':
      return 'p';
    case 'bulletList':
      return 'ul';
    case 'orderedList':
      return 'ol';
    case 'blockquote':
      return 'blockquote';
    case 'codeBlock':
      return 'pre';
    case 'horizontalRule':
      return 'hr';
    default:
      return 'div';
  }
}

/** Resolve the variant axes into a React `CSSProperties` object so we
 *  can hand it to NodeViewContent as a `style` prop. Passing as a prop
 *  (rather than imperatively writing `el.style.foo`) is required because
 *  `<NodeViewContent>` re-renders on every TX and replaces the element's
 *  inline style with React-owned values — any imperative writes get
 *  clobbered.
 *
 *  Returns `null` for blocks without a catalog entry or without a
 *  `variant` attr; callers should skip applying anything in that case
 *  so the static `.paper-column blockquote { … }` rules from paper.css
 *  remain the default look. */
function resolveVariantStyle(
  blockType: string,
  attrs: Record<string, unknown>,
): React.CSSProperties | null {
  const schema = VARIANT_CATALOG[blockType as BlockType];
  if (!schema) return null;
  const variant = attrs.variant as Record<string, string> | null | undefined;
  if (!variant) return null;
  // Fill missing axes with the catalog's first option so resolve() never
  // crashes on a partial selection (chip may emit one axis at a time).
  const axes: Record<string, string> = {};
  for (const [axisName, options] of Object.entries(schema.axes)) {
    axes[axisName] = variant[axisName] ?? (options as readonly string[])[0]!;
  }
  let style: ReturnType<typeof schema.resolve>;
  try {
    style = schema.resolve(axes);
  } catch {
    return null;
  }
  const css: React.CSSProperties = {};
  if (style.backgroundColor) css.backgroundColor = style.backgroundColor;
  if (style.borderColor) {
    // Callout uses a left-rail accent in the editor view, not a full border.
    css.borderLeftColor = style.borderColor;
    css.borderLeftStyle = 'solid';
  }
  if (typeof style.borderWidth === 'number') {
    css.borderLeftWidth = `${style.borderWidth}px`;
  }
  if (typeof style.padding === 'number') {
    css.padding = `${style.padding}px`;
  }
  if (typeof style.margin === 'number') {
    css.margin = `0 0 ${style.margin}px`;
  }
  return css;
}

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

export function BlockChromeView(props: ReactNodeViewProps): JSX.Element {
  const { editor, node, getPos } = props;
  const blockType = node.type.name;
  const pdType = pdBlockTypeFor(blockType);
  const contentTag = contentTagFor(blockType, node.attrs ?? {});

  // Top-level vs nested. Nested blocks (paragraphs inside lists/callouts)
  // skip the chrome entirely — their parent block already carries it.
  const isTopLevel = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      try {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos !== 'number') return false;
        return e.state.doc.resolve(pos).depth === 0;
      } catch {
        return false;
      }
    },
  });

  // Top-level child index — used by drag-and-drop. Re-read on every TX so
  // inserts/deletes above this block update the value reactively.
  const topLevelIdx = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      try {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos !== 'number') return undefined;
        return e.state.doc.resolve(pos).index(0);
      } catch {
        return undefined;
      }
    },
  });

  // Selection-emptiness. When the writer has a non-empty selection anywhere
  // in the doc, A4's BubbleMenu owns the floating-chrome layer — block
  // chrome must hide so the two don't stack (grill Q3).
  const selectionEmpty = useEditorState({
    editor,
    selector: ({ editor: e }) => e.state.selection.empty,
  });

  // Hover state with 300ms hide hysteresis. Keeps the chrome stable while
  // the mouse crosses block boundaries; lets the writer move from the
  // block's text up to the chrome buttons without it disappearing.
  const [isHovered, setIsHovered] = useState(false);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const onMouseEnter = (): void => {
    if (hideTimerRef.current !== undefined) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = undefined;
    }
    setIsHovered(true);
  };
  const onMouseLeave = (): void => {
    if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setIsHovered(false);
      hideTimerRef.current = undefined;
    }, 300);
  };
  useEffect(() => () => {
    if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
  }, []);

  // Resolve variant axes into a React style object. Passing this as
  // `style={…}` on NodeViewContent keeps the values React-owned so they
  // survive the inline-style replacement that `<NodeViewContent>` does on
  // every TX (it writes `{ whiteSpace: 'pre-wrap', ...props.style }`).
  const wrapperElRef = useRef<HTMLDivElement | null>(null);
  // `pdType` is the PortableDoc block-type name ('callout' for tiptap's
  // 'blockquote', 'code' for 'codeBlock', null for blocks without a
  // catalog entry). VARIANT_CATALOG is keyed by these names, NOT the
  // raw TipTap node name.
  const variantStyle = useMemo(
    () => (pdType === null ? null : resolveVariantStyle(pdType, node.attrs ?? {})),
    [pdType, node.attrs],
  );

  // Drag handlers. The existing bindDragHandlers is well-tested; we adapt
  // it via a useEffect that fires once per mount and tears down on unmount.
  // It reads the current top-level idx lazily via the getter so re-orderings
  // are always consistent.
  const dragBtnRef = useRef<HTMLButtonElement | null>(null);
  const idxRef = useRef<number | undefined>(topLevelIdx);
  idxRef.current = topLevelIdx;
  useEffect(() => {
    if (!isTopLevel) return undefined;
    if (!wrapperElRef.current || !dragBtnRef.current) return undefined;
    // bindDragHandlers expects a ChromeParts object; only `dragBtn` is
    // actually read inside, so we cast a minimal subset.
    // bindDragHandlers reads dragBtn for dragstart/dragend; toolbar is
    // declared on ChromeParts but unused in the function body. Provide a
    // stub div so the interface is satisfied without leaking React-owned
    // DOM out of the component.
    const parts: ChromeParts = {
      dragBtn: dragBtnRef.current,
      toolbar: document.createElement('div'),
    };
    const handle = bindDragHandlers(parts, wrapperElRef.current, editor, () => idxRef.current);
    return () => handle.destroy();
  }, [editor, isTopLevel]);

  // Chrome handlers.
  const handleDelete = (e: React.MouseEvent | React.KeyboardEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (typeof pos !== 'number') return;
    const liveNode = editor.state.doc.nodeAt(pos);
    if (!liveNode) return;
    editor.commands.deleteRange({ from: pos, to: pos + liveNode.nodeSize });
  };

  /** Insert an empty paragraph after this block, focus into it, and type
   *  `/` to open the slash menu so the writer picks the block type. */
  const handleInsertBelow = (e: React.MouseEvent | React.KeyboardEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (typeof pos !== 'number') return;
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
  };

  /** Variant chip change handler — merges new axes into the node's
   *  `variant` attr via setNodeMarkup at this node's current position. */
  const onVariantChange = useMemo(
    () =>
      (next: Record<string, string>): void => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos !== 'number') return;
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
    [editor, getPos],
  );

  // Nested blocks (paragraphs inside lists, callouts) skip chrome and
  // return a bare NodeViewContent wrapped in a thin marker div.
  if (!isTopLevel) {
    return (
      <NodeViewWrapper
        as="div"
        className="paper-block-nested"
        data-block-type={blockType}
      >
        <TagContent
          as={contentTag === 'hr' ? 'div' : contentTag}
          className="paper-block__content"
        />
      </NodeViewWrapper>
    );
  }

  const label = humanLabelFor(blockType);
  const lower = label.toLowerCase();
  const isSelecting = !selectionEmpty;
  const wrapperClassName = [
    'paper-block',
    isHovered ? 'is-hovered' : '',
    isSelecting ? 'is-selecting' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <NodeViewWrapper
      as="div"
      className="paper-block-outer"
      ref={wrapperElRef}
    >
      <div
        className={wrapperClassName}
        data-block-type={blockType}
        data-block-idx={topLevelIdx ?? undefined}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div
          className="paper-block__chrome"
          role="toolbar"
          aria-label={`${label} block toolbar`}
        >
          <button
            ref={dragBtnRef}
            type="button"
            className="paper-block-drag-handle"
            aria-label={`Drag ${lower}`}
            data-block-type={blockType}
            draggable
            // Prevent ProseMirror from treating the handle as a text
            // node when the writer mousedowns on it before dragging.
            onMouseDown={(e) => e.stopPropagation()}
            // The button is purely a drag affordance — clicking it
            // shouldn't dispatch a command.
            onClick={(e) => e.preventDefault()}
          >
            ⋮⋮
          </button>
          <span className="paper-block__label">{label}</span>
          <div className="paper-block__variant-slot">
            {pdType !== null ? (
              <VariantChip
                blockType={pdType}
                attrs={node.attrs ?? {}}
                onChange={onVariantChange}
              />
            ) : null}
          </div>
          <button
            type="button"
            className="paper-block-delete"
            aria-label={`Delete ${lower}`}
            data-block-type={blockType}
            onMouseDown={handleDelete}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') handleDelete(e);
            }}
          >
            ×
          </button>
        </div>
        {contentTag === 'hr' ? (
          // Horizontal rule has no inline content — render the rule
          // element directly and skip NodeViewContent.
          <hr className="paper-block__content" />
        ) : (
          <TagContent
            as={contentTag}
            className="paper-block__content"
            style={variantStyle ?? undefined}
          />
        )}
      </div>
      <button
        type="button"
        className="paper-block__insert"
        aria-label="Insert block below"
        data-block-type={blockType}
        onMouseDown={handleInsertBelow}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleInsertBelow(e);
        }}
      >
        +
      </button>
    </NodeViewWrapper>
  );
}
