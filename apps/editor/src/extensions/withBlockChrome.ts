/**
 * A2 — withBlockChrome(extension): Node factory.
 *
 * Pattern (grill Q1, Q5)
 * ----------------------
 * `withBlockChrome` takes a base TipTap **Node** extension (Paragraph,
 * Heading, BulletList, OrderedList, Blockquote, CodeBlock, HorizontalRule)
 * and returns the same extension wrapped with an `addNodeView()` impl. The
 * node-view renders three pieces of DOM:
 *
 *     <div class="paper-block">
 *       <div class="paper-block__chrome">…drag · label · variant-slot · delete…</div>
 *       <{contentTag} class="paper-block__content">…contentDOM (ProseMirror)…</{contentTag}>
 *     </div>
 *     <button class="paper-block__insert">+</button>
 *
 * The chrome IS plain DOM — no React, no MutationObserver, no overlay layer.
 * It scrolls with the block by construction because it lives inside the
 * node-view's wrapper. The `+` button is a sibling of `.paper-block`, not
 * a child, so the visual rest-state (~25% opacity) doesn't bleed into the
 * block outline.
 *
 * Integration in Editor.tsx
 * -------------------------
 * StarterKit bundles Paragraph + Heading + BulletList + OrderedList +
 * Blockquote + CodeBlock + HorizontalRule as separate Node instances. We:
 *   1. configure StarterKit to skip those seven (`paragraph: false, …`).
 *   2. import each base Node directly from its `@tiptap/extension-*`
 *      package and call `withBlockChrome(Base.configure({…}))`.
 *   3. include both the trimmed StarterKit (for marks + history + Document
 *      + Text + listItem etc.) and the seven wrapped Nodes side-by-side.
 *
 * Deferred (NOT in A2)
 * --------------------
 *   - drag binding   → A6 (handle is a button only)
 *   - slash trigger  → A3
 *   - variant chip   → A5 (slot exists, empty)
 *   - BubbleMenu     → A4 (z-index ordering already locked in paper.css)
 *
 * The whole module is < 120 LOC; deeper logic (DOM helpers, handler wiring,
 * selection visibility) lives in `../BlockChrome.ts`.
 */
import type { Node } from '@tiptap/core';
import {
  bindChromeHandlers,
  bindDragHandlers,
  mountVariantChip,
  pdBlockTypeFor,
  renderChromeDom,
  updateChromeForSelection,
  type ChromeParts,
  type DragHandle,
  type VariantChipHandle,
} from '../BlockChrome.js';

// ---------------------------------------------------------------------------
// Per-node-type contentDOM tag — needs to match the schema's `toDOM` shape so
// the inline content lands inside the right HTML element. Heading is level-
// dependent so the spec for "<h1> exists in the surface" survives the
// node-view rewrite.
// ---------------------------------------------------------------------------

