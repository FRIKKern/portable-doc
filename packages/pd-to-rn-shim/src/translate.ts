/**
 * Pd → RN-shaped data translation.
 *
 * Pure: takes a `PdNode`, returns an `RnNode`. No React, no `react-native`
 * import — the shim is the translation seam (Note 3 §6 / grill Q1) between the
 * paperflow-owned Pd-tree and the RN primitive prop surface.
 */

import { defaultTokens as T } from '@portable-doc/core';
import type {
  PdInlineCodeNode, PdLinkNode, PdNode, PdStyle, PdTextNode,
} from '@portable-doc/primitives';
import type { RnNode, RnStyle, RnText, RnTextStyle, RnView } from './shape.js';

const BSTYLE = { single: 'solid', double: 'dashed', bold: 'solid' } as const;
const VALIGN = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const;

export function toRn(n: PdNode): RnNode {
  switch (n.kind) {
    case 'PdBox': return view(mapStyle(n.style), n.children.map(toRn));
    case 'PdText': return textNode(n);
    case 'PdLink': return {
      component: 'Pressable', href: n.href, accessibilityRole: 'link',
      children: [{ component: 'Text', style: { textDecorationLine: 'underline' },
        children: n.children.map(textChild) }],
    };
    case 'PdInlineCode': return {
      component: 'Text',
      style: { fontFamily: T.typography.mono, backgroundColor: T.color.codeBg },
      children: [n.value],
    };
    case 'PdButton': {
      const p = n.priority === 'primary';
      return {
        component: 'Pressable', href: n.href, accessibilityRole: 'button',
        children: [view(
          { padding: T.space.sm, alignItems: 'center',
            ...(p ? { backgroundColor: T.color.brand }
                  : { borderWidth: 1, borderColor: T.color.border, borderStyle: 'solid' }) },
          [{ component: 'Text',
             style: p ? { fontWeight: 'bold', color: T.color.brandText } : { color: T.color.text },
             children: [n.label] }],
        )],
      };
    }
    case 'PdHr': return view(
      { height: n.thickness ?? 1, backgroundColor: T.color.border, margin: T.space.sm }, [],
    );
    case 'PdContainer': return view(
      { width: n.maxWidth ?? 600, alignItems: 'center', padding: T.space.md },
      n.children.map(toRn),
    );
    case 'PdImage': {
      const style: RnStyle = {};
      if (n.width !== undefined) style.width = n.width;
      if (n.height !== undefined) style.height = n.height;
      return {
        component: 'Image', source: { uri: n.src }, accessibilityLabel: n.alt,
        ...(Object.keys(style).length ? { style } : {}),
      };
    }
    case 'PdTable': return view({ flexDirection: 'column' }, n.rows.map((row) =>
      view({ flexDirection: 'row' }, row.map((cell) =>
        view({ padding: T.space.xs }, cell.map(toRn))))));
    case 'PdCallout': {
      const pal = T.color.tone[n.tone];
      const kids: RnNode[] = [];
      if (n.title) kids.push({ component: 'Text',
        style: { fontWeight: 'bold', color: pal.fg }, children: [n.title] });
      for (const c of n.children) kids.push(toRn(c));
      return view(
        { borderLeftWidth: 4, borderColor: pal.fg, backgroundColor: pal.bg, padding: T.space.md },
        kids,
      );
    }
    default: { const _x: never = n; throw new Error(`toRn: unhandled ${(_x as { kind: string }).kind}`); }
  }
}

function view(style: RnStyle | undefined, children: RnNode[]): RnView {
  return { component: 'View', ...(style && Object.keys(style).length ? { style } : {}), children };
}

function textNode(n: PdTextNode): RnText {
  const s: RnTextStyle = {};
  if (n.weight) s.fontWeight = n.weight;
  if (n.italic) s.fontStyle = 'italic';
  const u = n.underline, k = n.strike;
  if (u && k) s.textDecorationLine = 'underline line-through';
  else if (u) s.textDecorationLine = 'underline';
  else if (k) s.textDecorationLine = 'line-through';
  if (n.color) s.color = n.color;
  return {
    component: 'Text', ...(Object.keys(s).length ? { style: s } : {}),
    children: n.children.map(textChild),
  };
}

function textChild(c: PdTextNode | PdLinkNode | PdInlineCodeNode | string): RnNode | string {
  return typeof c === 'string' ? c : toRn(c);
}

function mapStyle(p?: PdStyle): RnStyle | undefined {
  if (!p) return undefined;
  const o: RnStyle = {};
  if (p.flexDirection) o.flexDirection = p.flexDirection;
  if (p.width !== undefined) o.width = p.width;
  if (p.padding !== undefined) o.padding = p.padding;
  if (p.margin !== undefined) o.margin = p.margin;
  if (p.borderColor) o.borderColor = p.borderColor;
  if (p.backgroundColor) o.backgroundColor = p.backgroundColor;
  if (p.borderStyle) {
    o.borderStyle = BSTYLE[p.borderStyle];
    o.borderWidth = p.borderWidth ?? (p.borderStyle === 'bold' ? 2 : 1);
  } else if (p.borderWidth !== undefined) o.borderWidth = p.borderWidth;
  if (p.verticalAlign) o.alignItems = VALIGN[p.verticalAlign];
  return Object.keys(o).length ? o : undefined;
}
