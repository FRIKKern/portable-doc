// SPDX-License-Identifier: Apache-2.0
/** A number as shown text: a finite number's digits (fixed digits after the point, 'whole' for a whole number in full, or { significant } digits); '' for NaN, Infinity or -Infinity. */
export function numberText(n: number, digits?: number | 'whole' | { significant: number }): string;
/** A value as String writes it, but each number in it, at any depth of an array, through numberText. */
export function stringOf(v: unknown): string;
/** How a style writes its number, by name; the keys are the only formats. */
export const STYLE_FORMATS: Readonly<{ digits: (n: number) => string; tenths: (n: number) => string; thousandths: (n: number) => string }>;
/** Every text a style may write before its number. */
export const STYLE_BEFORE: readonly ['', 'span ', 'repeat(', 'auto repeat('];
/** Every text a style may write after its number. */
export const STYLE_AFTER: readonly ['', '%', 'px', ',12px)', ',minmax(10px,44px))', ',minmax(28px,auto))', ',minmax(10px,44px)) auto', ',minmax(28px,auto)) auto'];
export type StyleFormat = keyof typeof STYLE_FORMATS;
export type StyleBefore = (typeof STYLE_BEFORE)[number];
export type StyleAfter = (typeof STYLE_AFTER)[number];
/** One style property that carries a number, as `prop:<before><number><after>`; '' when the number is not finite, so the property is left out whole. */
export function styleOf(prop: string, n: number | null | undefined, how?: { format?: StyleFormat; before?: StyleBefore; after?: StyleAfter }): string;
/** A style attribute (with its leading space) from its properties, the empty ones left out; '' when none is left. */
export function styleAttr(props: string[]): string;
