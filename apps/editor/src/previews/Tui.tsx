/**
 * TUI preview — `renderInk(composeDocument(doc))` displayed in <pre>.
 * Default tab per spec §11. ANSI escapes + OSC-8 hyperlinks are stripped
 * so the raw box-drawing chars remain readable in the browser.
 */
import { useMemo } from 'react';
import { composeDocument } from '@portable-doc/primitives';
import { renderInk } from '@portable-doc/backend-ink';
import type { PortableDoc } from '@portable-doc/core';

const ANSI_CSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const OSC8 = /\x1b\]8;[^\x07]*\x07/g;

function stripAnsi(s: string): string {
  return s.replace(OSC8, '').replace(ANSI_CSI, '');
}

export function TuiPreview({ doc }: { doc: PortableDoc }) {
  const text = useMemo(() => {
    try {
      const ansi = renderInk(composeDocument(doc), { colorDepth: 'mono' });
      return stripAnsi(ansi);
    } catch (err) {
      return `// render error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }, [doc]);
  return (
    <div className="preview-pane" data-testid="preview-tui">
      <pre className="preview-pre">{text}</pre>
    </div>
  );
}
