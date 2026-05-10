/**
 * Doc-level diagnostics banner (A5).
 *
 * Issues without a `blockId` — typically schema-shape failures — get
 * rendered as a small banner above the tile list. Per grill q5, A5 is
 * BLOCK-LEVEL: per-tile dots cover the common case, and this banner
 * captures the residue that doesn't attach to any one block.
 */
import type { ValidationIssue } from '@portable-doc/core';

interface Props {
  issues: ValidationIssue[];
}

export function DocLevelDiagnostics({ issues }: Props) {
  if (issues.length === 0) return null;
  return (
    <div className="doc-level-diagnostics" role="alert" data-testid="doc-level-diagnostics">
      <strong>Doc-level issues ({issues.length})</strong>
      <ul>
        {issues.map((issue, i) => (
          <li key={i}>
            <code>{issue.rule}</code> — {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
