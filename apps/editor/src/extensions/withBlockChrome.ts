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
import { VARIANT_CATALOG } from '@portable-doc/variants';
import type { BlockType } from '@portable-doc/core';
import {
  bindChromeHandlers,
  bindDragHandlers,
  pdBlockTypeFor,
  renderChromeDom,
  updateChromeForSelection,
  type ChromeParts,
  type DragHandle,
} from '../BlockChrome.js';
import {
  registerSlot,
  unregisterSlot,
} from '../lib/variant-slot-registry.js';

/**
 * Translate the resolved `PdStyle` from `VARIANT_CATALOG[blockType].resolve(axes)`
 * into inline CSS on the contentDOM. The same axes feed every backend (web,
 * email, ink) via the catalog — applying them here makes the editor a
 * live preview of the variant choice.
 *
 * `prevApplied` tracks the keys we last wrote so a later transition (e.g.
 * to a variant that no longer carries `borderColor`) can clear stale
 * inline values without resetting unrelated style the writer added.
 */
const VARIANT_STYLE_KEYS = [
  'borderColor',
  'borderWidth',
  'borderStyle',
  'borderLeftColor',
  'borderLeftWidth',
  'borderLeftStyle',
  'backgroundColor',
  'padding',
  'margin',
] as const;

function applyVariantStyle(
  contentEl: HTMLElement | null,
  blockType: string,
  attrs: Record<string, unknown>,
): void {
  if (!contentEl) return;
  const schema = VARIANT_CATALOG[blockType as BlockType];
  if (!schema) return;
  const variant = attrs.variant as Record<string, string> | null | undefined;
  if (!variant) {
    for (const k of VARIANT_STYLE_KEYS) contentEl.style[k] = '';
    return;
  }
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
    return;
  }
  // Clear before re-applying so axes that no longer produce a value reset.
  for (const k of VARIANT_STYLE_KEYS) contentEl.style[k] = '';
  if (style.backgroundColor) contentEl.style.backgroundColor = style.backgroundColor;
  if (style.borderColor) {
    // Callout uses a left-rail accent in the editor view, not a full border.
    contentEl.style.borderLeftColor = style.borderColor;
    contentEl.style.borderLeftStyle = 'solid';
  }
  if (typeof style.borderWidth === 'number') {
    contentEl.style.borderLeftWidth = `${style.borderWidth}px`;
  }
  if (typeof style.padding === 'number') {
    contentEl.style.padding = `${style.padding}px`;
  }
  if (typeof style.margin === 'number') {
    contentEl.style.margin = `0 0 ${style.margin}px`;
  }
}

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

        // ---- A6 drag handle (HTML5 native; reads top-level idx) ----
        let dragHandle: DragHandle | null = null;
        // ---- A5: variant-slot registry handle ----
        // Track which slot this NodeView registered so destroy() can
        // unregister it. `null` for non-variant block types. The
        // `onChange` handler is hoisted out of the register call so
        // both the initial register and subsequent re-registers (from
        // the NodeView's `update()`) can pass the SAME function ref —
        // otherwise the registry's "bail when props unchanged" check
        // fails, every TX notifies subscribers, Editor re-renders, and
        // we're back in a render loop.
        let registeredSlot: HTMLElement | null = null;
        const onVariantChange =
          pdType === null
            ? null
            : (next: Record<string, string>): void => {
                const pos = getPos?.();
                if (typeof pos !== 'number') return;
                const liveNode = editor.state.doc.nodeAt(pos);
                if (!liveNode) return;
                const prev =
                  (liveNode.attrs?.variant as Record<string, string> | null) ?? {};
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
              };

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

          // ---- A5: register variant-chip slot with the registry.
          // Editor.tsx subscribes to the registry and portals a
          // `<VariantChip>` React element into this slot. We don't mount
          // a React root in here — see `lib/variant-slot-registry.ts`
          // for why (the createRoot-inside-NodeView pattern fights
          // ProseMirror's MutationObserver and produces a tight
          // destroy/recreate loop on the first interaction).
          if (pdType !== null && onVariantChange !== null) {
            registerSlot(parts.variantSlot, {
              blockType: pdType,
              attrs: node.attrs ?? {},
              onChange: onVariantChange,
            });
            registeredSlot = parts.variantSlot;
            // Paint the initial variant style on the content element so a
            // doc seeded with a `variant` attr renders correctly on mount.
            applyVariantStyle(
              contentDOM as HTMLElement | null,
              pdType,
              node.attrs ?? {},
            );
          }
        }

        // ---- Hover state ----
        // 300ms hide hysteresis: mouseenter cancels any pending hide;
        // mouseleave schedules removal of `.is-hovered` 300ms later. If
        // the cursor re-enters (or reaches the chrome through the gap
        // above the block) within that window, the timer is cleared and
        // the chrome never visibly hides. CSS `:hover` is still on the
        // selector, so the show side stays instant via CSS alone.
        let hideTimer: number | undefined;
        const onEnter = (): void => {
          if (hideTimer !== undefined) {
            window.clearTimeout(hideTimer);
            hideTimer = undefined;
          }
          wrapper.classList.add('is-hovered');
        };
        const onLeave = (): void => {
          if (hideTimer !== undefined) window.clearTimeout(hideTimer);
          hideTimer = window.setTimeout(() => {
            wrapper.classList.remove('is-hovered');
            hideTimer = undefined;
          }, 300);
        };
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

        // Locate the chrome toolbar in the outer subtree once — used by
        // ignoreMutation to decide whether a mutation came from inside
        // the chrome (which paperflow owns) or from contentDOM (which
        // ProseMirror owns).
        const chromeToolbar = isTopLevel
          ? ((wrapper as unknown as { __chromeParts?: ChromeParts }).__chromeParts
              ?.toolbar ?? null)
          : null;
        const insertBtnEl = isTopLevel
          ? ((wrapper as unknown as { __chromeParts?: ChromeParts }).__chromeParts
              ?.insertBtn ?? null)
          : null;

        return {
          dom: outer,
          contentDOM,
          // Tell ProseMirror to ignore DOM mutations inside the chrome
          // (drag handle, type label, variant chip slot, delete button)
          // and the "+" insert button. These are paperflow-owned DOM —
          // React portals chip content into `parts.variantSlot`, the
          // hover-driven `.is-hovered` class flips on `wrapper`, etc.
          // Without this, ProseMirror's MutationObserver sees those
          // changes as "unexpected mutations to my view DOM" and
          // destroys + recreates the NodeView to "fix" them, taking
          // the portaled React tree (or React root) with it and
          // producing a tight rebuild loop on first interaction.
          ignoreMutation: (mutation) => {
            // `mutation` is ProseMirror's `ViewMutationRecord` (a
            // structural superset of MutationRecord). `.target` is a DOM
            // Node — cast for the contains() check.
            const target = mutation.target as unknown as globalThis.Node;
            if (
              chromeToolbar &&
              (target === chromeToolbar ||
                chromeToolbar.contains(target as globalThis.Node))
            ) {
              return true;
            }
            if (
              insertBtnEl &&
              (target === insertBtnEl ||
                insertBtnEl.contains(target as globalThis.Node))
            ) {
              return true;
            }
            // Class/style toggles on the wrapper itself (e.g. `.is-hovered`,
            // `.is-selecting`) are also paperflow chrome state — ignore.
            if (
              mutation.type === 'attributes' &&
              target === (wrapper as unknown as globalThis.Node) &&
              ((mutation as MutationRecord).attributeName === 'class' ||
                (mutation as MutationRecord).attributeName === 'data-block-idx')
            ) {
              return true;
            }
            return false;
          },
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
            // A5 — push fresh attrs into the registry so the portaled chip
            // re-renders when the user picks a variant. Pass the SAME
            // hoisted `onVariantChange` reference so the registry's
            // shallow-equality bail can detect "nothing changed" and
            // skip the notify (otherwise every TX would re-render Editor).
            if (
              registeredSlot !== null &&
              pdType !== null &&
              onVariantChange !== null
            ) {
              registerSlot(registeredSlot, {
                blockType: pdType,
                attrs: newNode.attrs ?? {},
                onChange: onVariantChange,
              });
              // Live-repaint variant styles on the content element so the
              // editor view reflects the writer's choice immediately.
              applyVariantStyle(
                contentDOM as HTMLElement | null,
                pdType,
                newNode.attrs ?? {},
              );
            }
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
            if (hideTimer !== undefined) window.clearTimeout(hideTimer);
            wrapper.removeEventListener('mouseenter', onEnter);
            wrapper.removeEventListener('mouseleave', onLeave);
            if (registeredSlot !== null) unregisterSlot(registeredSlot);
            if (dragHandle !== null) dragHandle.destroy();
            editor.off('selectionUpdate', onSelection);
          },
        };
      };
    },
  }) as TNode;
}
