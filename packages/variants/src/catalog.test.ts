/**
 * Variant-catalog specs.
 *
 * Per-variant resolution + determinism + invalid-input rejection. Hex values
 * referenced through `defaultTokens` / `tonePalette` so the tests stay coupled
 * to the single source of truth in @portable-doc/core.
 */
import { describe, expect, it } from 'vitest';
import { defaultTokens, tonePalette } from '@portable-doc/core';
import {
  UnknownBlockTypeError,
  UnknownVariantError,
  VARIANT_CATALOG,
  resolveVariant,
} from './index.js';

describe('VARIANT_CATALOG schema export', () => {
  it('callout has tone × emphasis axes (5 × 2)', () => {
    expect(VARIANT_CATALOG.callout?.axes.tone?.length).toBe(5);
    expect(VARIANT_CATALOG.callout?.axes.emphasis?.length).toBe(2);
  });

  it('action has priority × size axes (2 × 2)', () => {
    expect(VARIANT_CATALOG.action?.axes.priority?.length).toBe(2);
    expect(VARIANT_CATALOG.action?.axes.size?.length).toBe(2);
  });

  it('section has density axis (3 values)', () => {
    expect(VARIANT_CATALOG.section?.axes.density?.length).toBe(3);
  });

  it('code has theme × density axes (2 × 2)', () => {
    expect(VARIANT_CATALOG.code?.axes.theme?.length).toBe(2);
    expect(VARIANT_CATALOG.code?.axes.density?.length).toBe(2);
  });

  it('blocks without variants are undefined slots', () => {
    expect(VARIANT_CATALOG.heading).toBeUndefined();
    expect(VARIANT_CATALOG.paragraph).toBeUndefined();
    expect(VARIANT_CATALOG.list).toBeUndefined();
    expect(VARIANT_CATALOG.divider).toBeUndefined();
    expect(VARIANT_CATALOG.image).toBeUndefined();
    expect(VARIANT_CATALOG.table).toBeUndefined();
  });
});

describe('callout — tone × emphasis (10 variants)', () => {
  // success
  it('success + subtle', () => {
    expect(resolveVariant('callout', { tone: 'success', emphasis: 'subtle' })).toEqual({
      borderWidth: 3,
      borderColor: tonePalette.success.fg,
      backgroundColor: tonePalette.success.bg,
      padding: 16,
    });
  });

  it('success + bold', () => {
    expect(resolveVariant('callout', { tone: 'success', emphasis: 'bold' })).toEqual({
      borderWidth: 4,
      borderColor: tonePalette.success.fg,
      backgroundColor: tonePalette.success.bg,
      padding: 16,
    });
  });

  // warning
  it('warning + subtle', () => {
    expect(resolveVariant('callout', { tone: 'warning', emphasis: 'subtle' })).toEqual({
      borderWidth: 3,
      borderColor: tonePalette.warning.fg,
      backgroundColor: tonePalette.warning.bg,
      padding: 16,
    });
  });

  it('warning + bold', () => {
    expect(resolveVariant('callout', { tone: 'warning', emphasis: 'bold' })).toEqual({
      borderWidth: 4,
      borderColor: tonePalette.warning.fg,
      backgroundColor: tonePalette.warning.bg,
      padding: 16,
    });
  });

  // danger
  it('danger + subtle', () => {
    expect(resolveVariant('callout', { tone: 'danger', emphasis: 'subtle' })).toEqual({
      borderWidth: 3,
      borderColor: tonePalette.danger.fg,
      backgroundColor: tonePalette.danger.bg,
      padding: 16,
    });
  });

  it('danger + bold', () => {
    expect(resolveVariant('callout', { tone: 'danger', emphasis: 'bold' })).toEqual({
      borderWidth: 4,
      borderColor: tonePalette.danger.fg,
      backgroundColor: tonePalette.danger.bg,
      padding: 16,
    });
  });

  // info
  it('info + subtle', () => {
    expect(resolveVariant('callout', { tone: 'info', emphasis: 'subtle' })).toEqual({
      borderWidth: 3,
      borderColor: tonePalette.info.fg,
      backgroundColor: tonePalette.info.bg,
      padding: 16,
    });
  });

  it('info + bold', () => {
    expect(resolveVariant('callout', { tone: 'info', emphasis: 'bold' })).toEqual({
      borderWidth: 4,
      borderColor: tonePalette.info.fg,
      backgroundColor: tonePalette.info.bg,
      padding: 16,
    });
  });

  // neutral
  it('neutral + subtle', () => {
    expect(resolveVariant('callout', { tone: 'neutral', emphasis: 'subtle' })).toEqual({
      borderWidth: 3,
      borderColor: tonePalette.neutral.fg,
      backgroundColor: tonePalette.neutral.bg,
      padding: 16,
    });
  });

  it('neutral + bold', () => {
    expect(resolveVariant('callout', { tone: 'neutral', emphasis: 'bold' })).toEqual({
      borderWidth: 4,
      borderColor: tonePalette.neutral.fg,
      backgroundColor: tonePalette.neutral.bg,
      padding: 16,
    });
  });
});

