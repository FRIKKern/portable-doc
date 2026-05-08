/**
 * @portable-doc/primitives — public API.
 *
 * Pd* shape (paperflow-owned) + kernel composer.
 */

export type {
  PdAlign,
  PdBorderStyle,
  PdBoxNode,
  PdButtonNode,
  PdCalloutNode,
  PdContainerNode,
  PdFlexDir,
  PdHrNode,
  PdImageNode,
  PdInlineCodeNode,
  PdLinkNode,
  PdNode,
  PdStyle,
  PdTableNode,
  PdTextNode,
} from './pd.js';

export { composeDocument } from './kernel.js';
export type { ComposeOptions } from './kernel.js';
