/**
 * Text surface — lazy entry. Reuses `renderInk` (already in the TUI chunk
 * when both tabs have been visited; cold load on first text-only visit) in
 * `colorDepth: 'mono'` so the output is plain UTF-8 with zero escape bytes.
 */
import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { composeDocument } from '@portable-doc/primitives';
import { renderInk } from '@portable-doc/backend-ink';
import type { PortableDoc } from '@portable-doc/core';

export default function TextSurface({
  doc,
  onValue,
}: {
  doc: PortableDoc;
  onValue?: (v: string) => void;
}) {
  const text = renderInk(composeDocument(doc), {
    colorDepth: 'mono',
    hyperlinks: false,
  });
  useEffect(() => {
    onValue?.(text);
  }, [text, onValue]);
  return (
    <pre data-testid="preview-text" style={preStyle}>
      {text}
    </pre>
  );
}

const preStyle: CSSProperties = {
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
