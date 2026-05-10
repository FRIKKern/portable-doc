/**
 * 5-surface render layout — Web → Email → TUI → Native → Text.
 *
 * Kernel-direct: the playground is NOT an MCP consumer. Backends are called
 * straight from the bundle. Email is async (React Email render returns a
 * Promise); the other four are sync. ANSI in the TUI tab is converted to
 * inline-styled HTML by the hand-rolled `ansiToHtml` parser — no `ansi_up`
 * dep (per grill q6).
 */
import { Component, Suspense, lazy } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { composeDocument } from '@portable-doc/primitives';
import { renderHtml } from '@portable-doc/backend-web/static';
import type { PortableDoc } from '@portable-doc/core';

// Email and Ink are lazy-loaded per surface — they pull in react-email/render
// (~70 KB gzip) and cli-highlight/highlight.js (~300 KB gzip) respectively.
// Web/Native/Text remain in the main bundle since renderHtml is pure-string
// and Native/Text reuse already-loaded modules.
const LazyEmail = lazy(() => import('./surfaces/email.js'));
const LazyTui = lazy(() => import('./surfaces/tui.js'));
const LazyText = lazy(() => import('./surfaces/text.js'));

export const SURFACES = ['web', 'email', 'tui', 'native', 'text'] as const;
export type Surface = (typeof SURFACES)[number];
export const DEFAULT_SURFACE: Surface = 'web';

const LABELS: Record<Surface, string> = {
  web: 'Web',
  email: 'Email',
  tui: 'TUI',
  native: 'Native',
  text: 'Text',
};

export function SurfacePreview({ doc, surface }: { doc: PortableDoc; surface: Surface }) {
  return (
    <RenderBoundary key={surface}>
      <Suspense fallback={<LoadingPlaceholder />}>
        {surface === 'web' && <WebSurface doc={doc} />}
        {surface === 'email' && <LazyEmail doc={doc} />}
        {surface === 'tui' && <LazyTui doc={doc} />}
        {surface === 'native' && <NativeSurface doc={doc} />}
        {surface === 'text' && <LazyText doc={doc} />}
      </Suspense>
    </RenderBoundary>
  );
}

function LoadingPlaceholder() {
  return (
    <div data-testid="preview-loading" style={preStyle}>
      Loading preview…
    </div>
  );
}

/** Tiny boundary — a render error in one tab shouldn't crash the whole app. */
class RenderBoundary extends Component<
  { children: ReactNode },
  { err: string | null }
> {
  state = { err: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { err: err instanceof Error ? err.message : String(err) };
  }
  render() {
    if (this.state.err) {
      return (
        <pre data-testid="preview-error" style={preStyle}>
          render error: {this.state.err}
        </pre>
      );
    }
    return this.props.children;
  }
}

function WebSurface({ doc }: { doc: PortableDoc }) {
  const html = renderHtml(composeDocument(doc));
  return (
    <div
      data-testid="preview-web"
      style={webFrameStyle}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function NativeSurface({ doc }: { doc: PortableDoc }) {
  const tree = composeDocument(doc);
  return (
    <pre data-testid="preview-native" style={preStyle}>
      {JSON.stringify(tree, null, 2)}
    </pre>
  );
}

export function SurfaceTabs({
  active,
  onChange,
}: {
  active: Surface;
  onChange: (s: Surface) => void;
}) {
  return (
    <div style={tabBarStyle} role="tablist" aria-label="Preview surface" data-testid="surface-tabs">
      {SURFACES.map((s) => {
        const isActive = s === active;
        return (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(s)}
            data-surface={s}
            data-testid={`surface-tab-${s}`}
            style={isActive ? tabActiveStyle : tabStyle}
          >
            {LABELS[s]}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// styles
// ---------------------------------------------------------------------------

const tabBarStyle: CSSProperties = {
  display: 'flex',
  gap: '0.25rem',
  margin: '1.25rem 0 0.5rem',
  borderBottom: '1px solid #e5e7eb',
};

const tabStyle: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: '0.9rem',
  padding: '0.5rem 0.9rem',
  border: 'none',
  borderBottom: '2px solid transparent',
  background: 'transparent',
  color: '#4b5563',
  cursor: 'pointer',
  marginBottom: '-1px',
};

const tabActiveStyle: CSSProperties = {
  ...tabStyle,
  color: '#1f2937',
  borderBottom: '2px solid #3b5b8c',
  fontWeight: 600,
};

const webFrameStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  overflow: 'auto',
  maxHeight: 600,
};

export const preStyle: CSSProperties = {
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  fontSize: '0.82rem',
  lineHeight: 1.45,
  padding: '0.75rem',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  background: '#fafafa',
  color: '#111827',
  overflow: 'auto',
  maxHeight: 600,
  whiteSpace: 'pre',
};
