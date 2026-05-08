/**
 * JSON preview — pretty-printed raw `PortableDoc` + Copy button.
 */
import { useMemo, useState } from 'react';
import type { PortableDoc } from '@portable-doc/core';

export function JsonPreview({ doc }: { doc: PortableDoc }) {
  const text = useMemo(() => JSON.stringify(doc, null, 2), [doc]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="preview-pane" data-testid="preview-json">
      <button
        onClick={() => {
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            void navigator.clipboard.writeText(text);
          }
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        style={{ marginBottom: 8 }}
      >
        {copied ? 'Copied!' : 'Copy JSON'}
      </button>
      <pre className="preview-pre">{text}</pre>
    </div>
  );
}
