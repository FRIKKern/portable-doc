/**
 * Native preview — same content the MCP `doc_render({surface:'native'})`
 * returns: a pretty-printed Pd-tree. We don't actually mount react-native
 * primitives in the browser surface here; the Web tab already proves RNW
 * works. This tab proves the Pd-tree shape the native backend consumes.
 */
import { useMemo } from 'react';
import { composeDocument } from '@portable-doc/primitives';
import type { PortableDoc } from '@portable-doc/core';

export function NativePreview({ doc }: { doc: PortableDoc }) {
  const tree = useMemo(() => composeDocument(doc), [doc]);
  return (
    <div className="preview-pane" data-testid="preview-native">
      <pre className="preview-pre">{JSON.stringify(tree, null, 2)}</pre>
    </div>
  );
}
