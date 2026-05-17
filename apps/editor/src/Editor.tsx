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
// Minimum table support: TipTap delegates to prosemirror-tables. Cells are
// editable, Tab cycles to the next cell, Shift+Tab walks back. We don't
// wrap with withBlockChrome — the chrome was tuned for paragraph/heading
// outer shapes and adding it to <table> needs its own pass.
// `@tiptap/extension-table` re-exports all four nodes from the main entry,
// so one import suffices. The per-node sub-packages exist for treeshaking
// but reference the same classes.
import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import Typography from '@tiptap/extension-typography';
// CW5 / T3b — the canonical Tiptap floating drag handle (what Novel uses).
// Renders ONE `<div class="drag-handle" data-drag-handle>` next to the
// editor's parent and positions it on mousemove. Drives PM's built-in
// drag pipeline (NodeSelection → slice serialize → drop). Companion
// `tiptap-extension-auto-joiner` auto-joins adjacent lists after a
// drag-reorder so dragging a list item between two lists merges them.
import GlobalDragHandle from 'tiptap-extension-global-drag-handle';
import AutoJoiner from 'tiptap-extension-auto-joiner';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PortableDoc, ValidationIssue } from '@portable-doc/core';
import { validateDoc } from '@portable-doc/core';
import { portableDocToTipTapJson } from './lib/portable-doc-to-tiptap-json.js';
import { tiptapToPortableDoc } from './lib/tiptap-to-portable-doc.js';
import { withBlockChrome } from './extensions/withBlockChrome.js';
import { SlashCommand } from './extensions/SlashCommand.js';
import { MoveBlock } from './extensions/MoveBlock.js';
import { FormatBubble } from './FormatBubble.js';
import { TableMenu } from './TableMenu.js';
import { MarginDiagnostics } from './MarginDiagnostics.js';
import { FloatingBlockChrome } from './FloatingBlockChrome.js';

