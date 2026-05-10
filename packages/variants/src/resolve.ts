/**
 * resolveVariant — pure, deterministic axes → PdStyle.
 *
 * Validates the supplied axes object against the block's `VariantSchema`:
 *   - block type with no schema      → UnknownBlockTypeError
 *   - axis name not in schema.axes   → UnknownVariantError (axis)
 *   - value not in axis allow-list   → UnknownVariantError (value)
 *   - missing axis required by schema→ UnknownVariantError (missing)
 *
 * Determinism: no Date, no Math.random, no environment reads. The same input
 * returns deepEqual outputs across calls.
 */
import type { BlockType } from '@portable-doc/core';
import type { PdStyle } from '@portable-doc/primitives';
import { VARIANT_CATALOG } from './catalog.js';
import type { VariantAxis, VariantValue } from './schema.js';
import { UnknownBlockTypeError, UnknownVariantError } from './schema.js';

export function resolveVariant<B extends BlockType>(
  blockType: B,
  axes: Record<VariantAxis, VariantValue>,
): PdStyle {
  const schema = VARIANT_CATALOG[blockType];
  if (schema === undefined) {
    throw new UnknownBlockTypeError(blockType);
  }

  // Reject unknown axis names supplied by the caller.
  for (const axisName of Object.keys(axes)) {
    if (!Object.prototype.hasOwnProperty.call(schema.axes, axisName)) {
      throw new UnknownVariantError(
        `Unknown axis "${axisName}" for block type "${blockType}".`,
        blockType,
        axisName,
      );
    }
  }

  // Validate every axis the schema requires is supplied with an allowed value.
  // Policy: missing axis throws UnknownVariantError (the schema is closed —
  // every axis is required for a deterministic resolve).
  for (const axisName of Object.keys(schema.axes)) {
    const value = axes[axisName];
    if (value === undefined) {
      throw new UnknownVariantError(
        `Missing axis "${axisName}" for block type "${blockType}".`,
        blockType,
        axisName,
      );
    }
    const allowed = schema.axes[axisName];
    if (allowed === undefined || !allowed.includes(value)) {
      throw new UnknownVariantError(
        `Invalid value "${value}" for axis "${axisName}" on block type "${blockType}".`,
        blockType,
        axisName,
        value,
      );
    }
  }

  return schema.resolve(axes);
}
