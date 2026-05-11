/**
 * v0.4 — single document-level TipTap instance.
 *
 * Replaces the v0.3 three-panel composite (BlockList + BlockForm + SlashPopover)
 * with ONE editor that hosts the whole doc. A2 layers block chrome onto this
 * via NodeView. A3 layers slash-command insertion via an Extension. A4 ships
 * the BubbleMenu. A5 wires the VariantChip. A6 adds drag-and-drop. A10 paints
 * the soft margin notes. A1 (this file) is the bare TipTap surface — light
 * extension set, full document model.
 *
 * Why one instance, not five
 * --------------------------
 * v0.3's `RichTextField` mounted a separate TipTap per text-bearing field
 * (paragraph body, callout body, each list item). The new model lets TipTap
 * own the structural document — heading, paragraph, list, blockquote, code,
 * horizontal rule are all ProseMirror nodes. The PortableDoc JSON survives
 * as the on-disk format; we render it INTO TipTap via `welcomeToTipTapHtml`
 * on mount, and (in later tasks) reflect TipTap edits back into the AST.
 *
 * Extensions in A1
 * ----------------
 * StarterKit       — heading, paragraph, list, blockquote, code, hr, marks
 * Placeholder      — empty-doc hint text
 * Link             — StarterKit already includes link, but we re-configure
 *                    it so href values survive serialization round-trips.
 *
 * Block chrome / slash / bubble / variant chip / drag / margin notes are
 * intentionally NOT here — A2–A10 layer them on.
 */
import { useEditor, EditorContent, type Editor as TipTapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect, useRef } from 'react';
import type { PortableDoc } from '@portable-doc/core';
import { portableDocToTipTapHtml } from './lib/portable-doc-to-tiptap.js';

interface EditorProps {
  /** Initial PortableDoc rendered into the editor on mount. */
  doc: PortableDoc;
  /** Fires on every TipTap transaction with the editor's current JSON. */
  onChange?: (json: ReturnType<TipTapEditor['getJSON']>) => void;
  /** A2 / A3 / A4 will hand the editor instance back up through this ref. */
  onEditorReady?: (editor: TipTapEditor) => void;
  /** Stable test id forwarded to the contenteditable for assertion targeting. */
  dataTestId?: string;
}

export function Editor({
  doc,
  onChange,
  onEditorReady,
  dataTestId,
}: EditorProps): JSX.Element {
  // Keep the latest onChange in a ref so re-renders of the parent don't
  // re-create the editor (TipTap remounts are expensive + lose selection).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Keep StarterKit's link mark on; we just want predictable defaults.
        link: {
          openOnClick: false,
          HTMLAttributes: { rel: 'noopener noreferrer nofollow' },
        },
      }),
      Placeholder.configure({
        placeholder: 'Start typing — press "/" for a block menu',
      }),
    ],
    content: portableDocToTipTapHtml(doc),
    editorProps: {
      attributes: {
        class: 'paper-editor-surface',
        ...(dataTestId ? { 'data-testid': dataTestId } : {}),
      },
    },
    onUpdate: ({ editor: e }) => {
      onChangeRef.current?.(e.getJSON());
    },
  });

  // Surface the editor instance once it's ready. A2 / A3 / A4 will read this
  // to attach NodeView decorators, slash extensions, and BubbleMenu plugins.
  useEffect(() => {
    if (editor && onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);

  return (
    <div className="paper-editor" data-testid="paper-editor">
      <EditorContent editor={editor} />
    </div>
  );
}
