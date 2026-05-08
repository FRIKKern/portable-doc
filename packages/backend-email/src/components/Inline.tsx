/**
 * Inline walker — turns the inline children of a PdText/PdLink into JSX spans.
 * Plain strings flow through React's auto-escaping; nested text-marks become
 * styled `<span>`s. Inline `PdInlineCode` becomes a styled `<code>`.
 */

import type {
  PdInlineCodeNode,
  PdLinkNode,
  PdTextNode,
} from '@portable-doc/primitives';
import type { CSSProperties, ReactNode } from 'react';
import { safeUrl } from '../escape.js';

const FONT_MONO = "ui-monospace,Menlo,monospace";

export function inlineFromText(n: PdTextNode): ReactNode {
  return n.children.map((child, i) => {
    if (typeof child === 'string') return child;
    if (child.kind === 'PdInlineCode') return renderInlineCode(child, i);
    if (child.kind === 'PdLink') return renderInlineLink(child, i);
    return renderInlineText(child, i);
  });
}

export function textStyle(n: PdTextNode): CSSProperties {
  const out: CSSProperties = {};
  if (n.weight === 'bold') out.fontWeight = 'bold';
  if (n.italic) out.fontStyle = 'italic';
  const deco: string[] = [];
  if (n.underline) deco.push('underline');
  if (n.strike) deco.push('line-through');
  if (deco.length > 0) out.textDecoration = deco.join(' ');
  if (n.color) out.color = n.color;
  return out;
}

function renderInlineText(n: PdTextNode, key: number): ReactNode {
  return (
    <span key={key} style={textStyle(n)}>
      {inlineFromText(n)}
    </span>
  );
}

function renderInlineLink(n: PdLinkNode, key: number): ReactNode {
  // Link children are PdTextNode | string only.
  const inner = n.children.map((c, i) => {
    if (typeof c === 'string') return c;
    return renderInlineText(c, i);
  });
  return (
    <a
      key={key}
      href={safeUrl(n.href)}
      style={{ color: '#1d4ed8', textDecoration: 'underline' }}
    >
      {inner}
    </a>
  );
}

function renderInlineCode(n: PdInlineCodeNode, key: number): ReactNode {
  return (
    <code
      key={key}
      style={{
        background: '#f3f4f6',
        padding: '2px 6px',
        fontFamily: FONT_MONO,
        fontSize: '0.95em',
      }}
    >
      {n.value}
    </code>
  );
}
