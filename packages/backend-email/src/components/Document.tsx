/**
 * Top-level email document.
 *
 * Layout:
 *   <Html>
 *     <DarkModeHead />              ← color-scheme meta + dark CSS
 *     <Body className="pd-bg">
 *       {preheader hidden div}      ← gmail-style preview text
 *       <Container width=600>
 *         ... walked children ...
 *       </Container>
 *     </Body>
 *   </Html>
 *
 * `Container` from RE renders an outer table with `width="100%"` and an
 * inline `max-width:37.5em` (~600px). To satisfy the explicit-width contract
 * (and improve Outlook 2010+ rendering), we wrap the container in a
 * fixed-width outer table so `width="600"` appears in the markup.
 */

import type { PdContainerNode, PdNode } from '@portable-doc/primitives';
import { Body, Container, Html } from '@react-email/components';
import { walk } from './Block.js';
import { DarkModeHead } from './DarkMode.js';

const FONT_BODY =
  "-apple-system,'SF Pro Text',system-ui,sans-serif";
const PAGE_BG = '#f9fafb';
const SURFACE = '#ffffff';
const TEXT = '#111827';

export interface DocumentProps {
  root: PdNode;
  preheader?: string;
  containerWidth?: number;
}

export function EmailDocument({
  root,
  preheader,
  containerWidth = 600,
}: DocumentProps) {
  const width =
    root.kind === 'PdContainer'
      ? Math.min((root as PdContainerNode).maxWidth ?? containerWidth, containerWidth)
      : containerWidth;

  const bodyChildren =
    root.kind === 'PdContainer'
      ? (root as PdContainerNode).children.map((c, i) => walk(c, i))
      : [walk(root)];

  return (
    <Html lang="en">
      <DarkModeHead />
      <Body
        className="pd-bg"
        style={{
          background: PAGE_BG,
          color: TEXT,
          margin: 0,
          padding: 0,
          fontFamily: FONT_BODY,
        }}
      >
        {preheader ? (
          <div
            style={{
              display: 'none',
              maxHeight: 0,
              overflow: 'hidden',
              opacity: 0,
              color: 'transparent',
            }}
          >
            {preheader}
          </div>
        ) : null}
        {/* Outer width-locked table — gives the markup an explicit width="600"
            attribute that Outlook honours (Container's max-width:37.5em is
            CSS-only and Outlook ignores it for layout). */}
        <table
          role="presentation"
          align="center"
          width={width}
          cellPadding={0}
          cellSpacing={0}
          border={0}
          style={{ width, maxWidth: '100%', margin: '0 auto' }}
        >
          <tbody>
            <tr>
              <td>
                <Container
                  style={{
                    width,
                    maxWidth: '100%',
                    background: SURFACE,
                    padding: 24,
                  }}
                >
                  {bodyChildren}
                </Container>
              </td>
            </tr>
          </tbody>
        </table>
      </Body>
    </Html>
  );
}
