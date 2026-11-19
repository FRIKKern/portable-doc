// SPDX-License-Identifier: Apache-2.0
// A form question's rating scale as the options it offers, for React and the text writers alike,
// so the HTML, Markdown and plain text show the same scale by construction.
//
// `scale.min` and `scale.max` are whole numbers (a number, or a string read by parseInt), 1 and 5
// when not given. The options run from min up by one, at most SCALE_MAX_OPTIONS of them, so any
// finite bound a document gives renders at once. Past 2^53 a number plus one can be the same
// number; such a repeat is shown once. A scale whose max is below its min offers nothing.

import { isMap } from './util.js';

/** The most options a scale offers: min through min + 100. */
export const SCALE_MAX_OPTIONS = 101;

/** A bound as a finite whole number, or `dflt` when it is not one (a string of 400 nines parses to Infinity). */
function bound(v, dflt) {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : v;
  return Number.isInteger(n) ? n : dflt;
}

/**
 * The options of a question's `scale`, in order.
 * @param {unknown} scale the question's `scale` field
 * @returns {number[]} at most SCALE_MAX_OPTIONS whole numbers, each once
 */
export function scaleOptions(scale) {
  const s = isMap(scale) ? scale : {};
  const min = bound(s.min, 1);
  const max = bound(s.max, 5);
  const options = [];
  for (let k = 0; k < SCALE_MAX_OPTIONS; k++) {
    const v = min + k;
    if (v > max) break;
    if (v !== options[options.length - 1]) options.push(v);
  }
  return options;
}
