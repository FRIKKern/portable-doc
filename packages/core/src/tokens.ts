/**
 * Default token palette per spec §9.
 *
 * Tone palette is 16-color-safe: every entry pairs a hex bg/fg for web/native/email
 * with a `tuiFg` name from the ANSI 16. Anything outside this set is rejected by
 * the validator.
 *
 * DROPPED (per §9): radius, shadow, opacity, gradient, animation, transform,
 * mediaQuery. They cannot survive intersection-mode rendering across web ∩ email
 * ∩ native ∩ TUI ∩ text.
 */

export type TuiColorName = 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray';

export interface TonePaletteEntry {
  bg: string;
  fg: string;
  tuiFg: TuiColorName;
}

export type TonePalette = {
  success: TonePaletteEntry;
  warning: TonePaletteEntry;
  danger: TonePaletteEntry;
  info: TonePaletteEntry;
  neutral: TonePaletteEntry;
};

export const tonePalette = {
  success: { bg: '#ecfdf5', fg: '#047857', tuiFg: 'green' },
  warning: { bg: '#fffbeb', fg: '#92400e', tuiFg: 'yellow' },
  danger: { bg: '#fef2f2', fg: '#b91c1c', tuiFg: 'red' },
  info: { bg: '#eff6ff', fg: '#1d4ed8', tuiFg: 'blue' },
  neutral: { bg: '#f3f4f6', fg: '#374151', tuiFg: 'gray' },
} as const satisfies TonePalette;

export const toneNames = ['success', 'warning', 'danger', 'info', 'neutral'] as const;
export type ToneName = (typeof toneNames)[number];

export interface ColorTokens {
  background: string;
  surface: string;
  border: string;
  text: string;
  mutedText: string;
  brand: string;
  brandText: string;
  codeBg: string;
  tone: TonePalette;
}

export interface SpaceTokens {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

export interface TypographyTokens {
  body: string;
  heading: string;
  mono: string;
}

export interface DefaultTokens {
  color: ColorTokens;
  space: SpaceTokens;
  borderStyle: readonly ['single', 'double', 'bold'];
  typography: TypographyTokens;
}

export const defaultTokens: DefaultTokens = {
  color: {
    background: '#f9fafb',
    surface: '#ffffff',
    border: '#e5e7eb',
    text: '#111827',
    mutedText: '#6b7280',
    brand: '#4f46e5',
    brandText: '#ffffff',
    codeBg: '#f3f4f6',
    tone: tonePalette,
  },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  borderStyle: ['single', 'double', 'bold'] as const,
  typography: {
    body: '-apple-system, "SF Pro Text", system-ui, sans-serif',
    heading: '-apple-system, "SF Pro Display", system-ui, sans-serif',
    mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  },
};
