import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { validateDoc, type PortableDoc, type ValidationIssue } from '@portable-doc/core';
import welcomeJson from '../../../examples/welcome.json';
import incidentJson from '../../../examples/incident.json';
import {
  SurfacePreview,
  SurfaceTabs,
  DEFAULT_SURFACE,
  type Surface,
} from './SurfacePreview.js';

/**
 * Public-playground app.
 *
 * Kernel-direct: imports `validateDoc` from `@portable-doc/core` and renders
 * directly through the backend packages — no MCP, no network, no local-server
 * dependency. B1 shipped JSON paste box + 300 ms-debounced live validation +
 * fixture loaders. B2 layers the 5-surface render layout below: Web → Email →
 * TUI → Native → Text. Email + Ink are lazy-loaded per tab to keep the
 * initial bundle under ~70 KB gzip.
 */

const FIXTURES = {
  welcome: welcomeJson as unknown as PortableDoc,
  incident: incidentJson as unknown as PortableDoc,
};

type Validation =
  | { kind: 'ok' }
  | { kind: 'parse-error'; message: string }
  | { kind: 'issues'; issues: ValidationIssue[] };

const DEBOUNCE_MS = 300;

export default function App() {
  const [draft, setDraft] = useState<string>(() =>
    JSON.stringify(FIXTURES.welcome, null, 2),
  );
  const [validation, setValidation] = useState<Validation>(() => {
    const issues = validateDoc(FIXTURES.welcome);
    return issues.length === 0 ? { kind: 'ok' } : { kind: 'issues', issues };
  });
  const [surface, setSurface] = useState<Surface>(DEFAULT_SURFACE);

  useEffect(() => {
    const t = setTimeout(() => {
      setValidation(runValidation(draft));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft]);

  // The doc reference used by SurfacePreview is recomputed only when the
  // validation result flips to 'ok' (or 'issues' — both yield a parsed doc).
  // On 'parse-error' we hold the previous doc so the preview doesn't flicker
  // mid-edit. New doc id only when parse succeeds.
  const previewDoc = useMemo<PortableDoc | null>(() => {
    try {
      return JSON.parse(draft) as PortableDoc;
    } catch {
      return null;
    }
  }, [draft]);

  function loadFixture(name: keyof typeof FIXTURES): void {
    setDraft(JSON.stringify(FIXTURES[name], null, 2));
  }

  return (
    <main style={mainStyle}>
      <header style={headerStyle}>
        <p style={kickerStyle}>Public playground · portable-doc</p>
        <h1 style={titleStyle}>PortableDoc Playground</h1>
        <p style={subtitleStyle}>
          Paste a PortableDoc JSON, see it validated live, then preview it
          across Web, Email, TUI, Native, and Text — all rendered by the same
          kernel.
        </p>
      </header>

      <div style={fixtureBarStyle} data-testid="fixture-bar">
        <span style={fixtureLabelStyle}>Load fixture:</span>
        <button
          type="button"
          onClick={() => loadFixture('welcome')}
          style={buttonStyle}
          data-testid="fixture-welcome"
        >
          Welcome
        </button>
        <button
          type="button"
          onClick={() => loadFixture('incident')}
          style={buttonStyle}
          data-testid="fixture-incident"
        >
          Incident
        </button>
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        style={textareaStyle}
        spellCheck={false}
        aria-label="PortableDoc JSON document"
        data-testid="json-input"
      />

      <ValidationDisplay validation={validation} />

      <SurfaceTabs active={surface} onChange={setSurface} />
      {previewDoc ? (
        <SurfacePreview doc={previewDoc} surface={surface} />
      ) : (
        <div style={previewPlaceholderStyle} data-testid="preview-placeholder">
          Fix the JSON above to see surface previews.
        </div>
      )}
    </main>
  );
}

function runValidation(draft: string): Validation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(draft);
  } catch (e) {
    return {
      kind: 'parse-error',
      message: e instanceof Error ? e.message : String(e),
    };
  }
  const issues = validateDoc(parsed);
  if (issues.length === 0) return { kind: 'ok' };
  return { kind: 'issues', issues };
}

