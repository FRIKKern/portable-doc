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

// ---------------------------------------------------------------------------
// Color-depth interface (v0.2.1)
// ---------------------------------------------------------------------------
//
// `resolveColorFg(hex, depth)` returns ONLY the ANSI prefix, no wrapping. The
// caller appends `${text}${codes.reset}`. This is the deliberate, paperflow-
// owned single path for every color emission in backend-ink — both syntax-
// highlighting and tone resolution funnel through here so we never accidentally
// drop into a 16-color named-token theme on a truecolor terminal.
//
//   truecolor → \x1b[38;2;R;G;Bm
//   256       → \x1b[38;5;Nm  (6×6×6 cube + greyscale ramp via rgbTo256)
//   16        → \x1b[3Xm or \x1b[9Xm  (nearest of 16 named ANSI colors)
//   mono      → ''  (caller falls back to plain text)

/**
 * The 16 standard ANSI colors with their canonical RGB values and FG codes.
 * Used by the 16-color depth fallback to pick the nearest match for an
 * arbitrary hex via Euclidean distance in RGB space.
 *
 * Bright variants intentionally included so e.g. `#ff0000` snaps to bright red
 * (91) rather than dim red (31), matching what users expect from "true red".
 */
const ANSI_16: ReadonlyArray<{ fg: number; bg: number; r: number; g: number; b: number }> = [
  { fg: 30, bg: 40, r: 0, g: 0, b: 0 },         // black
  { fg: 31, bg: 41, r: 170, g: 0, b: 0 },       // red
  { fg: 32, bg: 42, r: 0, g: 170, b: 0 },       // green
  { fg: 33, bg: 43, r: 170, g: 85, b: 0 },      // yellow (dim is brownish)
  { fg: 34, bg: 44, r: 0, g: 0, b: 170 },       // blue
  { fg: 35, bg: 45, r: 170, g: 0, b: 170 },     // magenta
  { fg: 36, bg: 46, r: 0, g: 170, b: 170 },     // cyan
  { fg: 37, bg: 47, r: 170, g: 170, b: 170 },   // white
  { fg: 90, bg: 100, r: 85, g: 85, b: 85 },     // bright black / gray
  { fg: 91, bg: 101, r: 255, g: 85, b: 85 },    // bright red
  { fg: 92, bg: 102, r: 85, g: 255, b: 85 },    // bright green
  { fg: 93, bg: 103, r: 255, g: 255, b: 85 },   // bright yellow
  { fg: 94, bg: 104, r: 85, g: 85, b: 255 },    // bright blue
  { fg: 95, bg: 105, r: 255, g: 85, b: 255 },   // bright magenta
  { fg: 96, bg: 106, r: 85, g: 255, b: 255 },   // bright cyan
  { fg: 97, bg: 107, r: 255, g: 255, b: 255 },  // bright white
];

/**
 * Indices of the 4 grayscale ANSI entries in `ANSI_16` (black, white, bright
 * black/gray, bright white). When the input hex is chromatic — i.e. max-min
 * channel ≥ 32 — we exclude these candidates so a saturated dark tone like
 * `#047857` doesn't snap to gray on RGB-distance grounds alone.
 */
const GRAYSCALE_INDICES = new Set([0, 7, 8, 15]);

/**
 * RGB → HSV. Hue in degrees [0, 360), saturation/value in [0, 1].
 * Used by the 16-color matcher so a deep teal-green like `#047857` lands on
 * green by hue rather than on cyan (which is a closer RGB neighbour but the
 * wrong perceptual call).
 */
function rgbToHsv(rgb: RGB): { h: number; s: number; v: number } {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

/**
 * Hue distance on the [0, 360) circle, normalised to [0, 1].
 */
function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return (d > 180 ? 360 - d : d) / 180;
}

