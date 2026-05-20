/**
 * Pioneer move A — sibling of DocxPreviewPanel for the Terminal / TUI channel.
 *
 * Same overlay-on-right shape, dark terminal aesthetic. Renders the live doc
 * through `@portable-doc/backend-ink` (PortableDoc → composeDocument → PdNode
 * → renderInk → ANSI string) and converts the ANSI escapes to HTML via
 * `anser` so the browser can show ANSI colors. Mirrors DocxPreviewPanel's
 * Props, useEffect debounce, render lifecycle, and close button.
 */
import { useEffect, useRef, useState } from 'react';
import Anser from 'anser';
import type { PortableDoc } from '@portable-doc/core';
import { composeDocument } from '@portable-doc/primitives';
import { renderInk } from '@portable-doc/backend-ink';

interface Props {
  doc: PortableDoc;
  visible: boolean;
  /** Optional close callback — wired into the panel's × button. */
  onClose?: () => void;
}

/** Debounce window between doc changes and the next re-render — matches
 *  DocxPreviewPanel's 500ms cadence so both channels feel equally calm. */
const PREVIEW_DEBOUNCE_MS = 500;

export function InkPreviewPanel({
  doc,
  visible,
  onClose,
}: Props): JSX.Element | null {
  const [html, setHtml] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    // Cancellation flag — discard late results if the doc changes (or
    // visibility flips) mid-render. Same pattern as DocxPreviewPanel.
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setStatus('loading');
      setError(null);
      try {
        // composeDocument → PdNode is the contract renderInk consumes.
        // Truecolor depth — Anser maps the resulting 24-bit ANSI escapes
        // into inline rgb() style spans, and class-mapped 16-color spans
        // for the named-color paths.
        const ansi = renderInk(composeDocument(doc), { colorDepth: 'truecolor' });
        if (cancelled) return;
        // anser's class-mapped output uses `ansi-<name>-fg/bg` class names
        // we style in paper.css; bold + italic + underline drop in as
        // `ansi-bold` etc. on the same spans.
        const converted = Anser.ansiToHtml(ansi, { use_classes: true });
        if (cancelled) return;
        setHtml(converted);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [doc, visible]);

  if (!visible) return null;

  return (
    <aside
      className="paper-ink-preview"
      data-testid="ink-preview-panel"
      aria-label="Live terminal preview"
    >
      <div
        className="paper-ink-preview__header"
        data-testid="ink-preview-header"
      >
        <span
          className="paper-ink-preview__title"
          data-testid="ink-preview-title"
        >
          Terminal preview
        </span>
        {onClose && (
          <button
            type="button"
            className="paper-ink-preview__close"
            data-testid="ink-preview-close"
            aria-label="Close terminal preview"
            onClick={onClose}
          >
            ×
          </button>
        )}
      </div>
      {status === 'loading' && (
        <div
          className="paper-ink-preview__loading"
          data-testid="ink-preview-loading"
        >
          Rendering terminal preview…
        </div>
      )}
      {status === 'error' && (
        <div
          className="paper-ink-preview__error"
          data-testid="ink-preview-error"
          role="alert"
        >
          Preview failed: {error}
        </div>
      )}
      {status === 'ready' && (
        <pre
          className="paper-ink-preview__body"
          data-testid="ink-preview-body"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </aside>
  );
}
