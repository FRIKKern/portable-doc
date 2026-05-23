/**
 * @portable-doc/core — public API.
 *
 * AST types, default tokens, the block × surface contract matrix, and the
 * validator that gates everything downstream. Side-effect free.
 */

export type {
  Surface,
  SurfaceSupport,
  Tone,
  BorderStyle,
  BlockType,
  InlineNode,
  BlockBase,
  HeadingBlock,
  ParagraphBlock,
  ListBlock,
  CalloutBlock,
  ActionBlock,
  SectionBlock,
  DividerBlock,
  CodeBlock,
  ImageBlock,
  TableBlock,
  Block,
  PortableDoc,
} from './ast.js';

export {
  defaultTokens,
  tonePalette,
  toneNames,
} from './tokens.js';

export type {
  TonePalette,
  TonePaletteEntry,
  TuiColorName,
  ToneName,
  ColorTokens,
  SpaceTokens,
  TypographyTokens,
  DefaultTokens,
} from './tokens.js';

export { blockContracts, isSupported } from './contracts.js';
export type { BlockContracts } from './contracts.js';

export { validateDoc, validateBlock } from './validate.js';
export type { ValidationIssue, RuleId, ValidateMode, ValidateOptions } from './validate.js';

export { portableDocSchema, blockSchema, draftBlockSchema, inlineNodeSchema } from './schemas.js';

export {
  ENVELOPE_VERSION,
  envelopeSchema,
  buildEnvelope,
  generateDocUuid,
} from './roundtrip/envelope-schema.js';
export type { Envelope } from './roundtrip/envelope-schema.js';
