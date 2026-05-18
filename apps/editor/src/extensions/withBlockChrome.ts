/**
 * withBlockChrome(extension): block-level paperflow adapter.
 *
 * Wraps a base TipTap Node so each instance is:
 *   - styled by paper.css via a `paper-block` class on the rendered
 *     element (added through the canonical TipTap `HTMLAttributes`
 *     option, so the schema's own `toDOM` shape stays in charge).
 *   - carrying optional variant axes (callout / code) emitted as per-axis
 *     `data-tone="warning"`, `data-emphasis="bold"`, etc. — CSS rules in
 *     paper.css own the visual rendering, not JS-inline-style.
 *
 * What this file used to do
 * -------------------------
 * Until D + E, every wrapped block also mounted a React NodeView
 * (`BlockChromeView`) that wrote inline `style` from the variant
 * catalog and reserved space for an embedded chrome cluster. Both
 * jobs moved: the cluster lives once per editor in
 * `FloatingBlockChrome.tsx`; the variant style lives in paper.css
 * keyed off the per-axis data-attrs this extension emits. The
 * NodeView round-trip — and the React module-augmentation it
 * required — are gone. Every wrapped block now renders the
 * canonical TipTap element directly.
 */
import type { Node } from '@tiptap/core';
import { pdBlockTypeFor } from '../lib/block-chrome-helpers.js';

/** Emit per-axis `data-*` attributes from the JSON variant object so
 *  CSS can select on them (`blockquote[data-tone="warning"]`). When the
 *  variant is null or empty we emit nothing — the block's static look
 *  from paper.css remains the default. */
function renderVariantHTML(
  variant: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!variant) return {};
  const out: Record<string, string> = {};
  for (const [axis, value] of Object.entries(variant)) {
    if (typeof value === 'string' && value.length > 0) {
      out[`data-${axis}`] = value;
    }
  }
  return out;
}

/** Parse the JSON object back from the rendered per-axis `data-*` attrs
 *  on the DOM. The catalog's axes are listed up front so we know which
 *  attrs are ours vs. unrelated host attrs that may live on the same
 *  element. */
function parseVariantHTML(
  el: HTMLElement,
  axes: readonly string[],
): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const axis of axes) {
    const v = el.getAttribute(`data-${axis}`);
    if (typeof v === 'string' && v.length > 0) out[axis] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Catalog of variant axes per TipTap node name. Mirrors
 *  `@portable-doc/variants`'s VARIANT_CATALOG but keyed by the TipTap
 *  node name (`blockquote`, `codeBlock`) rather than the PortableDoc
 *  block name (`callout`, `code`). Centralised here so the round-trip
 *  parser knows which `data-*` attributes belong to us. */
const VARIANT_AXES: Record<string, readonly string[]> = {
  blockquote: ['tone', 'emphasis'],
  codeBlock: ['theme', 'density'],
};

/**
 * Wrap a base TipTap Node so every instance:
 *   1. renders with `class="paper-block"` on its element
 *   2. carries an optional `variant` attribute (callout / code only),
 *      emitted as per-axis `data-*` attrs that paper.css selects on
 *
 * Drag is opt-in via the ⋮⋮ button in FloatingBlockChrome — see the
 * comment on the returned spec below. We deliberately do NOT set
 * schema `draggable: true` (it makes PM treat mousedown-and-drag on
 * text as a block-drag, which steals text-select).
 */
export function withBlockChrome<TNode extends Node>(baseExtension: TNode): TNode {
  const blockType = baseExtension.name;
  const pdType = pdBlockTypeFor(blockType);
  const hasVariants = pdType !== null && VARIANT_AXES[blockType] !== undefined;
  const axes = VARIANT_AXES[blockType] ?? [];

  return baseExtension.extend({
    // NO schema-level `draggable: true`. PM's mousedown handler reads
    // schema-draggable and, when set, dynamically writes
    // `draggable="true"` to the DOM element on every mousedown — which
    // breaks text-select inside the block on Chrome/Safari (mousedown
    // on text inside a draggable element starts a node-drag, not a
    // text-select).
    //
    // Drag still works: the ⋮⋮ button in FloatingBlockChrome has its
    // OWN HTML5 `draggable` attribute (it's a separate DOM element
    // outside the PM surface, so the schema-draggable trap doesn't
    // apply). Its onDragStart sets `view.dragging = { slice, move,
    // node: NodeSelection }`. PM's drop handler reads `node` and
    // calls `node.replace(tr)` — proper node-move on drop without
    // needing schema-draggable to gate it.
    addOptions() {
      // Merge the `paper-block` class into the base extension's
      // `HTMLAttributes` so the schema's natural toDOM shape paints it
      // (no NodeView indirection). Other options the base extension
      // declares — `levels` for Heading, `lowlight` for CodeBlock —
      // pass through untouched via the parent spread.
      const parent = (this.parent?.() ?? {}) as {
        HTMLAttributes?: Record<string, string>;
      } & Record<string, unknown>;
      const parentAttrs = parent.HTMLAttributes ?? {};
      const existingClass = parentAttrs.class ?? '';
      return {
        ...parent,
        HTMLAttributes: {
          ...parentAttrs,
          class: existingClass
            ? `${existingClass} paper-block`
            : 'paper-block',
        },
      };
    },
    addAttributes() {
      const base = (this.parent?.() ?? {}) as Record<string, unknown>;
      if (!hasVariants) return base;
      return {
        ...base,
        variant: {
          default: null,
          parseHTML: (el: HTMLElement) => parseVariantHTML(el, axes),
          renderHTML: (attrs: Record<string, unknown>) =>
            renderVariantHTML(attrs.variant as Record<string, string> | null),
        },
      };
    },
  }) as TNode;
}
