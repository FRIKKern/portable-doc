/**
 * Pioneer move B — fifth preview channel: PDF.
 *
 * Sibling of EpubPreviewPanel / DocxPreviewPanel / InkPreviewPanel. Renders
 * the live `.pdf` that `toPdfBlob` would emit on Export, via the browser's
 * native PDF viewer mounted inside an iframe. No epub.js-style renderer —
 * Chrome (PDFium), Safari (Quartz), and Firefox (PDF.js) all render
 * `application/pdf` blob URLs out of the box.
 *
 * Lifecycle parity with the EPUB panel:
 *   - 500ms debounce between doc changes and the next re-render.
 *   - Cancellation flag drops late results when the doc flips mid-render.
 *   - Previous blob URL is revoked on every re-render AND on unmount —
 *     URL.createObjectURL leaks the underlying Blob otherwise.
 */
import { useEffect, useRef, useState } from 'react';
import type { PortableDoc } from '@portable-doc/core';
import { toPdfBlob } from './export/toPdf.js';

interface Props {
  doc: PortableDoc;
  visible: boolean;
  /** Optional close callback — wired into the panel's × button. */
  onClose?: () => void;
}

/** Debounce window between doc changes and the next re-render — matches the
 *  other preview channels (Docx / Ink / Epub) so all four feel equally calm. */
const PREVIEW_DEBOUNCE_MS = 500;

export function PdfPreviewPanel({
  doc,
  visible,
  onClose,
}: Props): JSX.Element | null {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  // Hold the most recent URL in a ref so the cleanup effect can revoke it on
  // unmount without re-running every time `pdfUrl` changes (which would
  // revoke the URL we just installed into the iframe).
  const pdfUrlRef = useRef<string | null>(null);
  pdfUrlRef.current = pdfUrl;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setStatus('loading');
        setError(null);
        try {
          const blob = await toPdfBlob(doc);
          if (cancelled) return;
          // Mint a fresh blob URL; revoke the previous one BEFORE installing
          // the replacement. Order matters — revoking after setState would
          // also kill the iframe's just-loaded src.
          setPdfUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(blob);
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

  // Revoke the last blob URL on unmount. Separate effect so visibility flips
  // don't tear down a URL we're still pointing the iframe at.
  useEffect(() => {
    return () => {
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = null;
      }
    };
  }, []);

  if (!visible) return null;

  return (
    <aside
      className="paper-pdf-preview"
      data-testid="pdf-preview-panel"
      aria-label="Live PDF preview"
    >
      <div
        className="paper-pdf-preview__header"
        data-testid="pdf-preview-header"
      >
        <span
          className="paper-pdf-preview__title"
          data-testid="pdf-preview-title"
        >
          PDF preview
        </span>
        {onClose && (
          <button
            type="button"
            className="paper-pdf-preview__close"
            data-testid="pdf-preview-close"
            aria-label="Close PDF preview"
            onClick={onClose}
          >
            ×
          </button>
        )}
      </div>
      {status === 'loading' && (
        <div
          className="paper-pdf-preview__loading"
          data-testid="pdf-preview-loading"
        >
          Rendering PDF preview…
        </div>
      )}
      {status === 'error' && (
        <div
          className="paper-pdf-preview__error"
          data-testid="pdf-preview-error"
          role="alert"
        >
          Preview failed: {error}
        </div>
      )}
      <div
        className="paper-pdf-preview__body"
        data-testid="pdf-preview-body"
      >
        {pdfUrl && (
          <iframe
            src={pdfUrl}
            title="PDF preview"
            data-testid="pdf-preview-iframe"
          />
        )}
      </div>
    </aside>
  );
}
