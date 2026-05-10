/**
 * @portable-doc/variants — public API.
 *
 * Closed, named-variant catalog per block type. Resolves at editor save-time
 * to a paperflow-owned `PdStyle` shape that the existing 5 backends consume.
 */

export { VARIANT_CATALOG } from './catalog.js';
export { resolveVariant } from './resolve.js';
export { UnknownBlockTypeError, UnknownVariantError } from './schema.js';
export type { VariantAxis, VariantSchema, VariantValue } from './schema.js';
