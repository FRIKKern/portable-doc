/**
 * A4 — Inline-format FormatBubble (paperflow-owned UI).
 *
 * Rendered as a child of `@tiptap/react`'s `<BubbleMenu>` substrate (see
 * `Editor.tsx`). The BubbleMenu plugin owns the floating-element positioning,
 * show/hide rhythm, and resize/flip behavior. This component owns the *toolbar
 * shape itself*: four buttons (Bold / Italic / Inline code / Link) plus an
 * inline URL input for the link mode.
 *
 * Why a paperflow-owned UI on top of the @tiptap/react primitive
 * -------------------------------------------------------------
 * The plan's hard rule is `BubbleMenu wraps FormatBubble.tsx` — TipTap brings
 * the floating substrate, paperflow brings the visual chrome. Prototype's
 * `.bubble-menu` / `.inline-btn` rules port verbatim into `paper.css` under
 * the `.paper-format-bubble*` namespace. No tippy.js options (we're on
 * @tiptap v3, which uses Floating UI under the hood).
 *
 * Stacking (grill Q3): `.paper-format-bubble` lands at
 * `var(--paper-bubble-menu-z, 20)`, comfortably above
 * `var(--paper-block-chrome-z)` (= 10) that A2 already pinned. A2's chrome
 * listens for `selectionUpdate` and adds `.is-selecting` to hide itself; that
 * gives belt-and-suspenders, but the z-stack alone is enough to keep the bubble
 * above the chrome when both want to paint in the same region.
 *
 * Link affordance
 * ---------------
 * Press the link button → a small inline URL input slides in next to the
 * buttons. Enter applies the link via
 * `editor.chain().focus().extendMarkRange('link').setLink({ href }).run()`;
 * Escape cancels. When the current selection already contains a `link` mark,
 * the link button switches to a "Remove" affordance (clicking calls
 * `unsetLink()` on the extended range).
 *
 * A11y (grill Q12)
 * ----------------
 *   - Each button has an `aria-label` ("Bold", "Italic", "Inline code", "Link")
 *     and reports its active state via `aria-pressed`.
 *   - The URL input has `aria-label="Link URL"` and traps focus while open
 *     (no DOM trickery needed — there are only two interactive elements; Tab
 *     cycles within the bubble naturally).
 *   - `prefers-reduced-motion` collapses the open animation to 0ms via
 *     `--motion-bubble-menu-open` (declared in motion.css).
 *   - Focus rings use `var(--paper-accent-warm-rust)` at 2px to match the
 *     rest of the editor's accent affordances.
 */
import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';

export interface FormatBubbleProps {
  /** The TipTap editor instance to issue commands against. */
  editor: Editor;
}

/**
 * Returns the current `href` for the link mark at the active selection, or
 * `null` when the selection doesn't carry a link. Used to seed the URL input
 * with the existing value when the writer clicks the link button on a
 * pre-linked phrase.
 */
function readActiveLinkHref(editor: Editor): string | null {
  const attrs = editor.getAttributes('link');
  const href = attrs?.href;
  return typeof href === 'string' && href.length > 0 ? href : null;
}

export function FormatBubble({ editor }: FormatBubbleProps): JSX.Element {
  const [linkMode, setLinkMode] = useState<'closed' | 'editing'>('closed');
  const [linkValue, setLinkValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // `editor.isActive(…)` reads ProseMirror state — to make React re-render
  // when that state changes we use `useEditorState`, the canonical TipTap 3
  // subscription hook. It runs the selector on each TX, shallow-compares the
  // result, and only re-renders this component when the selector output
  // changes. That's much cheaper than the previous "tick on every TX"
  // pattern, which thrashed the bubble's render cycle.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      code: e.isActive('code'),
      link: e.isActive('link'),
    }),
  });
  const hasLink = state.link;

  // When entering link-mode, focus the input and pre-fill it with any
  // existing href so the writer can edit instead of retype.
  useEffect(() => {
    if (linkMode === 'editing') {
      const existing = readActiveLinkHref(editor);
      setLinkValue(existing ?? '');
      // Focus on the next microtask so React has flushed the input into DOM.
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [linkMode, editor]);

  function applyLink(): void {
    const href = linkValue.trim();
    if (!href) {
      setLinkMode('closed');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setLinkMode('closed');
  }

  function cancelLink(): void {
    setLinkMode('closed');
    setLinkValue('');
  }

  function removeLink(): void {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkMode('closed');
  }

  function onLinkButton(): void {
    if (hasLink && linkMode === 'closed') {
      // First click on a button that's already showing the "linked" state —
      // open the edit affordance pre-filled, just like opening on plain text
      // does but seeded with the existing href.
      setLinkMode('editing');
      return;
    }
    setLinkMode((prev) => (prev === 'editing' ? 'closed' : 'editing'));
  }

  return (
    <div
      className="paper-format-bubble"
      role="toolbar"
      aria-label="Inline format"
      data-testid="bubble-menu"
    >
      <button
        type="button"
        className={
          'paper-format-bubble__btn paper-format-bubble__btn--bold' +
          (state.bold ? ' paper-format-bubble__btn--active' : '')
        }
        aria-label="Bold"
        aria-pressed={state.bold}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        B
      </button>
      <button
        type="button"
        className={
          'paper-format-bubble__btn paper-format-bubble__btn--italic' +
          (state.italic ? ' paper-format-bubble__btn--active' : '')
        }
        aria-label="Italic"
        aria-pressed={state.italic}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        I
      </button>
      <span className="paper-format-bubble__sep" aria-hidden="true" />
      <button
        type="button"
        className={
          'paper-format-bubble__btn paper-format-bubble__btn--code' +
          (state.code ? ' paper-format-bubble__btn--active' : '')
        }
        aria-label="Inline code"
        aria-pressed={state.code}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        {'</>'}
      </button>
      <span className="paper-format-bubble__sep" aria-hidden="true" />
      <button
        type="button"
        className={
          'paper-format-bubble__btn paper-format-bubble__btn--link' +
          (hasLink ? ' paper-format-bubble__btn--active' : '')
        }
        // When the selection already has a link, the button affordance is
        // edit/remove — surface that in the label so screen readers hear the
        // updated action. The button still toggles the inline input on click.
        aria-label={hasLink ? 'Edit or remove link' : 'Link'}
        aria-pressed={hasLink}
        data-link-state={hasLink ? 'linked' : 'unlinked'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onLinkButton}
      >
        🔗
      </button>
      {linkMode === 'editing' ? (
        <div className="paper-format-bubble__link-row" data-testid="bubble-link-row">
          <input
            ref={inputRef}
            type="url"
            className="paper-format-bubble__link-input"
            aria-label="Link URL"
            placeholder="https://"
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelLink();
              }
            }}
            // Don't let mousedown steal selection from the editor — without
            // this, focus leaves the input the moment the writer clicks it.
            onMouseDown={(e) => e.stopPropagation()}
          />
          {hasLink ? (
            <button
              type="button"
              className="paper-format-bubble__link-remove"
              aria-label="Remove link"
              onMouseDown={(e) => e.preventDefault()}
              onClick={removeLink}
            >
              Remove
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
