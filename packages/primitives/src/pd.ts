/**
 * Pd* — paperflow-owned primitive layer.
 *
 * NOT JSX. NOT React components. NOT a re-export of React Native (per spec §6 /
 * grill Q1). Pd* is a discriminated-union data tree that the kernel emits and
 * backends consume. Prop names mirror RN's primitive surface so that Web + Native
 * backends translate trivially, but the values are plain TS data.
 *
 * `PdStyle` deliberately omits anything outside the intersection-safe allowlist
 * (radius, shadow, opacity, transform, gradient, animation, flex, flexWrap,
 * justifyContent space-between, alignSelf). The validator gates inputs; the
 * type itself gates the Pd-tree.
 */
import type { Tone } from '@portable-doc/core';

export type PdAlign = 'top' | 'middle' | 'bottom';
export type PdFlexDir = 'row' | 'column';
export type PdBorderStyle = 'single' | 'double' | 'bold';

export interface PdStyle {
  flexDirection?: PdFlexDir;
  width?: number;
  padding?: number;
  margin?: number;
  borderWidth?: number;
  borderColor?: string;
  borderStyle?: PdBorderStyle;
  backgroundColor?: string;
  verticalAlign?: PdAlign;
}

export interface PdBoxNode {
  kind: 'PdBox';
  style?: PdStyle;
  children: PdNode[];
}

export interface PdTextNode {
  kind: 'PdText';
  weight?: 'normal' | 'bold';
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  children: Array<PdTextNode | PdLinkNode | PdInlineCodeNode | string>;
}

export interface PdLinkNode {
  kind: 'PdLink';
  href: string;
  children: Array<PdTextNode | string>;
}

export interface PdInlineCodeNode {
  kind: 'PdInlineCode';
  value: string;
}

export interface PdButtonNode {
  kind: 'PdButton';
  href: string;
  label: string;
  priority: 'primary' | 'secondary';
}

export interface PdHrNode {
  kind: 'PdHr';
  thickness?: 1 | 2;
}

export interface PdContainerNode {
  kind: 'PdContainer';
  maxWidth?: number;
  children: PdNode[];
}

export interface PdImageNode {
  kind: 'PdImage';
  src: string;
  alt: string;
  width?: number;
  height?: number;
  surfaces: ['web', 'native'];
}

export interface PdTableNode {
  kind: 'PdTable';
  rows: PdNode[][][];
  surfaces: ['web', 'native'];
}

export interface PdCalloutNode {
  kind: 'PdCallout';
  tone: Tone;
  title?: string;
  children: PdNode[];
}

export type PdNode =
  | PdBoxNode
  | PdTextNode
  | PdLinkNode
  | PdInlineCodeNode
  | PdButtonNode
  | PdHrNode
  | PdContainerNode
  | PdImageNode
  | PdTableNode
  | PdCalloutNode;
