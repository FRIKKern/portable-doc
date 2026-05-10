/**
 * `useRenderedContent` — bridges direct backends and MCP `doc_render`.
 *
 * - reachable === true  → call `renderViaMcp`; on throw, fall back silently
 *                         to `directRender()` for THIS call (no banner toggle).
 * - reachable !== true  → direct render path.
 *
 * Returned value is a string (HTML / ANSI / JSON depending on the surface).
 * For the editor's `json` surface (no MCP equivalent) callers should not
 * use this hook — render the JSON directly in-app.
 */
import { useEffect, useState } from 'react';
import type { PortableDoc } from '@portable-doc/core';
import { renderViaMcp, type McpSurface } from './mcp-client.js';
import { useMcp } from '../McpProvider.js';

export function useRenderedContent(
  doc: PortableDoc,
  surface: McpSurface,
  directRender: () => string,
): string {
  const { reachable } = useMcp();
  const [content, setContent] = useState<string>(() => directRender());

  useEffect(() => {
    let cancelled = false;
    if (reachable === true) {
      renderViaMcp(doc, surface)
        .then((out) => {
          if (!cancelled) setContent(out);
        })
        .catch((err: unknown) => {
          // Mid-session failure — fall back silently for this call only.
          // eslint-disable-next-line no-console
          console.warn(`MCP render fallback for ${surface}:`, err);
          if (!cancelled) setContent(directRender());
        });
    } else {
      setContent(directRender());
    }
    return () => {
      cancelled = true;
    };
    // directRender is recomputed by callers each render; intentional dep on
    // doc/surface/reachable so we re-run when any of those flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, surface, reachable]);

  return content;
}
