/**
 * Per-Pd-kind walker — dispatches each PdNode to the right RE component.
 *
 * Most leaves use RE's primitives (Text, Hr, Img, Section, Row, Column) which
 * already compile down to inline-styled, table-based, email-client-safe HTML.
 * Only the heaviest cases (Button with VML, Table, Callout) get hand-written
 * components in sibling files.
 *
 * `walk(n, key)` is the recursion point. It's threaded into Callout/Table
 * children so they don't re-import the dispatcher and create a circular
 * module graph.
 */

import type {
  PdBoxNode,
  PdContainerNode,
  PdHrNode,
  PdImageNode,
  PdNode,
  PdStyle,
  PdTableNode,
  PdTextNode,
} from '@portable-doc/primitives';
import {
  Column,
  Hr,
  Img,
  Row,
  Section,
  Text,
} from '@react-email/components';
import type { CSSProperties, ReactNode } from 'react';
import { escapeAttr, safeUrl } from '../escape.js';
import { EmailButton } from './Button.js';
import { EmailCallout } from './Callout.js';
import { inlineFromText, textStyle } from './Inline.js';
import { EmailTable } from './Table.js';

export function walk(n: PdNode, key?: number): ReactNode {
  switch (n.kind) {
    case 'PdContainer':
      return renderContainer(n, key);
    case 'PdBox':
      return renderBox(n, key);
    case 'PdText':
      return renderText(n, key);
    case 'PdLink':
      // PdLink at block scope is rare (kernel emits links inside PdText).
      // Wrap in a Text block so it gets a paragraph rhythm.
      return (
        <Text key={key} style={{ margin: '0 0 12px 0' }}>
          {inlineFromText({ kind: 'PdText', children: [n] })}
        </Text>
      );
    case 'PdInlineCode':
      return (
        <Text key={key} style={{ margin: '0 0 12px 0' }}>
          {inlineFromText({ kind: 'PdText', children: [n] })}
        </Text>
      );
    case 'PdButton':
      return (
        <Section key={key} style={{ padding: '8px 0' }}>
          <EmailButton node={n} />
        </Section>
      );
    case 'PdHr':
      return renderHr(n, key);
    case 'PdImage':
      return renderImage(n, key);
    case 'PdTable':
      return renderTable(n, key);
    case 'PdCallout':
      return <EmailCallout key={key} node={n} walk={walk} />;
    default: {
      const _x: never = n;
      throw new Error(
        `backend-email walk: unhandled ${(_x as { kind: string }).kind}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// PdContainer is rendered by Document; this branch is only hit if a
// Container appears as a child of another node (not produced by the kernel,
// but kept for graph completeness).
function renderContainer(n: PdContainerNode, key?: number): ReactNode {
  return (
    <Section key={key}>{n.children.map((c, i) => walk(c, i))}</Section>
  );
}

function renderBox(n: PdBoxNode, key?: number): ReactNode {
  const style = boxStyle(n.style);
  if (n.style?.flexDirection === 'row') {
    // Email-safe row layout — Row + Column emit a `<table>` with `<td>` per
    // child. Each child becomes a column.
    return (
      <Section key={key} style={style}>
        <Row>
          {n.children.map((c, i) => (
            <Column key={i} style={{ verticalAlign: 'top' }}>
              {walk(c, 0)}
            </Column>
          ))}
        </Row>
      </Section>
    );
  }
  return (
    <Section key={key} style={style}>
      {n.children.map((c, i) => walk(c, i))}
    </Section>
  );
}

function boxStyle(s: PdStyle | undefined): CSSProperties {
  if (!s) return {};
  const out: CSSProperties = {};
  if (s.width !== undefined) out.width = s.width;
  if (s.padding !== undefined) out.padding = s.padding;
  if (s.margin !== undefined) out.margin = s.margin;
  if (
    s.borderWidth !== undefined &&
    s.borderColor &&
    s.borderStyle
  ) {
    const bs = s.borderStyle === 'double' ? 'double' : 'solid';
    out.border = `${s.borderWidth}px ${bs} ${s.borderColor}`;
  }
  if (s.backgroundColor) out.backgroundColor = s.backgroundColor;
  if (s.verticalAlign) out.verticalAlign = s.verticalAlign;
  return out;
}

function renderText(n: PdTextNode, key?: number): ReactNode {
  // Block-level text — RE's Text component wraps in <p> with safe defaults.
  return (
    <Text key={key} style={{ margin: '0 0 12px 0', ...textStyle(n) }}>
      {inlineFromText(n)}
    </Text>
  );
}

function renderHr(n: PdHrNode, key?: number): ReactNode {
  const t = n.thickness ?? 1;
  return (
    <Hr
      key={key}
      style={{
        borderTop: `${t}px solid #e5e7eb`,
        borderBottom: 'none',
        margin: '16px 0',
      }}
    />
  );
}

function renderImage(n: PdImageNode, key?: number): ReactNode {
  // RE's <Img> already inline-styles. We pre-validate `src` via safeUrl, and
  // rely on React's auto-escaping for the alt attribute (escapeAttr is used
  // anyway for any future raw-HTML emission).
  const safeSrc = safeUrl(n.src);
  // escapeAttr is called for parity with the web-server backend; React will
  // escape the prop again on emit. Belt + braces.
  const safeAlt = escapeAttr(n.alt);
  return (
    <Img
      key={key}
      src={safeSrc}
      alt={safeAlt}
      width={n.width}
      height={n.height}
      style={{ maxWidth: '100%', height: 'auto' }}
    />
  );
}

function renderTable(n: PdTableNode, key?: number): ReactNode {
  return <EmailTable key={key} node={n} walk={walk} />;
}
