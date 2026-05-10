/**
 * @portable-doc/pd-to-rn-shim — public API.
 *
 * Pure-data translation from the paperflow-owned Pd-tree to React Native's
 * primitive prop shape (the shim itself), plus a tiny React-component
 * re-export `PdRender` for native consumers (Expo / Metro). The web RNW twin
 * lives at `@portable-doc/backend-web/rnw`.
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
export { PdRender } from './PdRender.js';
export type { PdRenderProps } from './PdRender.js';
