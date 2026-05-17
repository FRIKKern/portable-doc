/**
 * A10 — MarginDiagnostics: calm margin notes in the right gutter.
 *
 * Replaces v0.3's inline red-dot diagnostics with soft margin notes positioned
 * to the right of the editor column, vertically aligned with the offending
 * block. Doc-level issues (no `blockId`) are filtered out here — A8's
 * FooterStatus pill already shows the total count.
 *
 * Per grill Q7: BLOCK-LEVEL ONLY for v0.4 — char-range diagnostics deferred
 * to v0.5. No red, no alarm tone — calm hint with `--paper-text-muted` /
 * `--paper-text-subtle` palette. Click on a note focuses + scrolls to the
 * offending block. Below 768px the right gutter disappears, so notes render
 * inline below the block instead.
 *
 * Positioning strategy
 * --------------------
 * We do NOT carry PortableDoc block IDs into TipTap state (that would mean
 * threading attrs through `withBlockChrome` and the AST ↔ TipTap pipeline —
 * A6 is also touching that file). Instead, we map `issue.blockId` →
 * `doc.blocks` index → Nth `.paper-block` element in the editor's DOM. Same
 * order, same count under the seeded doc — robust enough for v0.4 while the
 * user is editing the seeded content. v0.5 may wire real IDs through.
 *
 * Tests mock `getBoundingClientRect` to drive note positions; we re-position
 * on editor `update` and on `window.resize`.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Editor as TipTapEditor } from '@tiptap/react';
import type { PortableDoc, ValidationIssue } from '@portable-doc/core';

interface Props {
  issues: ValidationIssue[];
  doc: PortableDoc;
  editor: TipTapEditor | null;
}

interface PositionedIssue {
  /** Stable index across the issues array — survives re-renders. */
  key: string;
  issue: ValidationIssue;
  /** Pixel offset from the diagnostics container's top. `null` when the
   *  target block element is not (yet) in the DOM. */
  top: number | null;
}

/** Walk the editor's ProseMirror document and return the positions of each
 *  top-level block in document order. Reading positions from the doc model
 *  (instead of from a `.paper-block` querySelectorAll) decouples this
 *  layout from React render timing — even if the NodeView's React tree
 *  hasn't flushed yet, the positions are correct because they come from
 *  ProseMirror state, not the DOM.
 *
 *  `doc.forEach(callback)` walks immediate children only, which is
 *  exactly the top-level blocks. `offset` is the position BEFORE each
 *  child node — adding 1 lands inside the node, which is what `focus()`
 *  expects. We return the offsets and let callers shift as needed. */
function topLevelBlockPositions(editor: TipTapEditor | null): number[] {
  if (!editor) return [];
  const positions: number[] = [];
  editor.state.doc.forEach((_node, offset) => {
    positions.push(offset);
  });
  return positions;
}

/** Read the narrow-viewport flag without crashing in SSR / older jsdom. */
function readNarrow(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(max-width: 767px)').matches;
}

