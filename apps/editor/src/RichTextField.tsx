/**
 * Single-paragraph rich-text input bound to one `InlineNode[]` field.
 *
 * Mounts a TipTap v3 editor (`useEditor` hook from `@tiptap/react`) over a
 * single-paragraph ProseMirror doc. Every keystroke fires `onChange` with the
 * new `InlineNode[]` value, derived by running the TipTap JSON through
 * `tiptapToInlineNodes`. External value changes (block switch, undo, value
 * pushed down by the reducer) sync INTO the editor without infinite loops.
 *
 * Why scoped to a single paragraph
 * --------------------------------
 * The portable-doc AST stores inline content per block as a flat
 * `InlineNode[]` — one paragraph's worth. This component is intentionally
 * thin: it does NOT manage block-level structure. The caller owns the doc
 * tree and renders one `<RichTextField>` per text-bearing field (paragraph
 * body, callout body, each list item).
 *
 * StarterKit configuration
 * ------------------------
 * StarterKit ships a generous set of nodes and marks. We disable the
 * structural ones we don't want bubbling into a single-paragraph field
 * (heading, blockquote, lists, hard break, horizontal rule) so users can't
 * accidentally insert block-level content into an inline field. The four
 * marks we DO want — bold, italic, code, link — are kept as defaults.
 *
 * StrictMode
 * ----------
 * `useEditor` from `@tiptap/react` v3 is StrictMode-clean per the T1 decision
 * doc; double-mount in dev tears down the first instance before the second
 * commits. We do not need a manual mount-counter.
 */
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';
import type { InlineNode } from '@portable-doc/core';
import {
  inlineNodesToTiptap,
  normalizeInline,
  tiptapToInlineNodes,
} from './lib/inline-node-tiptap.js';
import type { JSONContent } from '@tiptap/core';

interface RichTextFieldProps {
  /** Current `InlineNode[]` value from the AST. */
  value: InlineNode[];
  /** Fired on every keystroke / mark toggle with the new `InlineNode[]`. */
  onChange: (next: InlineNode[]) => void;
  /** Accessibility label for the contenteditable surface. */
  ariaLabel?: string;
  /**
   * Optional test id forwarded to the contenteditable surface so multi-field
   * forms can target individual editors (e.g. one per list item).
   */
  dataTestId?: string;
}

/**
 * Build the single-paragraph TipTap doc from an `InlineNode[]` value.
 * Empty content becomes `{ type: 'paragraph' }` (no `content`) — TipTap
 * rejects an empty `content` array, so we omit the key entirely.
 */
function buildDoc(value: InlineNode[]): JSONContent {
  const inline = inlineNodesToTiptap(value);
  const paragraph: JSONContent = { type: 'paragraph' };
  if (inline.length > 0) paragraph.content = inline;
  return { type: 'doc', content: [paragraph] };
}

/** Pull the inline content (text-with-marks list) out of the editor. */
function readEditorInline(editor: Editor): JSONContent[] {
  const json = editor.getJSON();
  const first = json.content?.[0];
  return (first?.content ?? []) as JSONContent[];
}

export function RichTextField({
  value,
  onChange,
  ariaLabel,
  dataTestId,
}: RichTextFieldProps) {
  // We need the latest onChange in the editor's onUpdate handler without
  // re-creating the editor on every parent render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Inline-only field: kill the block-level nodes we don't want to
        // surface inside a single-paragraph editor.
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        codeBlock: false,
        horizontalRule: false,
        hardBreak: false,
        // Keep marks: bold, italic, code, link (link arrives via StarterKit
        // in v3 — no separate extension import needed).
      }),
    ],
    content: buildDoc(value),
    onUpdate: ({ editor: e }) => {
      onChangeRef.current(tiptapToInlineNodes(readEditorInline(e)));
    },
    editorProps: {
      attributes: {
        'aria-label': ariaLabel ?? 'rich-text editor',
        class: 'pd-rich-text-field',
        ...(dataTestId ? { 'data-testid': dataTestId } : {}),
      },
    },
  });

  // Sync EXTERNAL value changes back into the editor (block switch, undo,
  // value replaced by the reducer for any reason). We compare on the
  // normalized form so the editor's own onUpdate-driven update — which
  // already produced this value — does NOT trigger a redundant setContent
  // and an infinite loop.
  const lastValueRef = useRef(value);
  useEffect(() => {
    if (!editor) return;
    if (lastValueRef.current === value) return;
    lastValueRef.current = value;
    const currentInline = tiptapToInlineNodes(readEditorInline(editor));
    if (
      JSON.stringify(normalizeInline(currentInline)) ===
      JSON.stringify(normalizeInline(value))
    ) {
      return;
    }
    editor.commands.setContent(buildDoc(value), { emitUpdate: false });
  }, [editor, value]);

  return <EditorContent editor={editor} />;
}
