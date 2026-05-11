/**
 * v0.4 A8 — footer status row.
 *
 * Replaces the empty A1 `<footer data-testid="paper-footer" />` placeholder
 * with a 36px fixed bottom strip containing:
 *
 *   ✓ valid (or N issues)   ·   ● MCP   ·   saved Ns ago   ·   N words
 *
 * Each chip is a button with `aria-label` for SR users. Clicking the MCP
 * dot expands an inline popover at ≥768px and opens a full-width bottom
 * sheet (role=dialog, aria-modal, Esc-dismissible, focus-trapped) at <768px.
 *
 * Per grill Q8 (narrow viewport): the sheet slides up from `bottom: var(
 * --paper-footer-height)` using `var(--motion-footer-sheet-slide)` — the
 * value collapses to 0 under `prefers-reduced-motion: reduce` via motion.css.
 *
 * State sources:
 *   - validation count → `validateDoc(doc)` (memoized + debounced 500ms)
 *   - MCP reachability → `useMcp()` (provider unchanged from v0.3)
 *   - save state       → ref-tracked timestamp, ticks every 1s via setInterval
 *   - word count       → derived from doc, debounced 500ms
 *
 * The editor is local-only in v0.4 (no save backend), so "saved Ns ago" ticks
 * from a doc-change timestamp. Cap at "saved 1m ago" for readability.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Block, InlineNode, PortableDoc } from '@portable-doc/core';
import { validateDoc } from '@portable-doc/core';
import { useMcp } from './McpProvider.js';

interface Props {
  doc: PortableDoc;
}

// ---------------------------------------------------------------------------
// Word count — walk the doc, harvest text, split on whitespace.
// ---------------------------------------------------------------------------

function inlineText(nodes: InlineNode[] | undefined): string {
  if (!nodes) return '';
  const parts: string[] = [];
  for (const n of nodes) {
    if (n.type === 'text') parts.push(n.value);
    else if (n.type === 'code') parts.push(n.value);
    else if (n.type === 'strong' || n.type === 'em' || n.type === 'link')
      parts.push(inlineText(n.children));
  }
  return parts.join(' ');
}

function blockText(b: Block): string {
  switch (b.type) {
    case 'heading':
      return b.text ?? '';
    case 'paragraph':
      return inlineText(b.content);
    case 'list':
      return b.items.map((it) => inlineText(it)).join(' ');
    case 'callout':
      return [b.title ?? '', inlineText(b.content)].join(' ');
    case 'action':
      return b.label ?? '';
    case 'code':
      return b.value ?? '';
    case 'section':
      return [b.title ?? '', ...b.blocks.map(blockText)].join(' ');
    case 'image':
      return b.alt ?? '';
    case 'table':
      return b.rows
        .map((row) => row.map((cell) => inlineText(cell)).join(' '))
        .join(' ');
    case 'divider':
      return '';
    default:
      return '';
  }
}

export function countWords(doc: PortableDoc): number {
  const text = [doc.title ?? '', ...doc.blocks.map(blockText)]
    .join(' ')
    .trim();
  if (text.length === 0) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Debounce a value to once per `delay` ms. Used for word-count + validation.
// ---------------------------------------------------------------------------

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Tick a 1Hz `now` so the "saved Ns ago" string refreshes every second.
// ---------------------------------------------------------------------------

function useTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatSaved(savedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - savedAt) / 1000));
  if (seconds < 1) return 'saved just now';
  if (seconds < 60) return `saved ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `saved ${minutes}m ago`;
}

// ---------------------------------------------------------------------------
// Match media — narrow viewport (<768px) gets the bottom sheet, wide gets
// the inline popover. Tracked with a state-bound listener so the right
// surface mounts when the user rotates / resizes the window.
// ---------------------------------------------------------------------------

function useIsWide(): boolean {
  const [wide, setWide] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia('(min-width: 768px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(min-width: 768px)');
    const listener = (e: MediaQueryListEvent) => setWide(e.matches);
    // addEventListener has wider browser support than addListener; both
    // exist in happy-dom but the modern shape is cleaner to spy on.
    if (mql.addEventListener) mql.addEventListener('change', listener);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', listener);
    };
  }, []);
  return wide;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FooterStatus({ doc }: Props): JSX.Element {
  const { reachable, retry } = useMcp();

  // Debounce validation + word count to once per 500ms.
  const debouncedDoc = useDebounced(doc, 500);
  const issues = useMemo(() => validateDoc(debouncedDoc), [debouncedDoc]);
  const wordCount = useMemo(() => countWords(debouncedDoc), [debouncedDoc]);

  // "saved Ns ago" — savedAt advances each time the doc reference changes
  // (Editor.tsx's onUpdate plumbs new docs up). Stored in state so the
  // footer re-renders with the fresh "just now" the moment the doc lands,
  // not one tick later. `useRef` + `useEffect` would defer the visible
  // reset by a frame.
  const [savedAt, setSavedAt] = useState<number>(() => Date.now());
  const firstRenderRef = useRef(true);
  useEffect(() => {
    // The very first render's savedAt was set by useState; only doc CHANGES
    // after mount should bump it. Otherwise StrictMode double-mount would
    // re-stamp and the initial "saved just now" stays.
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    setSavedAt(Date.now());
  }, [doc]);
  const now = useTick(1000);

  const wide = useIsWide();
  const [mcpOpen, setMcpOpen] = useState(false);

  const closeMcp = useCallback(() => setMcpOpen(false), []);
  const onMcpClick = useCallback(() => setMcpOpen((v) => !v), []);

  // Esc anywhere dismisses both the inline popover and the sheet.
  useEffect(() => {
    if (!mcpOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMcpOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mcpOpen]);

  const validationLabel =
    issues.length === 0 ? '✓ valid' : `${issues.length} issue${issues.length === 1 ? '' : 's'}`;
  const validationDotTone =
    issues.length === 0 ? 'success' : 'danger';

  const mcpStatus: 'connected' | 'connecting' | 'disconnected' =
    reachable === true ? 'connected' : reachable === null ? 'connecting' : 'disconnected';
  const mcpDotTone =
    mcpStatus === 'connected' ? 'success' : mcpStatus === 'connecting' ? 'warning' : 'neutral';
  const mcpLabel =
    mcpStatus === 'connected'
      ? 'MCP connected'
      : mcpStatus === 'connecting'
        ? 'MCP connecting'
        : 'MCP disconnected';

  return (
    <footer
      className="paper-footer paper-footer-status"
      data-testid="paper-footer"
      role="status"
      aria-label="Document status"
    >
      <span
        className="paper-footer-status__chip"
        data-testid="footer-validation"
        data-tone={validationDotTone}
      >
        <span
          className="paper-footer-status__dot"
          data-testid="footer-validation-dot"
          data-tone={validationDotTone}
          aria-hidden="true"
        />
        <span data-testid="footer-validation-label">{validationLabel}</span>
      </span>

      <span className="paper-footer-status__sep" aria-hidden="true" />

      <button
        type="button"
        className="paper-footer-status__chip paper-footer-status__chip--button"
        data-testid="footer-mcp"
        aria-label={mcpLabel}
        aria-expanded={mcpOpen}
        aria-haspopup={wide ? 'true' : 'dialog'}
        onClick={onMcpClick}
      >
        <span
          className="paper-footer-status__dot"
          data-testid="footer-mcp-dot"
          data-tone={mcpDotTone}
          data-mcp-status={mcpStatus}
          aria-hidden="true"
        />
        <span data-testid="footer-mcp-label">{mcpLabel}</span>
      </button>

      {mcpOpen && wide && (
        <McpInlinePopover
          status={mcpStatus}
          onRetry={() => {
            void retry();
          }}
          onClose={closeMcp}
        />
      )}

      <span className="paper-footer-status__sep" aria-hidden="true" />

      <span
        className="paper-footer-status__chip"
        data-testid="footer-saved"
        aria-label={formatSaved(savedAt, now)}
      >
        {formatSaved(savedAt, now)}
      </span>

      <span className="paper-footer-status__grow" />

      <span
        className="paper-footer-status__chip"
        data-testid="footer-words"
        aria-label={`${wordCount} word${wordCount === 1 ? '' : 's'}`}
      >
        {wordCount} {wordCount === 1 ? 'word' : 'words'}
      </span>

      {mcpOpen && !wide && (
        <McpSheet
          status={mcpStatus}
          onRetry={() => {
            void retry();
          }}
          onClose={closeMcp}
        />
      )}
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Inline popover (≥768px) — sits above the footer next to the MCP chip.
// ---------------------------------------------------------------------------

function McpInlinePopover({
  status,
  onRetry,
  onClose,
}: {
  status: 'connected' | 'connecting' | 'disconnected';
  onRetry: () => void;
  onClose: () => void;
}): JSX.Element {
  // Outside-click dismissal — listen on the document, ignore clicks inside
  // the popover or on the MCP chip that opens it.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      // Don't close when the click landed on the MCP chip that toggles us.
      const chip = document.querySelector('[data-testid="footer-mcp"]');
      if (chip && chip.contains(target)) return;
      if (rootRef.current && !rootRef.current.contains(target)) onClose();
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className="paper-footer-status__popover"
      data-testid="footer-mcp-popover"
      role="region"
      aria-label="MCP connection detail"
    >
      <McpDetailBody status={status} />
      {status !== 'connected' && (
        <button
          type="button"
          className="paper-footer-status__retry"
          data-testid="footer-mcp-retry"
          onClick={onRetry}
        >
          Retry
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom sheet (<768px) — full-width, slides up from the footer, role=dialog.
// ---------------------------------------------------------------------------

function McpSheet({
  status,
  onRetry,
  onClose,
}: {
  status: 'connected' | 'connecting' | 'disconnected';
  onRetry: () => void;
  onClose: () => void;
}): JSX.Element {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // Initial focus → close button. Focus trap → Tab cycles within the sheet.
  useEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  useEffect(() => {
    function trap(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const root = sheetRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'button, [href], input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, []);

  function onBackdropMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    // Tap outside the sheet body dismisses.
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className="paper-footer-status__backdrop"
      data-testid="footer-mcp-backdrop"
      onMouseDown={onBackdropMouseDown}
    >
      <div
        ref={sheetRef}
        className="paper-footer-status__sheet"
        data-testid="footer-mcp-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="MCP connection detail"
      >
        <McpDetailBody status={status} />
        <div className="paper-footer-status__sheet-actions">
          {status !== 'connected' && (
            <button
              type="button"
              className="paper-footer-status__retry"
              data-testid="footer-mcp-retry"
              onClick={onRetry}
            >
              Retry
            </button>
          )}
          <button
            ref={closeBtnRef}
            type="button"
            className="paper-footer-status__close"
            data-testid="footer-mcp-close"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared body — same copy in inline popover + bottom sheet.
// ---------------------------------------------------------------------------

function McpDetailBody({
  status,
}: {
  status: 'connected' | 'connecting' | 'disconnected';
}): ReactNode {
  if (status === 'connected') {
    return (
      <p className="paper-footer-status__detail">
        Connected to <code>localhost:6123</code>.
      </p>
    );
  }
  if (status === 'connecting') {
    return (
      <p className="paper-footer-status__detail">
        Probing <code>localhost:6123</code>…
      </p>
    );
  }
  return (
    <p className="paper-footer-status__detail">
      Disconnected from <code>localhost:6123</code>. Start with
      {' '}<code>pnpm dev:full</code>, then click Retry.
    </p>
  );
}