function ValidationDisplay({ validation }: { validation: Validation }) {
  if (validation.kind === 'ok') {
    return (
      <div style={okStyle} data-testid="validation-ok">
        <span style={badgeStyle}>✓ valid</span>
        <span>0 issues — document conforms to all kernel rules.</span>
      </div>
    );
  }
  if (validation.kind === 'parse-error') {
    return (
      <div style={errorStyle} data-testid="validation-parse-error">
        <strong>Parse error:</strong> <code>{validation.message}</code>
      </div>
    );
  }
  return (
    <div style={errorStyle} data-testid="validation-issues">
      <strong>
        {validation.issues.length} validation issue
        {validation.issues.length === 1 ? '' : 's'}:
      </strong>
      <ul style={issueListStyle}>
        {validation.issues.map((issue, i) => (
          <li key={i} data-testid="validation-issue">
            <code style={ruleStyle}>{issue.rule}</code>
            {issue.blockId ? (
              <>
                {' '}
                · block <code>{issue.blockId}</code>
              </>
            ) : null}
            {' — '}
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// styles — inline objects to keep the playground dependency-free
// ---------------------------------------------------------------------------

const mainStyle: CSSProperties = {
  fontFamily: 'system-ui, -apple-system, sans-serif',
  maxWidth: 960,
  margin: '2rem auto',
  padding: '0 1.5rem 3rem',
  color: '#1f2937',
};

const headerStyle: CSSProperties = {
  marginBottom: '1.5rem',
};

const kickerStyle: CSSProperties = {
  fontSize: '0.78rem',
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: '#3b5b8c',
  fontWeight: 600,
  margin: 0,
};

const titleStyle: CSSProperties = {
  fontSize: '2.2rem',
  letterSpacing: '-0.022em',
  margin: '0.25rem 0 0.5rem',
};

const subtitleStyle: CSSProperties = {
  fontSize: '1.05rem',
  color: '#4b5563',
  lineHeight: 1.55,
  margin: 0,
};

const fixtureBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  margin: '1rem 0 0.75rem',
};

const fixtureLabelStyle: CSSProperties = {
  fontSize: '0.85rem',
  color: '#6b7280',
  marginRight: '0.25rem',
};

const buttonStyle: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: '0.9rem',
  padding: '0.4rem 0.85rem',
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#1f2937',
  borderRadius: 6,
  cursor: 'pointer',
};

const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: 360,
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  fontSize: '0.85rem',
  lineHeight: 1.5,
  padding: '0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fafafa',
  color: '#111827',
  boxSizing: 'border-box',
  resize: 'vertical',
};

const okStyle: CSSProperties = {
  marginTop: '0.75rem',
  padding: '0.75rem 1rem',
  background: '#ecfdf5',
  border: '1px solid #a7f3d0',
  borderRadius: 6,
  color: '#065f46',
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
};

const badgeStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: '0.85rem',
  padding: '0.15rem 0.5rem',
  background: '#10b981',
  color: '#fff',
  borderRadius: 4,
};

const errorStyle: CSSProperties = {
  marginTop: '0.75rem',
  padding: '0.75rem 1rem',
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 6,
  color: '#991b1b',
};

const issueListStyle: CSSProperties = {
  margin: '0.5rem 0 0',
  paddingLeft: '1.2rem',
  lineHeight: 1.55,
};

const ruleStyle: CSSProperties = {
  background: '#fee2e2',
  padding: '0.05rem 0.35rem',
  borderRadius: 4,
  fontSize: '0.85rem',
};

const previewPlaceholderStyle: CSSProperties = {
  marginTop: '0.5rem',
  padding: '2rem 1rem',
  border: '1px dashed #d1d5db',
  borderRadius: 6,
  textAlign: 'center',
  color: '#6b7280',
  fontSize: '0.9rem',
};
