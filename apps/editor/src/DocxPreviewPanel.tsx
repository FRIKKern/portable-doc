/**
 * Pioneer move A — lean side-panel .docx preview prototype.
 *
 * Renders the live .docx that `toDocxBlob` would emit on Export, via
 * `docx-preview`, so authors get continuous fidelity confidence: edit →
 * panel re-renders the same artifact Word / Pages / Google Docs would open.
 *
 * One channel (.docx) is enough to prove the concept. The full Universal
 * Preview Grid extends this with parallel email / EPUB / ink panels.
 */
import { useEffect, useRef, useState } from 'react';
import type { PortableDoc } from '@portable-doc/core';
import { renderAsync } from 'docx-preview';
import { toDocxBlob } from './export/toDocx.js';

interface Props {
  doc: PortableDoc;
  visible: boolean;
  /** Optional close callback — wired into the panel's × button. */
  onClose?: () => void;
}

/** Debounce window between doc changes and the next re-render — keeps the
 *  panel calm under rapid keystrokes without falling behind. */
const PREVIEW_DEBOUNCE_MS = 500;

export function DocxPreviewPanel({
  doc,
  visible,
  onClose,
}: Props): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    // Cancellation flag — if the doc changes (or visibility flips) mid-render
    // we discard the late result instead of letting it overwrite a fresher
    // render. Same pattern as a useEffect-driven async fetch.
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setStatus('loading');
        setError(null);
        try {
          const blob = await toDocxBlob(doc);
          if (cancelled) return;
          const container = containerRef.current;
          if (!container) return;
          // docx-preview APPENDS to the container — clear first so each
          // render lands a fresh page tree instead of stacking copies.
          container.replaceChildren();
          await renderAsync(blob, container, undefined, {
            className: 'paper-docx-preview__page',
            inWrapper: true,
            hideWrapperOnPrint: false,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: true,
            ignoreLastRenderedPageBreak: true,
            experimental: false,
            trimXmlDeclaration: true,
            useBase64URL: true,
            // The empty header section docx-preview reserves at the top of
            // every page renders as a gray bar above the body content. We
            // don't author headers/footers anywhere, so suppress both.
            renderHeaders: false,
            renderFooters: false,
          });
          if (cancelled) return;
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

  if (!visible) return null;

  return (
    <aside
      className="paper-docx-preview"
      data-testid="docx-preview-panel"
      aria-label="Live Word preview"
    >
      <div
        className="paper-docx-preview__header"
        data-testid="docx-preview-header"
      >
        <span
          className="paper-docx-preview__title"
          data-testid="docx-preview-title"
        >
          Word preview
        </span>
        {onClose && (
          <button
            type="button"
            className="paper-docx-preview__close"
            data-testid="docx-preview-close"
            aria-label="Close Word preview"
            onClick={onClose}
          >
            ×
          </button>
        )}
      </div>
      {status === 'loading' && (
        <div
          className="paper-docx-preview__loading"
          data-testid="docx-preview-loading"
        >
          Rendering preview…
        </div>
      )}
      {status === 'error' && (
        <div
          className="paper-docx-preview__error"
          data-testid="docx-preview-error"
          role="alert"
        >
          Preview failed: {error}
        </div>
      )}
      <div
        ref={containerRef}
        className="paper-docx-preview__body"
        data-testid="docx-preview-body"
      />
    </aside>
  );
}
