/**
 * Bottom panel — re-runs `validateDoc(doc)` via useMemo on every doc change.
 */
import { useMemo } from 'react';
import { validateDoc } from '@portable-doc/core';
import type { PortableDoc } from '@portable-doc/core';

interface Props {
  doc: PortableDoc;
}

export function ValidationPanel({ doc }: Props) {
  const issues = useMemo(() => validateDoc(doc), [doc]);
  return (
    <div className="validation" data-testid="validation-panel">
      <h2 style={{ fontSize: 11, textTransform: 'uppercase', margin: '0 0 6px', color: '#888' }}>
        Validation
      </h2>
      {issues.length === 0 ? (
        <div className="ok" data-testid="validation-ok">
          ✓ 0 issues
        </div>
      ) : (
        <ul>
          {issues.map((i, idx) => (
            <li key={idx}>
              <strong>{i.rule}</strong>
              {i.blockId ? ` ${i.blockId}` : ''}: {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
