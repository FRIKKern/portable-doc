/**
 * ImageInsertDialog — quiet inline dialog for inserting an image URL +
 * optional alt text.
 *
 * Replaces the v0.4-prologue `window.prompt('Image URL')` / `window.prompt('Alt
 * text')` pair fired from the slash menu's `image` command. Native prompts
 * jarred against the warm-paper aesthetic; this dialog reuses the same chrome
 * tokens (`--paper-chrome-bg` / `--paper-chrome-border`) as the slash popover
 * and the format bubble so it reads as part of the same surface family.
 *
 * Wiring contract
 * ---------------
 * `SlashCommand.ts`'s `image` case dispatches a `paperflow:image-insert`
 * `CustomEvent` on `window`. The dialog (mounted at `App.tsx`) listens for it
 * and surfaces with the editor pre-captured. On Insert with a valid URL the
 * dialog forwards to `editor.chain().focus().setImage({ src, alt }).run()`.
 * On Cancel / Esc / click-outside it dismisses without touching the doc.
 *
 * URL validation matches the link extension's policy exactly:
 *   `/^https?:\/\//i.test(href)`
 * — keeps `javascript:` / `data:` / `file:` smuggling off the table.
 *
 * A11y
 * ----
 *   - `role="dialog"` + `aria-modal="true"` + `aria-labelledby` on the title.
 *   - Focus moves to the URL input on open. Escape closes.
 *   - Insert is the form's default submit; Enter on either input fires it.
 */
import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';

export interface ImageInsertDialogProps {
  /** When set, the dialog is open and will issue commands against this editor. */
  editor: Editor | null;
  /** When `editor` is null the dialog is hidden; passed back to clear. */
  onClose: () => void;
}

const URL_RULE = /^https?:\/\//i;

export function ImageInsertDialog({
  editor,
  onClose,
}: ImageInsertDialogProps): JSX.Element | null {
  const [src, setSrc] = useState('');
  const [alt, setAlt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Reset state + autofocus the URL field whenever the dialog opens.
  useEffect(() => {
    if (!editor) return;
    setSrc('');
    setAlt('');
    setError(null);
    queueMicrotask(() => urlRef.current?.focus());
  }, [editor]);

  // Esc closes (window-level so it works even when focus is inside the
  // dialog's text inputs — those would otherwise swallow Escape via the form).
  useEffect(() => {
    if (!editor) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, onClose]);

  // Click-outside dismissal. We use mousedown so the close happens before the
  // click event reaches anything underneath — same pattern as the JsonEditMode
  // overlay.
  useEffect(() => {
    if (!editor) return;
    function onDown(e: MouseEvent) {
      const card = cardRef.current;
      if (card && e.target instanceof Node && !card.contains(e.target)) {
        onClose();
      }
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [editor, onClose]);

  if (!editor) return null;

  function handleInsert(): void {
    const e = editor;
    if (!e) return;
    const href = src.trim();
    if (!href) {
      setError('URL is required');
      return;
    }
    if (!URL_RULE.test(href)) {
      setError('URL must start with http(s)://');
      return;
    }
    e.chain().focus().setImage({ src: href, alt: alt.trim() }).run();
    onClose();
  }

  return (
    <div
      className="paper-image-dialog__backdrop"
      data-testid="image-dialog-backdrop"
      aria-hidden="true"
    >
      <div
        ref={cardRef}
        className="paper-image-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="paper-image-dialog-title"
        data-testid="image-dialog"
      >
        <div id="paper-image-dialog-title" className="paper-image-dialog__title">
          Insert image
        </div>
        <form
          className="paper-image-dialog__form"
          onSubmit={(e) => {
            e.preventDefault();
            handleInsert();
          }}
        >
          <input
            ref={urlRef}
            type="url"
            className="paper-image-dialog__input"
            placeholder="https://"
            aria-label="Image URL"
            value={src}
            onChange={(ev) => {
              setSrc(ev.target.value);
              if (error) setError(null);
            }}
            data-testid="image-dialog-url"
          />
          <input
            type="text"
            className="paper-image-dialog__input"
            placeholder="Alt text (optional)"
            aria-label="Alt text"
            value={alt}
            onChange={(ev) => setAlt(ev.target.value)}
            data-testid="image-dialog-alt"
          />
          {error ? (
            <div
              className="paper-image-dialog__error"
              role="alert"
              data-testid="image-dialog-error"
            >
              {error}
            </div>
          ) : null}
          <div className="paper-image-dialog__actions">
            <button
              type="button"
              className="paper-image-dialog__btn"
              onClick={() => onClose()}
              data-testid="image-dialog-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="paper-image-dialog__btn paper-image-dialog__btn--primary"
              data-testid="image-dialog-insert"
            >
              Insert
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
