// SPDX-License-Identifier: Apache-2.0
// The one door from a number to shown text, for React and the text writers alike.
//
// A finite number shows its digits; NaN, Infinity and -Infinity show nothing, as the text writers
// have always written them, so the HTML, Markdown and plain text agree by construction.
// In a style, the same rule is one step wider: a property whose number is not finite is left out
// whole (styleOf), never written with its number dropped (`width:%`), and a style attribute with no
// property left is not written at all (styleAttr). A roadmap bar's left or width and its today line
// are such properties.

/**
 * A number as shown text.
 * @param {number} n
 * @param {number | 'whole' | { significant: number }} [digits] fixed digits after the point
 *   (toFixed); 'whole' for a whole number written in full, with no exponent; or { significant } for
 *   the number rounded to that many significant digits; by default the digits String gives
 * @returns {string} '' for NaN, Infinity or -Infinity
 */
export function numberText(n, digits) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  if (digits === undefined) return String(n);
  if (digits === 'whole') return Math.abs(n) < 1e21 ? String(n) : BigInt(n).toString();
  if (typeof digits === 'object') return String(Number(n.toPrecision(digits.significant)));
  return n.toFixed(digits);
}

/**
 * A value as String writes it, but each number in it, at any depth of an array, through numberText:
 * String([1, NaN]) is "1,NaN", stringOf([1, NaN]) is "1,".
 * @param {unknown} v
 * @returns {string}
 */
export function stringOf(v) {
  if (typeof v === 'number') return numberText(v);
  if (Array.isArray(v)) return v.map((x) => (x == null ? '' : stringOf(x))).join(',');
  return String(v);
}

/**
 * One style property that carries a number, as `prop:value`; '' when the number is not finite, so
 * the property is left out whole.
 * @param {string} prop
 * @param {number | null | undefined} n
 * @param {(n: number) => string} [write] the value from the finite number; by default its digits
 * @returns {string}
 */
export function styleOf(prop, n, write = numberText) {
  return typeof n === 'number' && Number.isFinite(n) ? `${prop}:${write(n)}` : '';
}

/**
 * A style attribute (with its leading space) from its properties, the empty ones left out; '' when
 * none is left, so no empty style="" is written.
 * @param {string[]} props
 * @returns {string}
 */
export function styleAttr(props) {
  const kept = props.filter((p) => p !== '');
  return kept.length ? ` style="${kept.join(';')}"` : '';
}
