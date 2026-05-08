/**
 * Email preview — async `renderEmail` returns HTML; we embed via
 * <iframe srcDoc={…}>. Re-runs on every doc change.
 */
import { useEffect, useState } from 'react';
import { composeDocument } from '@portable-doc/primitives';
import { renderEmail } from '@portable-doc/backend-email';
import type { PortableDoc } from '@portable-doc/core';

export function EmailPreview({ doc }: { doc: PortableDoc }) {
  const [html, setHtml] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    renderEmail(composeDocument(doc))
      .then((out) => {
        if (!cancelled) setHtml(out);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [doc]);

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
