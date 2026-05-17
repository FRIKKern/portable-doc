/**
 * TrailingNode — always keep an empty paragraph at the doc's end.
 *
 * Canonical Notion / Novel / Linear pattern: when the last block is
 * a heading / list / callout / code / table / etc., a writer can't
 * click "below" it because the doc has no trailing slot. This
 * extension watches every transaction; if the last child isn't
 * already an empty paragraph, it appends one.
 *
 * Inlined here (not pulled from `tiptap-extension-trailing-node`)
 * because that community package pins `@tiptap/core@2`, which
 * conflicts with our v3 stack at the type level. The plugin logic
 * is ~30 LOC; cheaper to own than to dependency-shim.
 *
 * Mechanism — a single ProseMirror `Plugin`:
 *   - `state.init` + `state.apply` track a single boolean derived
 *     from the doc's last child. The boolean is `true` when we need
 *     to append a paragraph at the next transaction.
 *   - `appendTransaction` reads that boolean and, if set, returns a
 *     transaction inserting an empty paragraph at the doc's end.
 *
 * Idempotency: after we insert, the doc's last child IS the new
 * empty paragraph; the next state.apply sees that and flips the
 * boolean back to false. No infinite loop.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';
import type { NodeType } from 'prosemirror-model';

export interface TrailingNodeOptions {
  /** Node-name the trailing block should be (always a paragraph in
   *  paperflow). */
  node: string;
  /** Node names that are EXEMPT — if the doc already ends in one of
   *  these, the extension takes no action. Defaults to `['paragraph']`
   *  so we never stack an empty paragraph on top of an existing one. */
  notAfter: readonly string[];
}

const trailingNodePluginKey = new PluginKey<boolean>('trailingNode');

export const TrailingNode = Extension.create<TrailingNodeOptions>({
  name: 'trailingNode',

  addOptions() {
    return {
      node: 'paragraph',
      notAfter: ['paragraph'],
    };
  },

  onCreate() {
    // The PM plugin's `appendTransaction` only fires AFTER a real
    // transaction. On initial editor creation, no transaction has
    // been dispatched yet — so a doc whose last child needs a
    // trailing paragraph would render without one until the first
    // edit. Run the same logic once at create-time so initial state
    // is consistent with steady-state behavior.
    const { state, view } = this.editor;
    const last = state.doc.lastChild;
    if (last && this.options.notAfter.includes(last.type.name)) return;
    const trailingType = state.schema.nodes[this.options.node];
    if (!trailingType) return;
    view.dispatch(
      state.tr.insert(state.doc.content.size, trailingType.create()),
    );
  },

  addProseMirrorPlugins() {
    const ext = this;
    return [
      new Plugin<boolean>({
        key: trailingNodePluginKey,
        appendTransaction: (_, __, state: EditorState) => {
          const shouldInsert = trailingNodePluginKey.getState(state);
          if (!shouldInsert) return null;
          const trailingType: NodeType | undefined =
            state.schema.nodes[ext.options.node];
          if (!trailingType) return null;
          return state.tr.insert(
            state.doc.content.size,
            trailingType.create(),
          );
        },
        state: {
          init: (_, state): boolean => {
            const last = state.doc.lastChild;
            if (!last) return true;
            return !ext.options.notAfter.includes(last.type.name);
          },
          apply: (tr, value): boolean => {
            if (!tr.docChanged) return value;
            const last = tr.doc.lastChild;
            if (!last) return true;
            return !ext.options.notAfter.includes(last.type.name);
          },
        },
      }),
    ];
  },
});
