/**
 * TUI surface — lazy entry. Pulls in `@portable-doc/backend-ink` along with
 * its `cli-highlight` + `highlight.js` deps (~300 KB gzip — the heaviest of
 * the five surfaces). ANSI escapes from `renderInk` are translated to inline-
 * styled `<span>` markup by the hand-rolled `ansiToHtml` parser; the result
 * mounts via `dangerouslySetInnerHTML` inside a `<pre>`.
 *
 * Per grill q6: NO `ansi_up` dep. The parser lives in `../lib/ansi-to-html`.
 */
import type { CSSProperties } from 'react';
import { composeDocument } from '@portable-doc/primitives';
import { renderInk } from '@portable-doc/backend-ink';
import type { PortableDoc } from '@portable-doc/core';
import { ansiToHtml } from '../lib/ansi-to-html.js';

export default function TuiSurface({ doc }: { doc: PortableDoc }) {
  const ansi = renderInk(composeDocument(doc), { colorDepth: 'truecolor' });
  const html = ansiToHtml(ansi);
  return (
    <pre
      data-testid="preview-tui"
      style={tuiStyle}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const tuiStyle: CSSProperties = {
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  fontSize: '0.85rem',
  lineHeight: 1.45,
  padding: '0.75rem',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  background: '#0b1020',
  color: '#e5e7eb',
  overflow: 'auto',
  maxHeight: 600,
  whiteSpace: 'pre',
};
