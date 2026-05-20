/**
 * Pioneer move A — sibling of DocxPreviewPanel for the EPUB channel.
 *
 * Renders the live `.epub` that `toEpubBlob` would emit on Export, via
 * `epubjs`, so authors get continuous fidelity confidence on the book
 * format the same way the Word / Terminal channels already do. Mirrors
 * DocxPreviewPanel's Props, useEffect debounce, render lifecycle, and
 * × close button.
 *
 * epub.js mounts its own iframe inside the container div — we hand it
 * the freshly-built ArrayBuffer, ask for `flow: 'scrolled-doc'` so the
 * whole chapter renders as one scrollable page (matching how the .docx
 * preview shows the full doc, not paginated A4), and clean up the
 * renderer on unmount / doc-change to free the iframe.
 */
import { useEffect, useRef, useState } from 'react';
import ePub, { type Book, type Rendition } from 'epubjs';
import type { PortableDoc } from '@portable-doc/core';
import { toEpubBlob } from './export/toEpub.js';

interface Props {
  doc: PortableDoc;
  visible: boolean;
  /** Optional close callback — wired into the panel's × button. */
  onClose?: () => void;
}

/** Debounce window between doc changes and the next re-render — matches
 *  DocxPreviewPanel + InkPreviewPanel's 500ms cadence so all three
 *  channels feel equally calm. */
const PREVIEW_DEBOUNCE_MS = 500;

export function EpubPreviewPanel({
  doc,
  visible,
  onClose,
}: Props): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Hold the active Book so we can destroy() it before the next render —
  // epub.js leaks its iframe + worker pool otherwise.
  const bookRef = useRef<Book | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    // Cancellation flag — discard late results if the doc changes (or
    // visibility flips) mid-render. Same pattern as the sibling panels.
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setStatus('loading');
        setError(null);
        try {
          const blob = await toEpubBlob(doc);
          if (cancelled) return;
          const arrayBuffer = await blob.arrayBuffer();
          if (cancelled) return;
          const container = containerRef.current;
          if (!container) return;
          // Tear down any previous rendition first — epub.js APPENDS the
          // new iframe under the container, so without destroy() each
          // render leaks an iframe and the panel stacks copies.
          if (bookRef.current) {
            try {
              bookRef.current.destroy();
            } catch {
              // destroy() can throw on partially-initialised books; we
              // swallow because we're about to overwrite the slot anyway.
            }
            bookRef.current = null;
          }
          container.replaceChildren();
          // epub.js accepts ArrayBuffer (binary) or a URL string. We pass
          // the buffer directly so the panel works without a blob URL
          // (no URL.createObjectURL plumbing / revocation to manage).
          const book = ePub(arrayBuffer);
          bookRef.current = book;
          // `flow: 'scrolled-doc'` renders the whole chapter as one
          // scrollable page (no left/right pagination), `spread: 'none'`
          // disables two-page spreads. The container's flex layout
          // gives epub.js a measurable height to work with.
          const rendition: Rendition = book.renderTo(container, {
            width: '100%',
            height: '100%',
            flow: 'scrolled-doc',
            spread: 'none',
          });
          await rendition.display();
          if (cancelled) {
            // Cancellation landed while we were displaying — release the
            // book we just bound so the next render starts clean.
            try {
              book.destroy();
            } catch {
              // ignore — see above
            }
            bookRef.current = null;
            return;
          }
          setStatus('ready');
        } catch (e) {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : String(e));
          setStatus('error');
        }
      })();
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [doc, visible]);

  // Destroy the book on unmount — separate effect so visibility flips don't
  // tear down state we want to keep across re-renders.
  useEffect(() => {
    return () => {
      if (bookRef.current) {
        try {
          bookRef.current.destroy();
        } catch {
          // ignore
        }
        bookRef.current = null;
      }
    };
  }, []);

  if (!visible) return null;

  return (
    <aside
      className="paper-epub-preview"
      data-testid="epub-preview-panel"
      aria-label="Live EPUB preview"
    >
      <div
        className="paper-epub-preview__header"
        data-testid="epub-preview-header"
      >
        <span
          className="paper-epub-preview__title"
          data-testid="epub-preview-title"
        >
          EPUB preview
        </span>
        {onClose && (
          <button
            type="button"
            className="paper-epub-preview__close"
            data-testid="epub-preview-close"
            aria-label="Close EPUB preview"
            onClick={onClose}
          >
            ×
          </button>
        )}
      </div>
      {status === 'loading' && (
        <div
          className="paper-epub-preview__loading"
          data-testid="epub-preview-loading"
        >
          Rendering EPUB preview…
        </div>
      )}
      {status === 'error' && (
        <div
          className="paper-epub-preview__error"
          data-testid="epub-preview-error"
          role="alert"
        >
          Preview failed: {error}
        </div>
      )}
      <div
        ref={containerRef}
        className="paper-epub-preview__body"
        data-testid="epub-preview-body"
      />
    </aside>
  );
}
