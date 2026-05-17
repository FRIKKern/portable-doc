/**
 * A2 — withBlockChrome(extension): Node factory.
 *
 * Wraps a base TipTap Node extension (Paragraph, Heading, BulletList, etc.)
 * with a React-based NodeView that renders paperflow's block chrome (drag
 * handle, type label, variant chip, delete, "+" insert).
 *
 * The implementation is canonical TipTap 3:
 *
 *   - `addNodeView()` returns `ReactNodeViewRenderer(BlockChromeView)`.
 *     TipTap mounts the React component via a portal from the editor's
 *     stable React root (set up in Editor.tsx via `useEditor`), NOT a
 *     fresh `createRoot` per node. That portal pattern is what makes the
 *     pre-existing "Attempted to synchronously unmount a root while React
 *     was already rendering" warning impossible to reproduce.
 *
 *   - `addAttributes()` declares the optional `variant` attr (for blocks
 *     that have a catalog entry). Stored as a JSON object on the node;
 *     serialized to HTML as `data-variant`. Read live by the NodeView's
 *     React component which converts it to inline style via
 *     `VARIANT_CATALOG[blockType].resolve(axes)`.
 *
 * Everything visual (chrome, variant style preview, drag, hover, insert)
 * is owned by `BlockChromeView.tsx`. This file is intentionally thin.
 */
import type { Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { pdBlockTypeFor } from '../lib/block-chrome-helpers.js';
import { BlockChromeView } from '../BlockChromeView.js';

/**
 * Wrap a base TipTap Node so every instance renders with paper-block chrome.
 *
 * The returned Node behaves identically to the input — same name, schema,
 * commands, and input rules — but its DOM is a React NodeView that mounts
 * the chrome around the contentDOM.
 */
export function withBlockChrome<TNode extends Node>(baseExtension: TNode): TNode {
  const blockType = baseExtension.name;
  const pdType = pdBlockTypeFor(blockType);
  const hasVariants = pdType !== null;

  return baseExtension.extend({
    // `draggable: true` is the canonical ProseMirror/TipTap signal that
    // the whole node can be dragged as a unit. Combined with
    // `tiptap-extension-global-drag-handle` (the headless extension that
    // owns the `⋮⋮` glyph + dragstart wiring) and the schema flag here,
    // PM's NodeView.onDragStart picks up the mousedown, sets a
    // NodeSelection at this node's position, hands a drag image to the
    // OS, and lets PM's standard drop machinery handle the reorder.
    // `prosemirror-dropcursor` (registered via StarterKit by default)
    // paints the visual drop position during the drag — no app-owned
    // drop-indicator DOM lives anywhere.
    draggable: true,
    addAttributes() {
      // Preserve any attributes the base extension declares.
      const base = (this.parent?.() ?? {}) as Record<string, unknown>;
      if (!hasVariants) return base;
      return {
        ...base,
        variant: {
          default: null,
          parseHTML: (el: HTMLElement) => {
            const raw = el.getAttribute('data-variant');
            if (!raw) return null;
            try {
              return JSON.parse(raw) as Record<string, string>;
            } catch {
              return null;
            }
          },
          renderHTML: (attrs: Record<string, unknown>) => {
            const v = attrs.variant as Record<string, string> | null | undefined;
            if (!v || Object.keys(v).length === 0) return {};
            return { 'data-variant': JSON.stringify(v) };
          },
        },
      };
    },
    addNodeView() {
      // ReactNodeViewRenderer:
      //   - `as: 'div'` matches our v0.4 wrapper convention (a `<div>`
      //     hosts the NodeView's outer paper-block-outer / paper-block-
      //     nested element).
      //   - `update` returns `false` when the heading level changes so
      //     ProseMirror rebuilds the contentDOM with the right tag
      //     (h1 vs h2 vs h3). For other attr changes the component
      //     re-renders in place.
      return ReactNodeViewRenderer(BlockChromeView, {
        as: 'div',
        update: ({ oldNode, newNode, updateProps }) => {
          if (oldNode.type.name !== newNode.type.name) return false;
          if (
            newNode.type.name === 'heading' &&
            oldNode.attrs.level !== newNode.attrs.level
          ) {
            return false;
          }
          updateProps();
          return true;
        },
      });
    },
  }) as TNode;
}