export function MarginDiagnostics({
  issues,
  doc,
  editor,
}: Props): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Block-level only — issues without blockId go to the footer count (A8).
  const blockIssues = useMemo(
    () => issues.filter((i) => typeof i.blockId === 'string' && i.blockId.length > 0),
    [issues],
  );

  // Map blockId → index in the seeded doc. Built once per doc change.
  const indexByBlockId = useMemo(() => {
    const map = new Map<string, number>();
    doc.blocks.forEach((b, idx) => {
      if (typeof b.id === 'string' && b.id.length > 0) {
        map.set(b.id, idx);
      }
    });
    return map;
  }, [doc]);

  // Positions update whenever the editor reports a transaction or the
  // viewport resizes. `tick` is a bump-counter that re-runs the layout
  // effect — re-reading getBoundingClientRect inside.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const bump = (): void => setTick((t) => t + 1);
    editor.on('update', bump);
    editor.on('selectionUpdate', bump);
    window.addEventListener('resize', bump);
    return () => {
      editor.off('update', bump);
      editor.off('selectionUpdate', bump);
      window.removeEventListener('resize', bump);
    };
  }, [editor]);

  // Track narrow-viewport state — flips between gutter and inline layouts.
  const [narrow, setNarrow] = useState<boolean>(() => readNarrow());
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(max-width: 767px)');
    const listener = (e: MediaQueryListEvent): void => setNarrow(e.matches);
    if (mql.addEventListener) mql.addEventListener('change', listener);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', listener);
    };
  }, []);

  // Compute positions in a layout effect so the first paint already has
  // the notes in the right places. We resolve each block's element via
  // ProseMirror's `view.nodeDOM(pos)` — that walks the doc model directly,
  // doesn't depend on paperflow's class naming, and never desyncs from
  // a future render-timing change in the React NodeView. Vertical
  // placement still reads `getBoundingClientRect()` from the resolved
  // element (the canonical way to ask the browser where layout actually
  // put the element; respected by tests via rect mocks too).
  const [positions, setPositions] = useState<PositionedIssue[]>([]);
  useLayoutEffect(() => {
    if (blockIssues.length === 0) {
      setPositions([]);
      return;
    }
    const blockPositions = topLevelBlockPositions(editor);
    const containerRect = containerRef.current?.getBoundingClientRect();
    const containerTop = containerRect?.top ?? 0;

    const next: PositionedIssue[] = blockIssues.map((issue, i) => {
      const idx = indexByBlockId.get(issue.blockId ?? '');
      const pos = idx != null ? blockPositions[idx] : undefined;
      let top: number | null = null;
      if (typeof pos === 'number' && editor) {
        const dom = editor.view.nodeDOM(pos);
        if (dom instanceof HTMLElement) {
          top = dom.getBoundingClientRect().top - containerTop;
        }
      }
      return {
        key: `${issue.blockId ?? '?'}-${issue.rule}-${i}`,
        issue,
        top,
      };
    });
    setPositions(next);
  }, [blockIssues, indexByBlockId, editor, tick, narrow]);

  if (blockIssues.length === 0) return null;

  // Click handler — focus + scroll the offending block. We resolve the
  // target DOM element through ProseMirror (`view.nodeDOM(pos)`) so
  // this code path is independent of paperflow's class naming.
  const onNoteClick = (blockId: string | undefined): void => {
    if (!blockId || !editor) return;
    const idx = indexByBlockId.get(blockId);
    if (idx == null) return;
    const pos = topLevelBlockPositions(editor)[idx];
    if (typeof pos !== 'number') return;
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) {
      dom.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    // Place the cursor inside the offending block (pos is the position
    // BEFORE the node; +1 lands the caret at the start of its content).
    editor.commands.focus(pos + 1);
  };

  return (
    <div
      ref={containerRef}
      className={
        'paper-margin-diagnostics' +
        (narrow ? ' paper-margin-diagnostics--inline' : '')
      }
      data-testid="margin-diagnostics"
      data-narrow={narrow ? 'true' : 'false'}
    >
      {positions.map(({ key, issue, top }) => (
        <button
          key={key}
          type="button"
          className="paper-margin-diagnostics__note"
          data-testid={`margin-note-${issue.blockId}`}
          data-block-id={issue.blockId}
          data-rule={issue.rule}
          role="status"
          aria-live="polite"
          onClick={() => onNoteClick(issue.blockId)}
          style={
            narrow || top == null
              ? undefined
              : { position: 'absolute', top: `${top}px`, left: 0 }
          }
        >
          <span
            className="paper-margin-diagnostics__rule"
            aria-label={`Rule: ${issue.rule}`}
          >
            {issue.rule}
          </span>
          <span className="paper-margin-diagnostics__message">
            {issue.message}
          </span>
        </button>
      ))}
    </div>
  );
}
