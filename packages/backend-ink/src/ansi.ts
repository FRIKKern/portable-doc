/**
 * ANSI escape helpers — the only place raw `\x1b[...]` strings live.
 *
 * v0.2 — adds truecolor (24-bit) helpers on top of the named-16 helpers.
 * Color depth gating happens at paint sites in render.ts; this module just
 * knows the codes and the OSC frames.
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

const BG: Record<TuiColorName, number> = {
  black: 40,
  red: 41,
  green: 42,
  yellow: 43,
  blue: 44,
  magenta: 45,
  cyan: 46,
  white: 47,
  gray: 100,
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

export function wrapBg(name: TuiColorName, text: string): string {
  return `${ESC}${BG[name]}m${text}${RESET}`;
}

export function wrapStyle(open: string, text: string): string {
  return `${open}${text}${RESET}`;
}

export function osc8(href: string, text: string): string {
  return `\x1b]8;;${href}${BEL}${text}\x1b]8;;${BEL}`;
}

// ---------------------------------------------------------------------------
// Truecolor (24-bit) — v0.2 primary path on capable terminals.
// ---------------------------------------------------------------------------

export interface RGB { r: number; g: number; b: number }

/** Parse `#rrggbb` (or `#rgb`) into {r,g,b}. Returns null on invalid input. */
export function parseHex(hex: string): RGB | null {
  if (!hex || hex[0] !== '#') return null;
  const h = hex.slice(1);
  if (h.length === 3) {
    const r = parseInt(h[0]! + h[0]!, 16);
    const g = parseInt(h[1]! + h[1]!, 16);
    const b = parseInt(h[2]! + h[2]!, 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b };
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b };
  }
  return null;
}

/** Wrap text in 24-bit truecolor foreground escape. */
export function wrapTruecolorFg(rgb: RGB, text: string): string {
  return `${ESC}38;2;${rgb.r};${rgb.g};${rgb.b}m${text}${RESET}`;
}

/** Wrap text in 24-bit truecolor background escape. */
export function wrapTruecolorBg(rgb: RGB, text: string): string {
  return `${ESC}48;2;${rgb.r};${rgb.g};${rgb.b}m${text}${RESET}`;
}

// ---------------------------------------------------------------------------
// 256-color cube — RGB → nearest of 6×6×6 cube + greyscale.
// ---------------------------------------------------------------------------

/** Map RGB to a 256-color cube index (16–231 cube, 232–255 greyscale). */
export function rgbTo256(rgb: RGB): number {
  const { r, g, b } = rgb;
  // Greyscale check: if r,g,b are close, snap to the 24-step ramp.
  if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8) {
    const avg = (r + g + b) / 3;
    if (avg < 8) return 16; // pure black
    if (avg > 248) return 231; // pure white
    return 232 + Math.round(((avg - 8) / 247) * 23);
  }
  const q = (v: number): number => Math.round((v / 255) * 5);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

/** Wrap text in 256-color foreground escape. */
export function wrap256Fg(rgb: RGB, text: string): string {
  return `${ESC}38;5;${rgbTo256(rgb)}m${text}${RESET}`;
}

/** Wrap text in 256-color background escape. */
export function wrap256Bg(rgb: RGB, text: string): string {
  return `${ESC}48;5;${rgbTo256(rgb)}m${text}${RESET}`;
}

// ---------------------------------------------------------------------------
// Depth-aware fg paint — single entry point used by render.ts.
// ---------------------------------------------------------------------------

export type ColorDepth = 'truecolor' | '256' | '16' | 'mono';

/**
 * Paint `text` with foreground `rgb` (hex-derived), degrading to the named
 * fallback for 16-color and stripping for mono. The named fallback is the
 * tonePalette's `tuiFg` so output stays semantically anchored across depths.
 */
export function paintFg(
  rgb: RGB | null,
  fallbackName: TuiColorName,
  depth: ColorDepth,
  text: string,
): string {
  if (depth === 'mono') return text;
  if (depth === 'truecolor' && rgb) return wrapTruecolorFg(rgb, text);
  if (depth === '256' && rgb) return wrap256Fg(rgb, text);
  return wrapColor(fallbackName, text);
}

export function paintBg(
  rgb: RGB | null,
  fallbackName: TuiColorName,
  depth: ColorDepth,
  text: string,
): string {
  if (depth === 'mono') return text;
  if (depth === 'truecolor' && rgb) return wrapTruecolorBg(rgb, text);
  if (depth === '256' && rgb) return wrap256Bg(rgb, text);
  return wrapBg(fallbackName, text);
}
