/**
 * Preview tabs — five buttons; only the active tab's renderer is mounted
 * (runtime-context dispatch + lazy-mount per spec §11).
 *
 * Tab order: TUI → Email → Web → Native → JSON. Default tab is TUI.
 * Web is `React.lazy` so the RNW bundle never enters the cold-start path
 * unless the user clicks the Web tab.
 */
import { Suspense, lazy } from 'react';
import type { PortableDoc } from '@portable-doc/core';
import { TuiPreview } from './previews/Tui.js';
import { EmailPreview } from './previews/Email.js';
import { NativePreview } from './previews/Native.js';
import { JsonPreview } from './previews/Json.js';

const WebPreview = lazy(() => import('./previews/Web.js'));

export const TABS = ['tui', 'email', 'web', 'native', 'json'] as const;
export type TabId = (typeof TABS)[number];
export const DEFAULT_TAB: TabId = 'tui';

const LABELS: Record<TabId, string> = {
  tui: 'TUI',
  email: 'Email',
  web: 'Web',
  native: 'Native',
  json: 'JSON',
};

interface Props {
  doc: PortableDoc;
  active: TabId;
  onChange: (t: TabId) => void;
}

export function PreviewTabs({ doc, active, onChange }: Props) {
  return (
    <div className="col" data-testid="preview-col" style={{ borderRight: 'none' }}>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={active === t}
            data-tab={t}
            data-testid={`tab-${t}`}
            className={active === t ? 'active' : ''}
            onClick={() => onChange(t)}
          >
            {LABELS[t]}
          </button>
        ))}
      </div>
      {/* Inactive tabs are unmounted — only one preview region renders at a time. */}
      {active === 'tui' && <TuiPreview doc={doc} />}
      {active === 'email' && <EmailPreview doc={doc} />}
      {active === 'web' && (
        <Suspense fallback={<div className="lazy-fallback" data-testid="web-lazy-fallback">Loading Web preview…</div>}>
          <WebPreview doc={doc} />
        </Suspense>
      )}
      {active === 'native' && <NativePreview doc={doc} />}
      {active === 'json' && <JsonPreview doc={doc} />}
    </div>
  );
}