function contentTagFor(
  nodeName: string,
  attrs: Record<string, unknown>,
): string {
  switch (nodeName) {
    case 'heading': {
      const level = Number(attrs?.level ?? 1);
      const clamped = Math.max(1, Math.min(6, Number.isFinite(level) ? level : 1));
      return `h${clamped}`;
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

// ---------------------------------------------------------------------------
// The factory
// ---------------------------------------------------------------------------

/**
 * Wrap a base TipTap Node so every instance renders with paper-block chrome.
 *
 * The returned Node behaves identically to the input — same name, schema,
 * commands, and input rules — but its DOM is now a node-view that injects
 * the drag handle, type label, variant-chip slot, delete button, and
 * `+` between-blocks button.
 */
export function withBlockChrome<TNode extends Node>(baseExtension: TNode): TNode {
  const blockType = baseExtension.name;
  const pdType = pdBlockTypeFor(blockType);
  const hasVariants = pdType !== null;

  return baseExtension.extend({
    // A5 — declare a `variant` attribute on nodes that have a variant
    // catalog entry. Stored as a plain JSON object on the node. Rendered
    // into the DOM as `data-variant` (read-only — TipTap parses on input
    // but the visual is owned by the variant chip + paper.css). No render
    // hook for nodes without variants — keeps the schema diff minimal.
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
      return ({ editor, getPos, node }) => {
        const contentTag = contentTagFor(blockType, node.attrs ?? {});

        // Top-level only: paragraphs nested inside list-items or callouts
        // do NOT get their own chrome. ProseMirror's `resolve(pos).depth`
        // reports the depth of the resolved position; for a node that's a
        // direct child of the doc, `getPos()` returns the position BEFORE
        // the node, which sits at depth 0 (inside the document). Anything
        // deeper means we're inside a list item or a callout.
        let depth = 0;
        try {
          const pos = getPos?.();
          if (typeof pos === 'number') {
            depth = editor.state.doc.resolve(pos).depth;
          }
        } catch {
          /* getPos may transiently fail during mount — treat as top-level */
        }
        const isTopLevel = depth === 0;

        // ---- DOM scaffold ----
        const wrapper = document.createElement('div');
        wrapper.className = isTopLevel ? 'paper-block' : 'paper-block-nested';
        wrapper.setAttribute('data-block-type', blockType);

        // A6 — `data-block-idx` exposes this block's current top-level
        // child index for the native drag handlers (so the dragover
        // target can read its own idx out of the attribute instead of
        // having to walk the parent chain on every event). Re-computed
        // in `update` whenever the node-view rebuilds.
        const computeTopLevelIdx = (): number | undefined => {
          try {
            const pos = getPos?.();
            if (typeof pos !== 'number') return undefined;
            return editor.state.doc.resolve(pos).index(0);
          } catch {
            return undefined;
          }
        };
        if (isTopLevel) {
          const idx0 = computeTopLevelIdx();
          if (idx0 !== undefined) {
            wrapper.setAttribute('data-block-idx', String(idx0));
          }
        }

        if (isTopLevel) {
          const parts: ChromeParts = renderChromeDom(blockType);
          wrapper.appendChild(parts.toolbar);
          // Stash for handler binding (only top-level gets handlers).
          (wrapper as unknown as { __chromeParts: ChromeParts }).__chromeParts = parts;
        }

        // The contentDOM is what ProseMirror writes inline content into;
        // it must remain attached to the wrapper at all times. Leaf nodes
        // (horizontalRule) need no contentDOM — ProseMirror skips children
        // when `contentDOM` is null.
        const contentDOM =
          blockType === 'horizontalRule'
            ? null
            : (() => {
                const el = document.createElement(contentTag);
                el.className = 'paper-block__content';
                wrapper.appendChild(el);
                return el;
              })();
        if (!contentDOM && contentTag === 'hr') {
          const hr = document.createElement('hr');
          hr.className = 'paper-block__content';
          wrapper.appendChild(hr);
        }

        // The `+` insert button sits OUTSIDE the wrapper so its rest-state
        // opacity doesn't compose with the wrapper's outline hover state.
        // Nested paragraphs (inside lists / callouts) skip the outer
        // wrapper entirely — their parent block already carries chrome.
        const outer = document.createElement('div');
        outer.className = 'paper-block-outer';
        outer.appendChild(wrapper);

        // ---- A5 variant chip (mounts inside parts.variantSlot) ----
        // `chipHandle` lives in the node-view closure so update() can re-render
        // the chip on attribute changes and destroy() can tear the React root
        // down cleanly. `null` when the block type has no variants.
        let chipHandle: VariantChipHandle | null = null;
        // ---- A6 drag handle (HTML5 native; reads top-level idx) ----
        let dragHandle: DragHandle | null = null;

        if (isTopLevel) {
          const parts = (wrapper as unknown as { __chromeParts: ChromeParts })
            .__chromeParts;
          outer.appendChild(parts.insertBtn);

          // ---- Handlers ----
          bindChromeHandlers(parts, editor, () => {
            const pos = getPos?.();
            return typeof pos === 'number' ? pos : undefined;
          });

          // ---- A6: bind native HTML5 drag to the chrome's handle.
          // `getBlockIdx` re-reads on every event so inserts/deletes
          // above this block don't stale the source idx.
          dragHandle = bindDragHandlers(parts, wrapper, editor, computeTopLevelIdx);

          // ---- A5: mount React VariantChip into the chrome's slot ----
          if (pdType !== null) {
            chipHandle = mountVariantChip(
              parts.variantSlot,
              pdType,
              node.attrs ?? {},
              (next) => {
                // Merge new axes into the block's `variant` attribute via the
                // TipTap command. We target the focused block at this node's
                // position so multiple chips don't fight over a single
                // updateAttributes call.
                const pos = getPos?.();
                if (typeof pos !== 'number') return;
                const liveNode = editor.state.doc.nodeAt(pos);
                if (!liveNode) return;
                const prev = (liveNode.attrs?.variant as Record<string, string> | null) ?? {};
                const merged = { ...prev, ...next };
                editor
                  .chain()
                  .command(({ tr }) => {
                    tr.setNodeMarkup(pos, undefined, {
                      ...liveNode.attrs,
                      variant: merged,
                    });
                    return true;
                  })
                  .run();
              },
            );
          }
        }

        // ---- Hover state ----
        const onEnter = (): void => wrapper.classList.add('is-hovered');
        const onLeave = (): void => wrapper.classList.remove('is-hovered');
        wrapper.addEventListener('mouseenter', onEnter);
        wrapper.addEventListener('mouseleave', onLeave);

        // ---- Selection-driven chrome visibility (grill Q3) ----
        const onSelection = (): void => {
          updateChromeForSelection(wrapper, editor.state.selection.empty);
        };
        editor.on('selectionUpdate', onSelection);
        // Initialize once so the .is-selecting class reflects current state
        // immediately after mount (matters for tests + re-mounts).
        onSelection();

        return {
          dom: outer,
          contentDOM,
          // Re-check selection state on every node-view update; cheap and
          // keeps the class in sync when ProseMirror re-renders the chrome
          // root after a transaction that didn't fire selectionUpdate.
          //
          // Return `false` if the heading level changed — that forces
          // ProseMirror to rebuild the node-view with the new `h{level}`
          // contentDOM tag instead of trying to patch in place.
          update: (newNode) => {
            if (newNode.type.name !== blockType) return false;
            if (blockType === 'heading') {
              const newTag = contentTagFor(blockType, newNode.attrs ?? {});
              if (contentTag !== newTag) return false;
            }
            updateChromeForSelection(wrapper, editor.state.selection.empty);
            // A5 — push fresh attrs into the React chip so the closed-state
            // summary stays in sync when the user picks a variant.
            if (chipHandle !== null) chipHandle.update(newNode.attrs ?? {});
            // A6 — re-stamp `data-block-idx` after any insert/delete/move
            // higher in the doc shifted this block's slot.
            if (isTopLevel) {
              const idxNow = computeTopLevelIdx();
              if (idxNow !== undefined) {
                wrapper.setAttribute('data-block-idx', String(idxNow));
              }
            }
            return true;
          },
          destroy: () => {
            wrapper.removeEventListener('mouseenter', onEnter);
            wrapper.removeEventListener('mouseleave', onLeave);
            if (chipHandle !== null) chipHandle.unmount();
            if (dragHandle !== null) dragHandle.destroy();
            editor.off('selectionUpdate', onSelection);
          },
        };
      };
    },
  }) as TNode;
}
