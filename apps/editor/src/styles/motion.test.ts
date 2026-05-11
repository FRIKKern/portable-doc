// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { motion, duration, type MotionKey } from './motion';

const NUMERIC_KEYS: Array<Exclude<MotionKey, 'easing'>> = [
  'chromeFadeIn',
  'chromeFadeOut',
  'slashMenuOpen',
  'bubbleMenuOpen',
  'dropIndicator',
  'variantChipExpand',
  'outlineSlide',
  'previewOverlayOpen',
  'previewOverlayClose',
  'footerSheetSlide',
];

describe('motion constants', () => {
  it('every numeric timing is a number in 0–500ms range', () => {
    for (const key of NUMERIC_KEYS) {
      const v = motion[key] as number;
      expect(typeof v).toBe('number');
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(500);
    }
  });

  it('easing is a non-empty cubic-bezier string', () => {
    expect(typeof motion.easing).toBe('string');
    expect(motion.easing).toMatch(/^cubic-bezier\(/);
  });

  it('exposes exactly the documented keys (no drift)', () => {
    const keys = Object.keys(motion).sort();
    const expected = [...NUMERIC_KEYS, 'easing'].sort();
    expect(keys).toEqual(expected);
  });
});

describe('duration() helper', () => {
  const realMatchMedia = window.matchMedia;

  afterEach(() => {
    // Restore the jsdom default after each test mutated matchMedia.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: realMatchMedia,
    });
    vi.restoreAllMocks();
  });

  it('returns motion[key] when prefers-reduced-motion is not set', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((_q: string) => ({
        matches: false,
        media: _q,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    for (const key of NUMERIC_KEYS) {
      expect(duration(key)).toBe(motion[key]);
    }
  });

  it('collapses every duration to 0 when prefers-reduced-motion: reduce', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((_q: string) => ({
        matches: true,
        media: _q,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    for (const key of NUMERIC_KEYS) {
      expect(duration(key)).toBe(0);
    }
  });

  it('falls back to the static value when matchMedia is unavailable', () => {
    // Simulate an environment (e.g. ancient browser, partial polyfill)
    // where window exists but matchMedia is absent.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    expect(duration('chromeFadeIn')).toBe(motion.chromeFadeIn);
  });
});

describe('SSR safety', () => {
  it('duration() returns the static value when window is undefined', () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error — deliberately drop window to mimic SSR.
    delete globalThis.window;
    try {
      expect(duration('outlineSlide')).toBe(motion.outlineSlide);
    } finally {
      globalThis.window = originalWindow;
    }
  });
});
