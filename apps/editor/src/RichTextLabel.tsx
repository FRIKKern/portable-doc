/**
 * Inline-only TipTap field for short single-line labels (e.g. action button
 * labels). Persists a plain `string` — no inline marks survive serialization,
 * by design.
 *
 * Why plain `string` (no `InlineNode[]` migration)
 * ------------------------------------------------
 * Action labels are semantically button labels, not paragraph content. The
 * email backend renders them via VML wrappers on Outlook, where rich marks
 * would break the wrapper. Keeping `ActionBlock.label` as `string` makes A1b
 * a pure UX upgrade — no AST shape change, no validator change, no migration.
 *
 * Schema shape — flat text doc, no `<p>` wrapping
 * ------------------------------------------------
 * We define a custom Document node whose top-level content is `text*`. That
 * means the doc itself can hold raw text directly, without a paragraph
 * wrapper. StarterKit's Document, Paragraph, and every block-level node are
 * disabled, leaving Text as the only content type. Marks are also disabled —
 * even if the user pressed Cmd+B, no mark schema exists to apply, and
 * `editor.getText()` would strip them anyway. Belt-and-suspenders.
 *
 * StrictMode
 * ----------
 * `useEditor` from `@tiptap/react` v3 is StrictMode-clean (per the T1 grill);
 * double-mount tears down the first instance before the second commits.
 */
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';

interface RichTextLabelProps {
  /** Current plain-text label value. */
  value: string;
  /** Fired on every keystroke with the new flat-text label. */
  onChange: (next: string) => void;
  /** Accessibility label for the contenteditable surface. */
  ariaLabel?: string;
  /**
   * Optional test id forwarded to the contenteditable surface so multi-field
   * forms can target individual editors (e.g. two action labels side by side).
   */
  dataTestId?: string;
}

/**
 * Custom top-level node for a flat-text doc. Replaces StarterKit's Document,
 * which has `content: 'block+'` (forces at least one paragraph child). Here
 * we accept zero-or-more text nodes directly — no `<p>` wrapper.
 */
const FlatTextDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'text*',
});

export function RichTextLabel({
  value,
  onChange,
  ariaLabel,
  dataTestId,
}: RichTextLabelProps) {
  // Latest onChange in the editor's onUpdate handler without re-creating the
  // editor on every parent render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      // Disable every node + mark we don't want. The editor's schema reduces
      // to FlatTextDocument + Text. No paragraph, no headings, no lists, no
      // marks — a single-line plain-text contenteditable backed by TipTap's
      // cursor / selection / undo machinery.
      StarterKit.configure({
        document: false,
        paragraph: false,
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        codeBlock: false,
        horizontalRule: false,
        hardBreak: false,
        bold: false,
        italic: false,
        code: false,
        strike: false,
        underline: false,
        link: false,
        // trailingNode auto-inserts a paragraph at the end of the doc — its
        // schema assumes the document accepts block children. Our doc is
        // text*, so trailingNode crashes ProseMirror on every transaction.
        // Disable it.
        trailingNode: false,
      }),
      FlatTextDocument,
    ],
    content: value,
    onUpdate: ({ editor: e }) => {
      // editor.getText() flattens to plain text regardless of schema. With
      // marks disabled this is already plain text, but we keep the call so a
      // future schema relaxation still serializes correctly.
      onChangeRef.current(readEditorText(e));
    },
    editorProps: {
      attributes: {
        'aria-label': ariaLabel ?? 'label',
        class: 'pd-rich-text-label',
        ...(dataTestId ? { 'data-testid': dataTestId } : {}),
      },
    },
  });

  // Sync EXTERNAL value changes back into the editor (block switch, undo, or
  // anything pushed down by the reducer). Compare on the flat text we'd read
  // out, so the editor's own onUpdate-driven value — which already produced
  // this string — does NOT trigger a redundant setContent + infinite loop.
  const lastValueRef = useRef(value);
  useEffect(() => {
    if (!editor) return;
    if (lastValueRef.current === value) return;
    lastValueRef.current = value;
    if (readEditorText(editor) === value) return;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  return <EditorContent editor={editor} />;
}

/**
 * Read the editor's current value as flat text. With our schema this is
 * equivalent to `editor.getText()` — kept as a helper so the call site stays
 * symmetric on the read path (mirror of how `RichTextField` uses helpers).
 */
function readEditorText(editor: Editor): string {
  return editor.getText();
}
