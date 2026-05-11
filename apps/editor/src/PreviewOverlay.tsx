/**
 * v0.4 — ⌘P preview overlay (A7).
 *
 * A React portal-mounted modal that renders the 5 surface previews stacked
 * vertically (or 2-column at wide viewports). Triggered by ⌘P on macOS,
 * Ctrl+P on Linux/Windows. Esc dismisses; backdrop click dismisses; click
 * on the modal body does NOT close.
 *
 * Per build-phase grill Q12 (a11y):
 *   - role="dialog" + aria-modal="true" + aria-labelledby pointing at a
 *     visually-hidden H2.
 *   - Focus trap (hand-rolled, ~25 LOC) — on open, Close button receives
 *     focus; Tab cycles forward within the modal, Shift+Tab cycles back.
 *   - On close, focus returns to the element that had focus before open
 *     (typically the editor).
 *   - prefers-reduced-motion collapses fades via paper.css variables.
 *
 * Per T3 layout (inset cascade): 64px at ≥768px, 24px at 480–767px,
 * full-bleed (0px) under 480px.
 *
 * MCP-first / direct-fallback: the 5 surface components already route
 * through `useRenderedContent`. A7 just mounts them — the render path is
 * unchanged.
 *
 * Hard rule: this file does NOT touch Editor.tsx or FormatBubble.tsx. The
 * global ⌘P hotkey wiring lives in App.tsx (App owns previewOpen state).
 */
import { useCallback, useEffect, useRef, Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import type { PortableDoc } from '@portable-doc/core';
import { TuiPreview } from './previews/Tui.js';
import { EmailPreview } from './previews/Email.js';
import { NativePreview } from './previews/Native.js';
import { JsonPreview } from './previews/Json.js';

const WebPreview = lazy(() => import('./previews/Web.js'));

interface Props {
  doc: PortableDoc;
  open: boolean;
  onClose: () => void;
}

const SURFACES = ['web', 'email', 'tui', 'native', 'json'] as const;
type Surface = (typeof SURFACES)[number];

const LABELS: Record<Surface, string> = {
  web: 'Web',
  email: 'Email',
  tui: 'TUI',
  native: 'Native',
  json: 'JSON',
};

export function PreviewOverlay({ doc, open, onClose }: Props) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<Element | null>(null);

  // Backdrop click closes; modal-body click does NOT (stopPropagation).
  const onBackdropClick = useCallback(() => {
    onClose();
  }, [onClose]);

  // Focus management — capture pre-open focus, move focus into the modal
  // on open, restore on close.
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement;
    // Defer to next paint so the modal is in the DOM before we focus.
    const id = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(id);
      const prev = previousFocusRef.current;
      if (prev instanceof HTMLElement) {
        prev.focus();
      }
    };
  }, [open]);

  // Hand-rolled focus trap — keep Tab/Shift+Tab inside the modal while open.
  // Esc is handled at the App.tsx level (global keydown), but we keep a
  // defensive local listener too in case the overlay is mounted outside App.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = modalRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const overlay = (
    <div
      className="paper-preview-overlay"
      data-testid="preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paper-preview-overlay-title"
    >
      <div
        className="paper-preview-overlay__backdrop"
        data-testid="preview-overlay-backdrop"
        onClick={onBackdropClick}
        aria-hidden="true"
      />
      <div
        className="paper-preview-overlay__modal"
        data-testid="preview-overlay-modal"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="paper-preview-overlay-title"
          className="paper-preview-overlay__title"
        >
          Preview — all surfaces
        </h2>
        <button
          type="button"
          className="paper-preview-overlay__close"
          data-testid="preview-overlay-close"
          aria-label="Close preview"
          onClick={onClose}
          ref={closeButtonRef}
        >
          ×
        </button>
        <div className="paper-preview-overlay__grid">
          {SURFACES.map((key) => (
            <section
              key={key}
              className="paper-preview-overlay__surface"
              data-testid={`preview-overlay-surface-${key}`}
              data-surface={key}
            >
              <div className="paper-preview-overlay__surface-label">{LABELS[key]}</div>
              <SurfaceBody surface={key} doc={doc} />
            </section>
          ))}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

function SurfaceBody({ surface, doc }: { surface: Surface; doc: PortableDoc }) {
  if (surface === 'tui') return <TuiPreview doc={doc} />;
  if (surface === 'email') return <EmailPreview doc={doc} />;
  if (surface === 'native') return <NativePreview doc={doc} />;
  if (surface === 'json') return <JsonPreview doc={doc} />;
  return (
    <Suspense
      fallback={
        <div className="lazy-fallback" data-testid="web-lazy-fallback">
          Loading Web preview…
        </div>
      }
    >
      <WebPreview doc={doc} />
    </Suspense>
  );
}
