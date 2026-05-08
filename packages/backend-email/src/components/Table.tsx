/**
 * Email table — emits a real `<table role="presentation">` for layout-as-data.
 *
 * RE doesn't ship a Table primitive (Section uses internal tables but the
 * shape doesn't fit a true grid). We emit the table directly. role="presentation"
 * is the a11y must-have so screen readers announce content, not row/col coords.
 */

import type { PdNode, PdTableNode } from '@portable-doc/primitives';
import type { ReactNode } from 'react';

const RULE = '#e5e7eb';

export function EmailTable({
  node,
  walk,
}: {
  node: PdTableNode;
  walk: (n: PdNode, key?: number) => ReactNode;
}) {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      style={{ borderCollapse: 'collapse', width: '100%', margin: '12px 0' }}
    >
      <tbody>
        {node.rows.map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => (
              <td
                key={ci}
                style={{
                  border: `1px solid ${RULE}`,
                  padding: '8px 12px',
                  verticalAlign: 'top',
                }}
              >
                {cell.map((c, i) => walk(c, i))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
