// SPDX-License-Identifier: Apache-2.0
/** A number as shown text: a finite number's digits (fixed digits after the point, 'whole' for a whole number in full, or { significant } digits); '' for NaN, Infinity or -Infinity. */
export function numberText(n: number, digits?: number | 'whole' | { significant: number }): string;
/** A value as String writes it, but each number in it, at any depth of an array, through numberText. */
export function stringOf(v: unknown): string;
/** One style property that carries a number, as `prop:value`; '' when the number is not finite, so the property is left out whole. */
export function styleOf(prop: string, n: number | null | undefined, write?: (n: number) => string): string;
/** A style attribute (with its leading space) from its properties, the empty ones left out; '' when none is left. */
export function styleAttr(props: string[]): string;
