/**
 * A9 — OutlineRail.
 *
 * v0.3's `BlockList.tsx` reborn as a clean, paperflow-owned outline rail. No
 * v0.3 tile chrome — just a list of top-level blocks, click to scroll + focus
 * the block in the editor. Toggled by ⌘\ / Ctrl+\ at the App level (the rail
 * itself is a controlled component: `open` + `onClose`).
 *
 * Geometry (grill Q8 — narrow viewport)
 * -------------------------------------
 * ≥768px : 240px slide-in left rail, overlay-style (position: fixed; doesn't
 *          push content). Slide via `--motion-outline-slide`.
 * <768px : Top bar with ≡ button; the entries collapse into a vertical
 *          dropdown that expands beneath the button when the rail is open.
 *
 * Hard rules in scope:
 *   - DOES NOT touch BlockChrome.ts / VariantChip.tsx / variant-chip CSS region.
 *   - Esc handling lives BOTH on the rail (closes when overlay is closed) and
 *     on App.tsx (gates by `previewOpen`). The rail's local Esc handler is a
 *     belt; App.tsx is the suspenders.
 *   - role="navigation" + aria-label="Document outline"; entries are
 *     focusable <button>s so Tab cycles within the rail naturally.
 *   - prefers-reduced-motion collapses the slide via the global rule in
 *     paper.css (each motion var → 0ms under `(prefers-reduced-motion: reduce)`).
 *
 * Scroll + focus contract
 * -----------------------
 * Click an entry → `editor.commands.focus(pos)` (TipTap focuses the editor
 * AND moves the selection to that ProseMirror position) → ask the view for
 * the DOM node at that pos via `view.nodeDOM(pos)` → `scrollIntoView({
 * behavior: 'smooth', block: 'center' })` if found. The DOM node returned by
 * `nodeDOM(pos)` is the node-view's `outer` element from A2's
 * `withBlockChrome.ts`, so the scroll target naturally includes the
 * .paper-block chrome.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';

interface OutlineRailProps {
  /** TipTap editor instance — null while it's still mounting. */
  editor: Editor | null;
  /** Controlled visibility — App.tsx owns the state, ⌘\ toggles it. */
  open: boolean;
  /** Called when the rail wants to close itself (Esc, button on narrow bar). */
  onClose: () => void;
}

interface OutlineEntry {
  /** ProseMirror absolute position of the top-level block. */
  pos: number;
  /** Block type name from the ProseMirror node — drives the icon glyph. */
  type: string;
  /** Heading level (1–6) when type === 'heading'; undefined otherwise. */
  level?: number;
  /** 30-char content preview (stripped of leading whitespace). */
  preview: string;
  /** Stable index — matches the order in the doc. */
  index: number;
}

const ICON_BY_TYPE: Record<string, string> = {
  paragraph: '¶',
  heading: 'H',
  bulletList: '•',
  orderedList: '1.',
  blockquote: '“',
  codeBlock: '</>',
  horizontalRule: '—',
};

/** 30-char content preview, normalized — collapse runs of whitespace,
 *  trim, then truncate with an ellipsis if needed. Empty blocks return ''. */
function previewFor(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return '';
  if (collapsed.length <= 30) return collapsed;
  return `${collapsed.slice(0, 29)}…`;
}

/** Walk the doc's top-level children once and produce an entry per child.
 *  Internal helper exported so tests can hit the pure traversal directly. */
export function entriesFromEditor(editor: Editor): OutlineEntry[] {
  const result: OutlineEntry[] = [];
  const { doc } = editor.state;
  let i = 0;
  doc.forEach((node, offset) => {
    result.push({
      pos: offset,
      type: node.type.name,
      level:
        node.type.name === 'heading'
          ? Number(node.attrs?.level ?? 1)
          : undefined,
      preview: previewFor(node.textContent ?? ''),
      index: i,
    });
    i += 1;
  });
  return result;
}

/** Match `(max-width: 767px)` synchronously — the rail re-runs on transaction
 *  + on the matchMedia change event, so we don't subscribe with a ref. */
function isNarrowViewport(): boolean {
  if (typeof window === 'undefined') return false;
  // Some test environments (jsdom) ship a stub matchMedia that always
  // returns matches=false; that's fine — we just behave as ≥768px there.
  return window.matchMedia?.('(max-width: 767px)').matches ?? false;
}

