/**
 * Variant-catalog schema types.
 *
 * Closed, named-variant schema per block type. Each block type that supports
 * variants declares an `axes` map (axis name → finite list of allowed values)
 * and a pure `resolve` function that maps a chosen axes object to a paperflow-
 * owned `PdStyle`. The catalog is exhaustive at the type level — unknown axes
 * or values throw `UnknownVariantError` at resolve time.
 */
import type { PdStyle } from '@portable-doc/primitives';

export type VariantAxis = string;
export type VariantValue = string;

export interface VariantSchema {
  axes: Record<VariantAxis, readonly VariantValue[]>;
  resolve: (axes: Record<VariantAxis, VariantValue>) => PdStyle;
}

/** Thrown when `resolveVariant` is called with a block type that has no catalog entry. */
export class UnknownBlockTypeError extends Error {
  readonly blockType: string;

  constructor(blockType: string) {
    super(`No variant catalog for block type "${blockType}".`);
    this.name = 'UnknownBlockTypeError';
    this.blockType = blockType;
  }
}

/** Thrown when supplied axes reference an unknown axis name, unknown value, or are missing a required axis. */
export class UnknownVariantError extends Error {
  readonly blockType: string;
  readonly axis?: VariantAxis;
  readonly value?: VariantValue;

  constructor(message: string, blockType: string, axis?: VariantAxis, value?: VariantValue) {
    super(message);
    this.name = 'UnknownVariantError';
    this.blockType = blockType;
    this.axis = axis;
    this.value = value;
  }
}
