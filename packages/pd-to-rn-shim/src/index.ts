/**
 * @portable-doc/pd-to-rn-shim — public API.
 *
 * Pure-data translation from the paperflow-owned Pd-tree to React Native's
 * primitive prop shape. The shim is the translation seam (Note 3 §6 / grill
 * Q1) — not a runtime renderer. Backends (native + web-editor) walk the
 * returned `RnNode` and instantiate real components.
 */

export { toRn } from './translate.js';
export type {
  RnAccessibilityRole,
  RnImage,
  RnNode,
  RnPressable,
  RnStyle,
  RnText,
  RnTextStyle,
  RnView,
} from './shape.js';
