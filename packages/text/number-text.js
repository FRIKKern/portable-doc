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
 * How a style writes its number, by name. A new format is added here and nowhere else.
 * digits: the digits numberText gives; tenths: a whole number in full, else one digit after the
 * point; thousandths: three digits after the point.
 */
export const STYLE_FORMATS = Object.freeze({
  digits: (n) => numberText(n),
  tenths: (n) => (Number.isInteger(n) ? numberText(n, 'whole') : numberText(n, 1)),
  thousandths: (n) => numberText(n, 3),
});

/** Every text a style may write before its number. */
export const STYLE_BEFORE = Object.freeze(['', 'span ', 'repeat(', 'auto repeat(']);

/** Every text a style may write after its number. */
export const STYLE_AFTER = Object.freeze([
  '',
  '%',
  'px',
  ',12px)',
  ',minmax(10px,44px))',
  ',minmax(28px,auto))',
  ',minmax(10px,44px)) auto',
  ',minmax(28px,auto)) auto',
]);

/**
 * One style property that carries a number, as `prop:<before><number><after>`; '' when the number
 * is not finite, so the property is left out whole. The format, before and after are data from the
 * lists above; any other throws, finite number or not.
 * @param {string} prop
 * @param {number | null | undefined} n
 * @param {{ format?: string, before?: string, after?: string }} [how]
 * @returns {string}
 */
export function styleOf(prop, n, { format = 'digits', before = '', after = '' } = {}) {
  if (!Object.hasOwn(STYLE_FORMATS, format)) throw new TypeError(`styleOf: ${JSON.stringify(format)} is not a style format`);
  if (!STYLE_BEFORE.includes(before)) throw new TypeError(`styleOf: ${JSON.stringify(before)} is not a listed text before a number`);
  if (!STYLE_AFTER.includes(after)) throw new TypeError(`styleOf: ${JSON.stringify(after)} is not a listed text after a number`);
  return typeof n === 'number' && Number.isFinite(n) ? `${prop}:${before}${STYLE_FORMATS[format](n)}${after}` : '';
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
