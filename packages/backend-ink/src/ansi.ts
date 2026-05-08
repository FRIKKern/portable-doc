/**
 * ANSI escape helpers — the only place raw `\x1b[...]` strings live.
 *
 * Keeps render.ts free of magic numbers. Color depth gating is checked at
 * paint sites in render.ts; this module knows the codes and the OSC-8 frame.
 */

import type { TuiColorName } from '@portable-doc/core';

const ESC = '\x1b[';
const RESET = '\x1b[0m';
const BEL = '\x07';

const FG: Record<TuiColorName, number> = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
};

export const codes = {
  bold: `${ESC}1m`,
  italic: `${ESC}3m`,
  underline: `${ESC}4m`,
  inverse: `${ESC}7m`,
  strike: `${ESC}9m`,
  reset: RESET,
} as const;

export function wrapColor(name: TuiColorName, text: string): string {
  return `${ESC}${FG[name]}m${text}${RESET}`;
}

export function wrapStyle(open: string, text: string): string {
  return `${open}${text}${RESET}`;
}

export function osc8(href: string, text: string): string {
  return `\x1b]8;;${href}${BEL}${text}\x1b]8;;${BEL}`;
}
