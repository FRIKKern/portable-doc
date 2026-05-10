/**
 * Web preview — `<PdRender>` from `@portable-doc/backend-web/rnw`.
 * Lazy-loaded by the parent (RNW is heavy, ~3MB). This module is the
 * dynamic-import target.
 */
import { useMemo } from 'react';
import { composeDocument } from '@portable-doc/primitives';
import { PdRender } from '@portable-doc/backend-web/rnw';
import type { PortableDoc } from '@portable-doc/core';

export default function WebPreview({ doc }: { doc: PortableDoc }) {
  const tree = useMemo(() => composeDocument(doc), [doc]);
  return (
    <div className="preview-pane" data-testid="preview-web">
      <PdRender tree={tree} />
    </div>
  );
}