export function OutlineRail({ editor, open, onClose }: OutlineRailProps): JSX.Element | null {
  // Re-render on every editor transaction so the entry list tracks doc edits.
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const tick = () => forceUpdate((n) => n + 1);
    editor.on('transaction', tick);
    return () => {
      editor.off('transaction', tick);
    };
  }, [editor]);

  // Re-render on viewport changes so ≥768px ↔ <768px swap takes effect.
  const [narrow, setNarrow] = useState<boolean>(() => isNarrowViewport());
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia?.('(max-width: 767px)');
    if (!mql) return;
    const onChange = () => setNarrow(mql.matches);
    // `addEventListener` is the modern API; addListener is the deprecated
    // fallback for older browsers. Both are present in jsdom (no-ops).
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mql as any).addListener?.(onChange);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mql as any).removeListener?.(onChange);
    };
  }, []);

  // Narrow variant has a separate `expanded` toggle — the ≡ button shows the
  // entries as a dropdown. Tapping a navigation link collapses it again.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

  // Esc handling lives at the App level — App.tsx owns both the ⌘P overlay
  // and the ⌘\ rail toggles and gates Esc so the overlay's claim wins. The
  // rail itself does NOT register a window keydown listener for Esc; doing
  // so would race the App handler and bypass the gate when both surfaces
  // are open simultaneously.

  const entries = useMemo<OutlineEntry[]>(() => {
    if (!editor) return [];
    return entriesFromEditor(editor);
  }, [editor,
    // The transaction tick above invalidates the closure via state change;
    // include the doc identity for explicit dependency tracking.
    editor?.state.doc,
  ]);

  const ref = useRef<HTMLElement | null>(null);

  if (!open) return null;
  if (!editor) return null;

  function onEntryClick(entry: OutlineEntry) {
    if (!editor) return;
    // 1. Move selection + focus into the editor at the block start.
    editor.chain().focus().setTextSelection(entry.pos + 1).run();
    // 2. Find the DOM node-view wrapper for that position and scroll it.
    //    nodeDOM returns null for missing positions; guard accordingly.
    const dom = editor.view.nodeDOM(entry.pos) as HTMLElement | null;
    // The node-view wraps `.paper-block` inside `.paper-block-outer`; the
    // returned node IS that outer wrapper, which is a perfect scroll target.
    dom?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // 3. Narrow-viewport: collapse the dropdown after navigation.
    if (narrow) setExpanded(false);
  }

  // The narrow-viewport variant uses a top bar + collapsing dropdown. Both
  // variants share the entry rendering — pulled into a single render below.
  const entryList = (
    <ul
      className="paper-outline-rail__entries"
      data-testid="outline-rail-entries"
    >
      {entries.length === 0 ? (
        <li className="paper-outline-rail__empty">
          <span>No blocks yet</span>
        </li>
      ) : (
        entries.map((entry) => (
          <li key={`${entry.index}-${entry.pos}`}>
            <button
              type="button"
              className="paper-outline-rail__entry"
              data-testid={`outline-entry-${entry.index}`}
              data-outline-index={entry.index}
              data-block-type={entry.type}
              onClick={() => onEntryClick(entry)}
            >
              <span
                className="paper-outline-rail__entry-icon"
                aria-hidden="true"
              >
                {entry.type === 'heading'
                  ? `H${entry.level ?? 1}`
                  : ICON_BY_TYPE[entry.type] ?? '•'}
              </span>
              <span className="paper-outline-rail__entry-preview">
                {entry.preview || <em>Empty</em>}
              </span>
            </button>
          </li>
        ))
      )}
    </ul>
  );

  if (narrow) {
    return (
      <nav
        ref={ref}
        className="paper-outline-rail paper-outline-rail--narrow"
        data-testid="outline-rail"
        data-variant="narrow"
        role="navigation"
        aria-label="Document outline"
      >
        <div className="paper-outline-rail__top-bar">
          <button
            type="button"
            className="paper-outline-rail__expand"
            data-testid="outline-rail-expand"
            aria-expanded={expanded}
            aria-controls="paper-outline-rail-dropdown"
            onClick={() => setExpanded((v) => !v)}
          >
            <span aria-hidden="true">≡</span>
            <span className="paper-outline-rail__expand-label">Outline</span>
          </button>
          <button
            type="button"
            className="paper-outline-rail__close"
            data-testid="outline-rail-close"
            aria-label="Close outline"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {expanded ? (
          <div
            id="paper-outline-rail-dropdown"
            className="paper-outline-rail__dropdown"
            data-testid="outline-rail-dropdown"
          >
            {entryList}
          </div>
        ) : null}
      </nav>
    );
  }

  return (
    <nav
      ref={ref}
      className="paper-outline-rail"
      data-testid="outline-rail"
      data-variant="side"
      role="navigation"
      aria-label="Document outline"
    >
      <div className="paper-outline-rail__head">
        <span className="paper-outline-rail__title">Outline</span>
        <button
          type="button"
          className="paper-outline-rail__close"
          data-testid="outline-rail-close"
          aria-label="Close outline"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {entryList}
    </nav>
  );
}
