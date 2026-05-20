/**
 * LinkOpen — Mod-K opens the link UI in the floating chrome.
 *
 * Tiny keymap extension. We deliberately don't apply the link mark
 * directly (the user hasn't typed a URL yet) — instead we bump a
 * counter on `editor.storage.linkOpen.requestId` and the bubble
 * picks it up via useEditorState. The counter pattern means even
 * back-to-back Mod-K presses fire the bubble open (a stable boolean
 * would dedupe and miss the second press).
 */
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';

export interface LinkOpenStorage {
  /** Monotonic counter — increments every Mod-K press. */
  requestId: number;
}

/** Typed accessor for `editor.storage.linkOpen`. Avoids the
 *  `unknown` cast at every call site — @tiptap/core's Storage type
 *  is `Record<string, any>`, so a helper is cheaper than module
 *  augmentation for a single private storage slot. */
export function linkOpenStorage(editor: Editor): LinkOpenStorage {
  // addStorage() below guarantees the slot exists, so a typed view with
  // a present key (not Record<string,T> which strictNullChecks treats as
  // possibly-undefined) is the safe shape.
  return (editor.storage as unknown as { linkOpen: LinkOpenStorage })
    .linkOpen;
}

export const LinkOpen = Extension.create({
  name: 'linkOpen',

  addStorage(): LinkOpenStorage {
    return { requestId: 0 };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        const store = linkOpenStorage(this.editor);
        store.requestId += 1;
        // Force a transaction so useEditorState selectors re-run and
        // the bubble sees the bumped counter. A no-op selection update
        // is enough.
        this.editor.view.dispatch(this.editor.state.tr);
        return true;
      },
    };
  },
});