interface EditorProps {
  /** PortableDoc rendered into the editor. Re-syncs via `setContent`
   *  when the reference changes from outside (e.g. a JsonEditMode save). */
  doc: PortableDoc;
  /** Fires after every doc-affecting TipTap transaction with the
   *  converted PortableDoc. The editor handles the TipTap→PortableDoc
   *  conversion internally so the caller never sees raw TipTap JSON. */
  onChange?: (doc: PortableDoc) => void;
  /** A2 / A3 / A4 will hand the editor instance back up through this ref. */
  onEditorReady?: (editor: TipTapEditor) => void;
  /** Stable test id forwarded to the contenteditable for assertion targeting. */
  dataTestId?: string;
  /** Fired when the slash menu's "Image" command is picked. The host opens
   *  its own URL dialog (replaces the v0.4-era `window.prompt('Image URL')`
   *  and the brief CustomEvent bridge it used to go through). Wired into
   *  SlashCommand.configure(). */
  onImageRequest?: (editor: TipTapEditor) => void;
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
  onImageRequest,
}: EditorProps): JSX.Element {
  // Keep the latest onChange in a ref so re-renders of the parent don't
  // re-create the editor (TipTap remounts are expensive + lose selection).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Same pattern for onImageRequest — kept in a ref so the SlashCommand
  // option doesn't churn the extensions array (which would rebuild the
  // ProseMirror view; see the lengthy comment on `extensions` below).
  const onImageRequestRef = useRef(onImageRequest);
  onImageRequestRef.current = onImageRequest;

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

  // Memoize extensions + editorProps + initial content. `useEditor` runs
  // an internal `compareOptions` check on every render and, when any
  // option's reference has changed, calls `editor.setOptions()` — which
  // tears down and rebuilds the ProseMirror EditorView, destroying every
  // NodeView (and the React roots inside them via `chipHandle.unmount()`).
  // With fresh array/object literals each render, that loops forever:
  // the rebuild triggers a state update inside TipTap, which re-renders
  // Editor, which produces fresh literals again, which fails the compare,
  // which rebuilds, … 19k+ DOM mutations per second of "idle" time.
  //
  // The extensions and editor props don't depend on any state that can
  // change at runtime, so `[]` deps are correct here.
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        // Drop the seven block nodes — A2 re-adds them with chrome below.
        paragraph: false,
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        // Link safety: `validate` runs on every setLink() and on pasted
        // hrefs. Reject anything that isn't http(s) or mailto so a
        // malicious paste can't smuggle `javascript:` or `data:` URLs
        // into the doc (real XSS surface). `rel="noopener noreferrer
        // nofollow"` is the standard hardening for any outbound link.
        // `openOnClick: false` matches the editor convention — clicks
        // place a caret; the FormatBubble's link affordance is what
        // edits/removes.
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: { rel: 'noopener noreferrer nofollow' },
          validate: (href: string) =>
            /^https?:\/\//i.test(href) || /^mailto:/i.test(href),
        },
      }),
      withBlockChrome(Paragraph),
      withBlockChrome(Heading.configure({ levels: [1, 2, 3, 4, 5, 6] })),
      withBlockChrome(BulletList),
      withBlockChrome(OrderedList),
      withBlockChrome(Blockquote),
      withBlockChrome(CodeBlock),
      withBlockChrome(HorizontalRule),
      // Table needs all four nodes registered together — Table contains
      // TableRow, which contains TableCell/TableHeader. `resizable: false`
      // keeps v0.4 minimum scope — column resize is v0.5.
      //
      // Tab-extends-row: `@tiptap/extension-table@3.23.4+` already ships
      // the canonical Notion / Novel keymap — Tab tries `goToNextCell()`
      // first and falls through to `addRowAfter()` when at the last cell.
      // No override needed; trust the upstream behavior.
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      // Image (web/native only — PortableDoc's image block surfaces are
      // narrowed to those two; backends without raster support skip it
      // at render time). `inline: false` keeps images as block-level
      // nodes so they sit on their own line like every other block.
      // `allowBase64: false` blocks data-URLs from being pasted; only
      // http(s) URLs make it through, matching the link `validate` policy.
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: { class: 'paper-block__image' },
      }),
      // `onImageRequest` is read through a ref so the option doesn't
      // depend on a changing prop — keeps the extensions array stable
      // and avoids the useEditor compareOptions → rebuild trap.
      SlashCommand.configure({
        onImageRequest: (e) => onImageRequestRef.current?.(e),
      }),
      MoveBlock,
      // CW5 / T3b — the global drag handle owns the `⋮⋮` glyph + dragstart
      // wiring. `dragHandleWidth: 20` matches the visual slot the cluster
      // reserves to its right (CHROME_GAP_PX in FloatingBlockChrome).
      // `scrollTreshold: 100` mirrors Novel's default — start auto-scroll
      // when the drag pointer is within 100px of the viewport edge.
      GlobalDragHandle.configure({
        dragHandleWidth: 20,
        scrollTreshold: 100,
      }),
      // Auto-joins adjacent lists after a drag-reorder so dragging a list
      // item out of List A and adjacent to List B merges them. Stateless,
      // no config needed.
      AutoJoiner,
      // Typography — transforms input on the fly: straight quotes become
      // curly ("foo" → “foo”, 'bar' → ‘bar’), `--` collapses to an em-dash,
      // `...` to a horizontal ellipsis, `(c)` to ©, etc. Smart-quote handling
      // is what makes the Iowan Old Style surface read like a typeset page
      // instead of a draft — the single highest-leverage visual change per
      // line of code. Stateless, no config needed.
      Typography,
      // Per-block placeholder text. Empty headings/lists/callouts get
      // their own hint instead of the generic "Start typing, or press /
      // for blocks." — quieter and more informative.
      Placeholder.configure({
        showOnlyCurrent: true,
        showOnlyWhenEditable: true,
        placeholder: ({ node }) => {
          switch (node.type.name) {
            case 'heading':
              return 'Heading';
            case 'bulletList':
            case 'orderedList':
              return 'List item';
            case 'blockquote':
              return 'Callout';
            case 'codeBlock':
              return 'Code';
            default:
              return 'Start typing, or press / for blocks.';
          }
        },
      }),
    ],
    [],
  );

  const editorProps = useMemo(
    () => ({
      attributes: {
        class: 'paper-editor-surface',
        ...(dataTestId ? { 'data-testid': dataTestId } : {}),
      },
    }),
    [dataTestId],
  );

  // Keep the latest doc in a ref so the onContentError handler can read
  // `docTitle` / `blockCount` without going stale — and without having to
  // list `doc` as a useCallback dep (which would churn the handler's
  // identity on every doc prop change and trip the useEditor
  // `compareOptions` rebuild path described above).
  const docRef = useRef(doc);
  docRef.current = doc;

  // `onContentError` fires when TipTap fails to parse content passed to
  // the initial `content` option or to `editor.commands.setContent()`.
  // Without a handler, TipTap throws into the React tree and the editor
  // surface crashes. Canonical pattern is to log + recover (no rethrow)
  // so the editor stays mounted with whatever it could parse, and
  // consumers can detect parse failures by watching for the stable
  // `[paperflow editor] onContentError —` prefix.
  //
  // Stable identity via useCallback (empty deps) so the useEditor
  // compareOptions check doesn't see a fresh ref on every render —
  // same memo discipline as `extensions` / `editorProps` above.
  const onContentError = useCallback((props: { error: Error }) => {
    const d = docRef.current;
    console.error(
      '[paperflow editor] onContentError —',
      props.error,
      { docTitle: d.title, blockCount: d.blocks.length },
    );
  }, []);

  // Initial content snapshot — captured at the FIRST render only. We use
  // a ref instead of recomputing `portableDocToTipTapJson(doc)` in the
  // useEditor options so a later `doc` prop change does NOT rebuild the
  // whole editor (which would lose cursor/selection). The doc-sync
  // useEffect below handles in-flight changes via `setContent`.
  const initialContent = useRef(portableDocToTipTapJson(doc));

  const editor = useEditor({
    extensions,
    content: initialContent.current,
    editorProps,
    // `shouldRerenderOnTransaction: false` opts out of the legacy
    // "re-render parent component on every ProseMirror transaction"
    // path that TipTap docs flag for removal. Subscribers that need
    // TX-derived state use `useEditorState` with a selector (see
    // FormatBubble.tsx + BlockChromeView.tsx).
    //
    // `immediatelyRender` left at its default (`true`) — defers-to-
    // useEffect only matters for SSR; here it would delay editor mount
    // by one tick and break synchronous test assertions for no benefit
    // (the createRoot-in-NodeView pattern that needed StrictMode safety
    // is gone now that we use ReactNodeViewRenderer).
    shouldRerenderOnTransaction: false,
    // `emitContentError: true` routes parse failures through the
    // `contentError` event (→ `onContentError` below) WITHOUT failing
    // the parse — TipTap still salvages whatever the schema accepts and
    // keeps that as the editor's content. Pairing this with the handler
    // is the canonical "log + recover" pattern; `enableContentCheck`
    // (the stricter sibling) would also abort the parse and is heavier
    // than we need here.
    emitContentError: true,
    onContentError,
    onUpdate: ({ editor: e }) => {
      // Convert TipTap state → PortableDoc and emit it. We stash the
      // produced doc in `lastEmittedDocRef` BEFORE notifying upward so
      // the doc-sync useEffect below can recognise its own echo when
      // the parent re-renders with the new doc — preventing the
      // setContent → onUpdate → setContent loop.
      const next = tiptapToPortableDoc(
        e.getJSON() as Parameters<typeof tiptapToPortableDoc>[0],
        lastEmittedDocRef.current ?? null,
      );
      lastEmittedDocRef.current = next;
      onChangeRef.current?.(next);
    },
  });

  // Keep the editor in sync with the `doc` prop without rebuilding the
  // ProseMirror view. The sync only fires for EXTERNAL doc changes
  // (e.g. JsonEditMode save): when the parent's `doc` prop equals what
  // we last emitted from onUpdate, the change came from US and the
  // editor is already in sync — we skip setContent to preserve the
  // writer's cursor and avoid an infinite onUpdate ↔ setContent echo.
  // `emitUpdate: false` is belt-and-suspenders.
  const lastSyncedDocRef = useRef<PortableDoc>(doc);
  const lastEmittedDocRef = useRef<PortableDoc | null>(null);
  useEffect(() => {
    if (!editor) return;
    if (lastSyncedDocRef.current === doc) return;
    if (lastEmittedDocRef.current === doc) {
      // This is our own emission round-tripping through the parent —
      // editor already holds the canonical state, skip.
      lastSyncedDocRef.current = doc;
      return;
    }
    lastSyncedDocRef.current = doc;
    // Seed via TipTap-canonical JSON (not an HTML round-trip) so attrs
    // like blockquote's `variant` and explicit mark-array order survive
    // intact — see `portable-doc-to-tiptap-json.ts` for the rationale.
    editor.commands.setContent(portableDocToTipTapJson(doc), { emitUpdate: false });
  }, [editor, doc]);

  // Surface the editor instance once it's ready. A2 / A3 / A4 will read this
  // to attach NodeView decorators, slash extensions, and BubbleMenu plugins.
  useEffect(() => {
    if (!editor) return;
    setEditorInstance(editor);
    if (onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);

  // A5 — variant chips are rendered as a direct child of the React
  // NodeView (see `BlockChromeView.tsx`). The previous registry+portal
  // bridge is no longer needed because `ReactNodeViewRenderer` owns the
  // chip's React lifecycle from this editor's stable React tree.

  return (
    <div className="paper-editor" data-testid="paper-editor">
      <EditorContent editor={editor} />
      {editor ? (
        // A4 — inline format BubbleMenu. The @tiptap/react substrate owns
        // floating-element positioning and show/hide; FormatBubble owns the
        // toolbar UI (B/I/code/link + inline URL input).
        //
        // `shouldShow` filter: providing a custom callback REPLACES TipTap's
        // default (which checks selection-empty + editor focus). We add
        // contextual guards on top:
        //   - code blocks: no inline marks apply inside; the bubble
        //     would offer disabled-looking buttons.
        //   - tables: the bubble overlaps cell text awkwardly and the
        //     formatting buttons fight cell-selection semantics.
        // Plus the basic safety checks the default would have made:
        //   - empty selection (nothing to format)
        //   - non-editable editor
        <BubbleMenu
          editor={editor}
          shouldShow={({ editor: e, state }) => {
            if (state.selection.empty) return false;
            if (!e.isEditable) return false;
            if (e.isActive('codeBlock')) return false;
            if (e.isActive('tableCell') || e.isActive('tableHeader')) return false;
            return true;
          }}
        >
          <FormatBubble editor={editor} />
        </BubbleMenu>
      ) : null}
      {editor ? (
        // Table BubbleMenu — surfaces row / column / table actions
        // whenever the caret sits in a cell. Uses the same @tiptap/react
        // floating substrate as FormatBubble; the two never co-mount
        // because their `shouldShow` predicates are mutually exclusive
        // (FormatBubble bails on table cells; this menu requires one).
        // `pluginKey` distinguishes the two bubble plugins so PM doesn't
        // see a duplicate key when both extensions register.
        <BubbleMenu
          editor={editor}
          pluginKey="tableMenu"
          shouldShow={({ editor: e }) => {
            if (!e.isEditable) return false;
            return e.isActive('table');
          }}
        >
          <TableMenu editor={editor} />
        </BubbleMenu>
      ) : null}
      {/* A10 — soft margin notes in the right gutter (≥768px) or inline
       *  below the block (<768px). Block-level only per grill Q7; doc-level
       *  issues are filtered inside MarginDiagnostics and surface in the
       *  footer count (A8). */}
      <MarginDiagnostics issues={issues} doc={doc} editor={editorInstance} />
      {/* CW5 — single floating chrome cluster that tracks the currently-
       *  hovered top-level block (Notion/BlockNote/Linear pattern). One
       *  instance per editor; positions itself via mousemove → closest
       *  `.react-renderer` ancestor walk + getBoundingClientRect. */}
      <FloatingBlockChrome editor={editorInstance} />
    </div>
  );
}
