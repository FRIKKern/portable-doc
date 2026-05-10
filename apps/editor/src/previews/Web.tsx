/**
 * Web preview — `<PdRender>` from `@portable-doc/backend-web/rnw`.
 * Lazy-loaded by the parent (RNW is heavy, ~3MB). This module is the
 * dynamic-import target.
 *
 * When the MCP server is reachable, the preview routes through
 * `doc_render({surface:'web'})` and mounts the returned HTML in an iframe.
 * Otherwise it falls back to the in-app RNW `<PdRender>` path. Mid-session
 * MCP failure falls back to PdRender silently with a console warning.
 */
import { useEffect, useMemo, useState } from 'react';
import { composeDocument } from '@portable-doc/primitives';
import { PdRender } from '@portable-doc/backend-web/rnw';
import type { PortableDoc } from '@portable-doc/core';
import { renderViaMcp } from '../lib/mcp-client.js';
import { useMcp } from '../McpProvider.js';

export default function WebPreview({ doc }: { doc: PortableDoc }) {
  const { reachable } = useMcp();
  const tree = useMemo(() => composeDocument(doc), [doc]);
  const [mcpHtml, setMcpHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (reachable === true) {
      renderViaMcp(doc, 'web')
        .then((html) => {
          if (!cancelled) setMcpHtml(html);
        })
        .catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('MCP render fallback for web:', err);
          if (!cancelled) setMcpHtml(null); // → PdRender direct path.
        });
    } else {
      setMcpHtml(null);
    }
    return () => {
      cancelled = true;
    };
  }, [doc, reachable]);

  return (
    <div className="preview-pane" data-testid="preview-web">
      {mcpHtml !== null ? (
        <iframe className="preview-iframe" srcDoc={mcpHtml} title="web-preview" />
      ) : (
        <PdRender tree={tree} />
      )}
    </div>
  );
}