/**
 * Pick the entry in ANSI_16 closest to `rgb`.
 *
 * - For grayscale inputs (chroma < 32): pure Euclidean RGB distance, all 16
 *   candidates allowed.
 * - For chromatic inputs: composite distance that weights hue heavily, then
 *   adjusts for saturation × value. Grayscale candidates are excluded so
 *   chromatic targets never snap to gray. This is what keeps tone resolution
 *   semantically aligned with the source hex when degraded to 16 colors.
 */
function nearest16(rgb: RGB): (typeof ANSI_16)[number] {
  const chroma = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);
  if (chroma < 32) {
    // Grayscale-ish input — RGB distance suffices.
    let best = ANSI_16[0]!;
    let bestDist = Infinity;
    for (const c of ANSI_16) {
      const dr = rgb.r - c.r;
      const dg = rgb.g - c.g;
      const db = rgb.b - c.b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }
  // Chromatic input — hue-first composite distance.
  const targetHsv = rgbToHsv(rgb);
  let best = ANSI_16[1]!;  // default to red rather than black if loop short-circuits
  let bestScore = Infinity;
  for (let i = 0; i < ANSI_16.length; i++) {
    if (GRAYSCALE_INDICES.has(i)) continue;
    const c = ANSI_16[i]!;
    const candHsv = rgbToHsv({ r: c.r, g: c.g, b: c.b });
    // Weighted: hue dominates (×4), saturation diff (×1), value diff (×1).
    const hd = hueDist(targetHsv.h, candHsv.h);
    const sd = Math.abs(targetHsv.s - candHsv.s);
    const vd = Math.abs(targetHsv.v - candHsv.v);
    const score = hd * 4 + sd + vd;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/**
 * Resolve a hex color (e.g. `'#047857'`) to an ANSI **foreground** escape
 * prefix appropriate for the active color depth. The caller appends the text
 * content and the reset escape (`\x1b[0m`).
 *
 *   truecolor → \x1b[38;2;R;G;Bm
 *   256       → \x1b[38;5;Nm  (6×6×6 cube + greyscale ramp via rgbTo256)
 *   16        → \x1b[3Xm or \x1b[9Xm  (nearest of 16 named ANSI colors,
 *               or `namedFallback` if provided — semantically anchored)
 *   mono      → ''  (caller falls back to plain text)
 *
 * `namedFallback` is the optional semantic 16-color anchor for callers that
 * have one (tonePalette[tone].tuiFg). It bypasses RGB-distance matching at
 * depth 16 — perception-aware enough that "success → green" stays green even
 * when the hex (`#047857`, a deep teal) is closer to cyan in pure RGB space.
 * Higher-depth paths ignore it. For mono, or for an unparseable hex, returns
 * the empty string; the caller MUST treat that as "no color, plain text".
 */
export function resolveColorFg(
  hex: string,
  depth: ColorDepth,
  namedFallback?: TuiColorName,
): string {
  if (depth === 'mono') return '';
  const rgb = parseHex(hex);
  if (!rgb) return '';
  if (depth === 'truecolor') return `${ESC}38;2;${rgb.r};${rgb.g};${rgb.b}m`;
  if (depth === '256') return `${ESC}38;5;${rgbTo256(rgb)}m`;
  if (namedFallback) return `${ESC}${FG[namedFallback]}m`;
  return `${ESC}${nearest16(rgb).fg}m`;
}

/** Background variant — same logic, swap `38` → `48`. */
export function resolveColorBg(
  hex: string,
  depth: ColorDepth,
  namedFallback?: TuiColorName,
): string {
  if (depth === 'mono') return '';
  const rgb = parseHex(hex);
  if (!rgb) return '';
  if (depth === 'truecolor') return `${ESC}48;2;${rgb.r};${rgb.g};${rgb.b}m`;
  if (depth === '256') return `${ESC}48;5;${rgbTo256(rgb)}m`;
  if (namedFallback) return `${ESC}${BG[namedFallback]}m`;
  return `${ESC}${nearest16(rgb).bg}m`;
}
