/**
 * PreviewStrip — header thumbnail strip that REPLACES the 5-tab text
 * switcher (per build-phase grill q12). Five thumbnails ARE the surface
 * switcher; labels under each.
 *
 * Tab order: TUI → Email → Web → Native → JSON. Default is TUI.
 *
 * Lazy-mount preserved: only the active surface's heavy renderer mounts
 * in the right-panel `<section role="tabpanel">`. Thumbnails are LIGHT —
 * CSS-only mini-previews for TUI/Native/JSON, static placeholders for
 * the heavy ones (Email iframe, Web RNW). Thumbnail content is
 * recomputed against a doc reference debounced by 500 ms so rapid edits
 * don't thrash the strip.
 */
import { Suspense, lazy, useMemo, useState } from 'react';
import type { PortableDoc } from '@portable-doc/core';
import { TuiPreview } from './previews/Tui.js';
import { EmailPreview } from './previews/Email.js';
import { NativePreview } from './previews/Native.js';
import { JsonPreview } from './previews/Json.js';
import { useDebouncedValue } from './lib/use-debounced-value.js';

const WebPreview = lazy(() => import('./previews/Web.js'));

export const SURFACES = ['tui', 'email', 'web', 'native', 'json'] as const;
export type SurfaceKey = (typeof SURFACES)[number];
export const DEFAULT_SURFACE: SurfaceKey = 'tui';

const LABELS: Record<SurfaceKey, string> = {
  tui: 'TUI',
  email: 'Email',
  web: 'Web',
  native: 'Native',
  json: 'JSON',
};

interface Props {
  doc: PortableDoc;
}

export function PreviewStrip({ doc }: Props) {
  const [active, setActive] = useState<SurfaceKey>(DEFAULT_SURFACE);

  // Thumbnails read from a debounced doc — strip stays still while typing.
  // The active right-panel preview still gets the live `doc` (untouched).
  const debouncedDoc = useDebouncedValue(doc, 500);

  return (
    <div className="col" data-testid="preview-col" style={{ borderRight: 'none' }}>
      <div className="preview-strip" role="tablist" aria-label="Preview surface">
        {SURFACES.map((key) => {
          const isActive = key === active;
          return (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={`active-panel-${key}`}
              data-surface={key}
              data-testid={`thumb-${key}`}
              className={`preview-thumb${isActive ? ' active' : ''}`}
              onClick={() => setActive(key)}
              tabIndex={0}
            >
              <span className="preview-thumb-frame" aria-hidden="true">
                <ThumbContent surface={key} doc={debouncedDoc} />
              </span>
              <span className="preview-thumb-label">{LABELS[key]}</span>
            </button>
          );
        })}
      </div>

      <section
        role="tabpanel"
        id={`active-panel-${active}`}
        data-testid={`active-panel-${active}`}
      >
        {active === 'tui' && <TuiPreview doc={doc} />}
        {active === 'email' && <EmailPreview doc={doc} />}
        {active === 'web' && (
          <Suspense
            fallback={
              <div className="lazy-fallback" data-testid="web-lazy-fallback">
                Loading Web preview…
              </div>
            }
          >
            <WebPreview doc={doc} />
          </Suspense>
        )}
        {active === 'native' && <NativePreview doc={doc} />}
        {active === 'json' && <JsonPreview doc={doc} />}
      </section>
    </div>
  );
}

/* ---------- thumbnail content (lightweight, CSS-only where possible) ---------- */

function ThumbContent({ surface, doc }: { surface: SurfaceKey; doc: PortableDoc }) {
  if (surface === 'tui') return <ThumbAscii doc={doc} />;
  if (surface === 'email') return <ThumbBoxedHeading doc={doc} accent="#4f46e5" />;
  if (surface === 'web') return <ThumbBoxedHeading doc={doc} accent="#3b5b8c" />;
  if (surface === 'native') return <ThumbDots doc={doc} />;
  return <ThumbBraces doc={doc} />;
}

function firstHeadingText(doc: PortableDoc): string {
  for (const b of doc.blocks) {
    if (b.type === 'heading') return b.text;
  }
  return doc.title ?? 'Untitled';
}

function ThumbAscii({ doc }: { doc: PortableDoc }) {
  const lines = useMemo(() => {
    const heading = firstHeadingText(doc).slice(0, 10) || 'Document';
    const hasPara = doc.blocks.some((b) => b.type === 'paragraph');
    const rule = hasPara ? '────────────' : '            ';
    return [
      '┌────────────┐',
      `│ # ${heading.padEnd(10).slice(0, 10)} │`,
      `│ ${rule.padEnd(12).slice(0, 12)} │`,
      '└────────────┘',
    ];
  }, [doc]);
  return (
    <span className="thumb-ascii">
      {lines.map((l, i) => (
        <span key={i} className="thumb-ascii-line">
          {l}
        </span>
      ))}
    </span>
  );
}

function ThumbBoxedHeading({ doc, accent }: { doc: PortableDoc; accent: string }) {
  const heading = firstHeadingText(doc).slice(0, 18) || 'Document';
  return (
    <span className="thumb-boxed" style={{ borderTopColor: accent }}>
      <span className="thumb-boxed-heading">{heading}</span>
      <span className="thumb-boxed-rule" />
      <span className="thumb-boxed-rule short" />
    </span>
  );
}

function ThumbDots({ doc }: { doc: PortableDoc }) {
  // One column-bar per block, capped at 5. Visualizes "list of native cells."
  const bars = useMemo(() => {
    const n = Math.min(doc.blocks.length, 5) || 1;
    return Array.from({ length: n }).map((_, i) => 30 + ((i * 7) % 25));
  }, [doc]);
  return (
    <span className="thumb-dots">
      {bars.map((h, i) => (
        <span key={i} className="thumb-dots-bar" style={{ height: `${h}px` }} />
      ))}
    </span>
  );
}

function ThumbBraces({ doc }: { doc: PortableDoc }) {
  // Tiny stylized JSON glyph: { "..." }
  const count = doc.blocks.length;
  return (
    <span className="thumb-braces">
      <span className="thumb-braces-brace">{'{'}</span>
      <span className="thumb-braces-rows">
        <span className="thumb-braces-row" />
        <span className="thumb-braces-row" />
        <span className="thumb-braces-count">{count}</span>
      </span>
      <span className="thumb-braces-brace">{'}'}</span>
    </span>
  );
}
