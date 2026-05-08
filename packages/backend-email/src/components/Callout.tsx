/**
 * Callout — tone-coloured side-bordered block.
 *
 * Uses `tonePalette` from `@portable-doc/core` directly: `tone.bg` for the
 * fill, `tone.fg` for the left border + heading colour. Wraps the callout in
 * a Section (which renders a `role="presentation"` table) and tags it with
 * `className="pd-card"` so the dark-mode override in <Head> can override it.
 */

import { tonePalette } from '@portable-doc/core';
import type { PdCalloutNode, PdNode } from '@portable-doc/primitives';
import { Section, Text } from '@react-email/components';
import type { ReactNode } from 'react';

export function EmailCallout({
  node,
  walk,
}: {
  node: PdCalloutNode;
  walk: (n: PdNode, key?: number) => ReactNode;
}) {
  const pal = tonePalette[node.tone];
  return (
    <Section
      className="pd-card"
      style={{
        borderLeft: `4px solid ${pal.fg}`,
        backgroundColor: pal.bg,
        padding: 16,
        margin: '12px 0',
      }}
    >
      {node.title ? (
        <Text style={{ color: pal.fg, fontWeight: 'bold', margin: 0 }}>
          {node.title}
        </Text>
      ) : null}
      {node.children.map((c, i) => walk(c, i))}
    </Section>
  );
}
