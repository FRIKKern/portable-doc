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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PortableDoc, ValidationIssue } from '@portable-doc/core';
import { validateDoc } from '@portable-doc/core';
import { portableDocToTipTapJson } from './lib/portable-doc-to-tiptap-json.js';
import { tiptapToPortableDoc } from './lib/tiptap-to-portable-doc.js';
import { buildExtensions } from './extensions/index.js';
import { TableMenu } from './TableMenu.js';
import { MarginDiagnostics } from './MarginDiagnostics.js';
import { FloatingBlockChrome } from './FloatingBlockChrome.js';
import { DocxPreviewPanel } from './DocxPreviewPanel.js';

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
  /** Pioneer move A — when true, the DocxPreviewPanel renders the live .docx
   *  preview alongside the editor. State is lifted to the parent so the
   *  footer chip can toggle it; default false. */
  previewVisible?: boolean;
  /** Optional close callback wired into the preview panel's × button so
   *  users can dismiss the overlay without going back to the footer. */
  onClosePreview?: () => void;
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
  previewVisible = false,
  onClosePreview,
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

  // The extensions list lives in `extensions/index.ts` (Novel does the
  // same — keeps Editor.tsx focused on React glue). `useEditor` runs
  // a `compareOptions` check on every render and rebuilds the
  // ProseMirror view on any reference change, so the array MUST be
  // referentially stable; `useMemo([], [])` gives us that. The
  // host's `onImageRequest` is bound late via a getter that reads our
  // ref so a fresh closure from a parent re-render doesn't invalidate
  // the array.
  const extensions = useMemo(
    () =>
      buildExtensions({
        getOnImageRequest: () => onImageRequestRef.current,
      }),
    [],
  );

  const editorProps = useMemo(
    () => ({
      attributes: {
        class: 'paper-editor-surface',
        ...(dataTestId ? { 'data-testid': dataTestId } : {}),
      },
      // Cmd-click / Ctrl-click on a link opens it in a new tab.
      // Stock TipTap behavior keeps `openOnClick: false` so a plain
      // click just places the caret (writers don't want a click to
      // navigate away from their editor). Modifier-click is the
      // canonical Notion / Linear / Docs escape hatch.
      handleClick(_view: unknown, _pos: number, event: MouseEvent): boolean {
        if (!event.metaKey && !event.ctrlKey) return false;
        const t = event.target as HTMLElement | null;
        const anchor = t?.closest?.('a') as HTMLAnchorElement | null;
        if (!anchor?.href) return false;
        // Only follow http(s) / mailto — matches the link extension's
        // own validator so we don't open `javascript:` or `data:` URIs.
        if (!/^(https?:|mailto:)/i.test(anchor.href)) return false;
        window.open(anchor.href, '_blank', 'noopener,noreferrer');
        event.preventDefault();
        return true;
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
    // FormatBubble.tsx + FloatingBlockChrome.tsx).
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

  // A5 — variant chips live inside the single FloatingBlockChrome
  // cluster (see FloatingBlockChrome.tsx). Per-block NodeViews and
  // their React portal/registry are gone — variant rendering is now
  // pure CSS (per-axis `data-*` attrs emitted by `withBlockChrome`,
  // styled by paper.css).

  return (
    <div className="paper-editor" data-testid="paper-editor">
      <EditorContent editor={editor} />
      {editor ? (
        // Table BubbleMenu — surfaces row / column / table actions
        // whenever the caret sits in a cell. The block-level toolbar
        // (FloatingBlockChrome below) intentionally yields to this
        // contextual menu inside tables — table cells have their own
        // structural shape that doesn't fit the block-bubble.
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
      {/* Pioneer move A — lean .docx preview side-panel sibling. Mounts
       *  alongside MarginDiagnostics (same right-gutter convention) and
       *  short-circuits to null when visible=false, so toggling it off
       *  costs nothing. */}
      <DocxPreviewPanel
        doc={doc}
        visible={previewVisible}
        onClose={onClosePreview}
      />
      {/* CW5 — single floating chrome cluster that tracks the currently-
       *  hovered top-level block (Notion/BlockNote/Linear pattern). One
       *  instance per editor; resolves the target via canonical
       *  `view.posAtCoords` + `view.nodeDOM` calls. */}
      <FloatingBlockChrome editor={editorInstance} />
    </div>
  );
}
