/**
 * Email surface — lazy entry. Pulls in `@react-email/render` (~70 KB gzip).
 * The MVP playground only mounts this when the user clicks the Email tab.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { composeDocument } from '@portable-doc/primitives';
import { renderEmail } from '@portable-doc/backend-email';
import type { PortableDoc } from '@portable-doc/core';

export default function EmailSurface({
  doc,
  onValue,
}: {
  doc: PortableDoc;
  onValue?: (v: string) => void;
}) {
  const [html, setHtml] = useState<string>('');
  useEffect(() => {
    let cancelled = false;
    renderEmail(composeDocument(doc))
      .then((out) => {
        if (!cancelled) {
          setHtml(out);
          onValue?.(out);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setHtml(
          `<pre>render error: ${e instanceof Error ? e.message : String(e)}</pre>`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [doc, onValue]);

  return (
    <iframe
      data-testid="preview-email"
      srcDoc={html}
      style={iframeStyle}
      title="email-preview"
    />
  );
}

const iframeStyle: CSSProperties = {
  width: '100%',
  height: 600,
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  background: '#fff',
};
