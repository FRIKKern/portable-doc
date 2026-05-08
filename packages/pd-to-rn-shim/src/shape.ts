/**
 * RN-shaped target type — pure data, no React.
 *
 * Mirrors React Native's primitive prop surface (`View / Text / Pressable /
 * Image`) so backends can walk the tree and instantiate real RN components
 * (Native) or `react-native-web` equivalents (web editor) without the shim
 * itself touching React.
 */

export interface RnStyle {
  flexDirection?: 'row' | 'column';
  width?: number;
  height?: number;
  padding?: number;
  margin?: number;
  borderWidth?: number;
  borderLeftWidth?: number;
  borderColor?: string;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  backgroundColor?: string;
  alignItems?: 'flex-start' | 'center' | 'flex-end';
  justifyContent?: 'flex-start' | 'center' | 'flex-end';
}

export interface RnTextStyle extends RnStyle {
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textDecorationLine?: 'none' | 'underline' | 'line-through' | 'underline line-through';
  color?: string;
  fontFamily?: string;
}

export type RnAccessibilityRole = 'button' | 'link' | 'image' | 'header';

export interface RnView {
  component: 'View';
  style?: RnStyle;
  accessibilityRole?: RnAccessibilityRole;
  children: RnNode[];
}

export interface RnText {
  component: 'Text';
  style?: RnTextStyle;
  children: Array<RnNode | string>;
}

export interface RnPressable {
  component: 'Pressable';
  href?: string;
  accessibilityRole?: 'button' | 'link';
  children: RnNode[];
}

export interface RnImage {
  component: 'Image';
  source: { uri: string };
  accessibilityLabel: string;
  style?: RnStyle;
}

export type RnNode = RnView | RnText | RnPressable | RnImage;
