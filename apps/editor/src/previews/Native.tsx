/**
 * Native preview — same content the MCP `doc_render({surface:'native'})`
 * returns: a pretty-printed Pd-tree. We don't actually mount react-native
 * primitives in the browser surface here; the Web tab already proves RNW
 * works. This tab proves the Pd-tree shape the native backend consumes.
 *
 * Routes through MCP when reachable; falls back to in-app `composeDocument`
 * otherwise. Server returns identical pretty-printed JSON.
 */
import { useCallback } from 'react';
import { composeDocument } from '@portable-doc/primitives';
import type { PortableDoc } from '@portable-doc/core';
import { useRenderedContent } from '../lib/use-rendered-content.js';

export function NativePreview({ doc }: { doc: PortableDoc }) {
  const directRender = useCallback(
    () => JSON.stringify(composeDocument(doc), null, 2),
    [doc],
  );
  const text = useRenderedContent(doc, 'native', directRender);
  return (
    <div className="preview-pane" data-testid="preview-native">
      <pre className="preview-pre">{text}</pre>
    </div>
  );
}