describe('action — priority × size (4 variants)', () => {
  it('primary + medium', () => {
    expect(resolveVariant('action', { priority: 'primary', size: 'medium' })).toEqual({
      backgroundColor: defaultTokens.color.brand,
      padding: 12,
    });
  });

  it('primary + large', () => {
    expect(resolveVariant('action', { priority: 'primary', size: 'large' })).toEqual({
      backgroundColor: defaultTokens.color.brand,
      padding: 16,
    });
  });

  it('secondary + medium', () => {
    expect(resolveVariant('action', { priority: 'secondary', size: 'medium' })).toEqual({
      borderWidth: 2,
      borderColor: defaultTokens.color.brand,
      padding: 10,
    });
  });

  it('secondary + large', () => {
    expect(resolveVariant('action', { priority: 'secondary', size: 'large' })).toEqual({
      borderWidth: 2,
      borderColor: defaultTokens.color.brand,
      padding: 14,
    });
  });
});

describe('section — density (3 variants)', () => {
  it('compact', () => {
    expect(resolveVariant('section', { density: 'compact' })).toEqual({
      padding: 8,
      margin: 8,
    });
  });

  it('comfortable', () => {
    expect(resolveVariant('section', { density: 'comfortable' })).toEqual({
      padding: 16,
      margin: 16,
    });
  });

  it('spacious', () => {
    expect(resolveVariant('section', { density: 'spacious' })).toEqual({
      padding: 24,
      margin: 24,
    });
  });
});

describe('code — theme × density (4 variants)', () => {
  it('light + normal', () => {
    expect(resolveVariant('code', { theme: 'light', density: 'normal' })).toEqual({
      backgroundColor: defaultTokens.color.codeBg,
      padding: 16,
    });
  });

  it('light + compact', () => {
    expect(resolveVariant('code', { theme: 'light', density: 'compact' })).toEqual({
      backgroundColor: defaultTokens.color.codeBg,
      padding: 8,
    });
  });

  it('dark + normal', () => {
    expect(resolveVariant('code', { theme: 'dark', density: 'normal' })).toEqual({
      backgroundColor: '#111827',
      padding: 16,
    });
  });

  it('dark + compact', () => {
    expect(resolveVariant('code', { theme: 'dark', density: 'compact' })).toEqual({
      backgroundColor: '#111827',
      padding: 8,
    });
  });
});

describe('determinism', () => {
  it('repeated calls return deepEqual results — callout', () => {
    const a = resolveVariant('callout', { tone: 'success', emphasis: 'subtle' });
    const b = resolveVariant('callout', { tone: 'success', emphasis: 'subtle' });
    expect(a).toEqual(b);
  });

  it('repeated calls return deepEqual results — action', () => {
    const a = resolveVariant('action', { priority: 'secondary', size: 'large' });
    const b = resolveVariant('action', { priority: 'secondary', size: 'large' });
    expect(a).toEqual(b);
  });

  it('repeated calls return deepEqual results — section', () => {
    const a = resolveVariant('section', { density: 'spacious' });
    const b = resolveVariant('section', { density: 'spacious' });
    expect(a).toEqual(b);
  });

  it('repeated calls return deepEqual results — code', () => {
    const a = resolveVariant('code', { theme: 'dark', density: 'compact' });
    const b = resolveVariant('code', { theme: 'dark', density: 'compact' });
    expect(a).toEqual(b);
  });
});

describe('error cases', () => {
  it('throws UnknownBlockTypeError for blocks without a catalog entry', () => {
    expect(() => resolveVariant('heading', {})).toThrow(UnknownBlockTypeError);
    expect(() => resolveVariant('paragraph', {})).toThrow(UnknownBlockTypeError);
    expect(() => resolveVariant('list', {})).toThrow(UnknownBlockTypeError);
    expect(() => resolveVariant('divider', {})).toThrow(UnknownBlockTypeError);
    expect(() => resolveVariant('image', {})).toThrow(UnknownBlockTypeError);
    expect(() => resolveVariant('table', {})).toThrow(UnknownBlockTypeError);
  });

  it('UnknownBlockTypeError carries the offending block type', () => {
    try {
      resolveVariant('heading', {});
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownBlockTypeError);
      expect((err as UnknownBlockTypeError).blockType).toBe('heading');
    }
  });

  it('throws UnknownVariantError for unknown axis name', () => {
    expect(() => resolveVariant('callout', { flavor: 'spicy' })).toThrow(UnknownVariantError);
    try {
      resolveVariant('callout', { flavor: 'spicy' });
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownVariantError);
      expect((err as UnknownVariantError).message).toContain('flavor');
      expect((err as UnknownVariantError).axis).toBe('flavor');
    }
  });

  it('throws UnknownVariantError for unknown value within a known axis', () => {
    expect(() =>
      resolveVariant('callout', { tone: 'rainbow', emphasis: 'subtle' }),
    ).toThrow(UnknownVariantError);
    try {
      resolveVariant('callout', { tone: 'rainbow', emphasis: 'subtle' });
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownVariantError);
      const e = err as UnknownVariantError;
      expect(e.message).toContain('rainbow');
      expect(e.axis).toBe('tone');
      expect(e.value).toBe('rainbow');
    }
  });

  it('throws UnknownVariantError for missing required axis', () => {
    // Policy: every axis declared by the schema is required for a
    // deterministic resolve. Missing → UnknownVariantError.
    expect(() => resolveVariant('callout', { tone: 'success' })).toThrow(UnknownVariantError);
    try {
      resolveVariant('callout', { tone: 'success' });
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownVariantError);
      expect((err as UnknownVariantError).axis).toBe('emphasis');
      expect((err as UnknownVariantError).message).toContain('emphasis');
    }
  });
});
