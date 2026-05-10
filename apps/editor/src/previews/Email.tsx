/**
 * Email preview — async `renderEmail` returns HTML; we embed via
 * <iframe srcDoc={…}>. Re-runs on every doc change.
 *
 * Routes through MCP `doc_render({surface:'email'})` when the server is
 * reachable; falls back to the direct backend import otherwise. Result
 * shape is identical (HTML string), so the iframe mount stays the same.
 */
import { useEffect, useState } from 'react';
import { composeDocument } from '@portable-doc/primitives';
import { renderEmail } from '@portable-doc/backend-email';
import type { PortableDoc } from '@portable-doc/core';
import { renderViaMcp } from '../lib/mcp-client.js';
import { useMcp } from '../McpProvider.js';

export function EmailPreview({ doc }: { doc: PortableDoc }) {
  const { reachable } = useMcp();
  const [html, setHtml] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);

    const fallbackDirect = () =>
      renderEmail(composeDocument(doc))
        .then((out) => {
          if (!cancelled) setHtml(out);
        })
        .catch((e: unknown) => {
          if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
        });

    if (reachable === true) {
      renderViaMcp(doc, 'email')
        .then((out) => {
          if (!cancelled) setHtml(out);
        })
        .catch((e: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('MCP render fallback for email:', e);
          void fallbackDirect();
        });
    } else {
      void fallbackDirect();
    }

    return () => {
      cancelled = true;
    };
  }, [doc, reachable]);

  return (
    <div className="preview-pane" data-testid="preview-email">
      {err ? (
        <pre className="preview-pre">render error: {err}</pre>
      ) : (
        <iframe className="preview-iframe" srcDoc={html} title="email-preview" />
      )}
    </div>
  );
}
