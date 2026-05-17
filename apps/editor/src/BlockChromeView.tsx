/**
 * BlockChromeView — the canonical React NodeView for every paperflow block.
 *
 * Post-CW5: this component renders ONLY the block content + variant style.
 * The chrome cluster (drag handle, label, variant chip, delete, "+") lives
 * once per editor in `FloatingBlockChrome.tsx`, tracking the currently-
 * hovered block via mouse coordinates. The per-block toolbar that lived
 * here previously is gone.
 *
 * What this component still owns:
 *   - `<NodeViewWrapper>` + `<NodeViewContent>` (the canonical TipTap shape).
 *   - `data-block-type` + `data-block-idx` on the wrapper — the floating
 *     chrome reads these via ancestor walk to resolve the target block.
 *   - The variant-style application (live preview of variant choices on
 *     the block's content element).
 *   - `paper-block-nested` markers for nested blocks (paragraphs inside
 *     lists / callouts) so styling can hide affordances on them.
 *
 * What moved out:
 *   - The chrome toolbar JSX (drag handle, label, variant chip, delete).
 *   - The "+" insert-below button.
 *   - The per-block `mouseenter` / `mouseleave` hover state with 300ms
 *     hide hysteresis (the floating-chrome owns hover semantics now via
 *     a single mousemove listener on the editor surface).
 *   - The native HTML5 drag wiring (dragstart attaches to the floating
 *     drag button now; dragover/drop attach once at the editor surface
 *     instead of N times).
 */
import { useEditorState, NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';

// NodeViewContent's `as` prop is generic over `keyof JSX.IntrinsicElements`
// with `NoInfer<T>` upstream, so TS can't widen a union — passing a dynamic
// `ContentTag` value would trigger TS2322. We compile-time augment the
// module to widen the generic; see
// `src/types/tiptap-react-augment.d.ts` for the rationale.
import { VARIANT_CATALOG } from '@portable-doc/variants';
import type { BlockType } from '@portable-doc/core';
import { useMemo } from 'react';
import { pdBlockTypeFor } from './lib/block-chrome-helpers.js';

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

  // Collapsed `useEditorState` selector — ONE subscription returns BOTH
  // derived flags as an object. The library shallow-compares the result
  // and only re-renders the NodeView when one of these fields actually
  // changes. The previous two-call version ran each selector on every
  // TX and could trigger independent React re-render passes; collapsing
  // matches the TipTap 3 canonical pattern + cuts render churn under
  // heavy typing.
  //   - `isTopLevel`: top-level vs nested. Nested blocks (paragraphs
  //     inside lists/callouts) get a thin marker wrapper; the floating
  //     chrome ignores them.
  //   - `topLevelIdx`: top-level child index — written to
  //     `data-block-idx` so the floating chrome can resolve the target
  //     block from a DOM event.target walk.
  const { isTopLevel, topLevelIdx } = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      try {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos !== 'number') {
          return { isTopLevel: false, topLevelIdx: undefined as number | undefined };
        }
        const $pos = e.state.doc.resolve(pos);
        return {
          isTopLevel: $pos.depth === 0,
          topLevelIdx: $pos.index(0) as number | undefined,
        };
      } catch {
        return { isTopLevel: false, topLevelIdx: undefined as number | undefined };
      }
    },
  });

  // Resolve variant axes into a React style object. `pdType` is the
  // PortableDoc block-type name ('callout' for tiptap's 'blockquote',
  // 'code' for 'codeBlock', null for blocks without a catalog entry).
  // VARIANT_CATALOG is keyed by these names, NOT the raw TipTap node
  // name.
  const variantStyle = useMemo(
    () => (pdType === null ? null : resolveVariantStyle(pdType, node.attrs ?? {})),
    [pdType, node.attrs],
  );

  // Nested blocks — thin marker so future styling can hide affordances.
  if (!isTopLevel) {
    return (
      <NodeViewWrapper
        as="div"
        className="paper-block-nested"
        data-block-type={blockType}
      >
        <NodeViewContent
          as={contentTag === 'hr' ? 'div' : contentTag}
          className="paper-block__content"
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="div"
      className="paper-block"
      data-block-type={blockType}
      data-block-idx={topLevelIdx ?? undefined}
    >
      {contentTag === 'hr' ? (
        // Horizontal rule has no inline content — render the rule
        // element directly and skip NodeViewContent.
        <hr className="paper-block__content" />
      ) : (
        <NodeViewContent
          as={contentTag}
          className="paper-block__content"
          style={variantStyle ?? undefined}
        />
      )}
    </NodeViewWrapper>
  );
}
