// SPDX-License-Identifier: Apache-2.0
/** A number as shown text: a finite number's digits (fixed digits after the point, or 'whole' for a whole number in full); '' for NaN, Infinity or -Infinity. */
export function numberText(n: number, digits?: number | 'whole'): string;
/** A value as String writes it, but each number in it, at any depth of an array, through numberText. */
export function stringOf(v: unknown): string;
