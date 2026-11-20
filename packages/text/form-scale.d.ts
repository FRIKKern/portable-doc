// SPDX-License-Identifier: Apache-2.0
/** The most options a form question's scale offers: min through min + 100. */
export const SCALE_MAX_OPTIONS: 101;
/** The options of a question's `scale` ({ min, max }, 1 and 5 by default), in order: at most SCALE_MAX_OPTIONS whole numbers, each once. */
export function scaleOptions(scale: unknown): number[];
