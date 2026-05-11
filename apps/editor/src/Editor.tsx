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
 * Extensions in A1 + A2
 * ---------------------
 * StarterKit (trimmed) — marks + history + Document + Text + ListItem etc.;
 *                        the seven top-level block nodes (Paragraph, Heading,
 *                        BulletList, OrderedList, Blockquote, CodeBlock,
 *                        HorizontalRule) are disabled here so A2 can re-add
 *                        them with paperflow-owned chrome.
 * withBlockChrome(Base) — A2 wraps each base block Node in an `addNodeView`
 *                        that injects `.paper-block` chrome. The seven
 *                        wrapped Nodes plug into the editor alongside the
 *                        trimmed StarterKit.
 * Placeholder           — empty-doc hint text.
 *
 * Slash menu / BubbleMenu / variant chip / drag / margin notes are
 * intentionally NOT here — A3–A10 layer them on.
 */
import { useEditor, EditorContent, type Editor as TipTapEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import { BulletList, OrderedList } from '@tiptap/extension-list';
import Blockquote from '@tiptap/extension-blockquote';
import CodeBlock from '@tiptap/extension-code-block';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PortableDoc, ValidationIssue } from '@portable-doc/core';
import { validateDoc } from '@portable-doc/core';
import { portableDocToTipTapHtml } from './lib/portable-doc-to-tiptap.js';
import { withBlockChrome } from './extensions/withBlockChrome.js';
import { SlashCommand } from './extensions/SlashCommand.js';
import { FormatBubble } from './FormatBubble.js';
import { MarginDiagnostics } from './MarginDiagnostics.js';

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

/** Debounce window between doc-prop changes and the next validateDoc call
 *  (grill Q9 — calm, not chatty). Matches FooterStatus's 500ms cadence
 *  philosophy at a tighter beat so the margin notes feel responsive. */
const VALIDATE_DEBOUNCE_MS = 300;

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

  // A10 — track the TipTap editor instance locally so MarginDiagnostics can
  // read the editor's DOM (top-level block elements) for note positioning.
  // We do NOT replace onEditorReady — that contract is preserved for App.
  const [editorInstance, setEditorInstance] = useState<TipTapEditor | null>(null);

  // A10 — debounced validation. Runs validateDoc 300ms after the last doc
  // prop change so rapid edits (Cmd+Shift+J save-spam, future TipTap →
  // PortableDoc roundtrips) don't re-validate on every keystroke.
  const [debouncedDoc, setDebouncedDoc] = useState<PortableDoc>(doc);
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedDoc(doc), VALIDATE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [doc]);
  const issues: ValidationIssue[] = useMemo(
    () => validateDoc(debouncedDoc),
    [debouncedDoc],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Drop the seven block nodes — A2 re-adds them with chrome below.
        paragraph: false,
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        // Keep StarterKit's link mark on; we just want predictable defaults.
        link: {
          openOnClick: false,
          HTMLAttributes: { rel: 'noopener noreferrer nofollow' },
        },
      }),
      // A2 — each block-type Node wrapped with paperflow chrome. The order
      // matches the order ProseMirror saw them in StarterKit so schema
      // priorities stay identical.
      withBlockChrome(Paragraph),
      withBlockChrome(Heading.configure({ levels: [1, 2, 3] })),
      withBlockChrome(BulletList),
      withBlockChrome(OrderedList),
      withBlockChrome(Blockquote),
      withBlockChrome(CodeBlock),
      withBlockChrome(HorizontalRule),
      // A3 — slash menu via @tiptap/suggestion. Plugin slots after
      // the block wraps so its plugin queue sits above the NodeView
      // -bearing nodes in ProseMirror's plugin chain.
      SlashCommand,
      // A9 — `showOnlyCurrent: true` (grill Q6) limits the hint to the
      // currently-focused empty paragraph. Mid-doc empty spacers stay quiet;
      // the hint reappears when the cursor lands on them and they're empty.
      // `showOnlyWhenEditable: true` keeps the hint out of read-only renders.
      Placeholder.configure({
        placeholder: 'Start typing, or press / for blocks.',
        showOnlyCurrent: true,
        showOnlyWhenEditable: true,
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
    if (!editor) return;
    setEditorInstance(editor);
    if (onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);

  return (
    <div className="paper-editor" data-testid="paper-editor">
      <EditorContent editor={editor} />
      {editor ? (
        // A4 — inline format BubbleMenu. The @tiptap/react substrate owns
        // floating-element positioning and show/hide; FormatBubble owns the
        // toolbar UI (B/I/code/link + inline URL input).
        <BubbleMenu editor={editor}>
          <FormatBubble editor={editor} />
        </BubbleMenu>
      ) : null}
      {/* A10 — soft margin notes in the right gutter (≥768px) or inline
       *  below the block (<768px). Block-level only per grill Q7; doc-level
       *  issues are filtered inside MarginDiagnostics and surface in the
       *  footer count (A8). */}
      <MarginDiagnostics issues={issues} doc={doc} editor={editorInstance} />
    </div>
  );
}
