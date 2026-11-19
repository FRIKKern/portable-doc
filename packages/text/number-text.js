// SPDX-License-Identifier: Apache-2.0
// The one door from a number to shown text, for React and the text writers alike.
//
// A finite number shows its digits; NaN, Infinity and -Infinity show nothing, as the text writers
// have always written them, so the HTML, Markdown and plain text agree by construction.
// A non-finite position (a roadmap bar's left or width, or its today line) leaves that property out
// of the style, rather than writing the empty text the door gives it.

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
