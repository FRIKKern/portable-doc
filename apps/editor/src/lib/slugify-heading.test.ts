/**
 * @vitest-environment happy-dom
 *
 * slugifyHeading — unit tests for the heading-id derivation.
 */
import { describe, expect, it } from 'vitest';
import { slugifyHeading } from '../extensions/index.js';

describe('slugifyHeading', () => {
  it('lowercases + dashes spaces', () => {
    expect(slugifyHeading('Welcome to Atlas')).toBe('welcome-to-atlas');
  });

  it('strips punctuation and special chars', () => {
    expect(slugifyHeading("What's next?")).toBe('whats-next');
    expect(slugifyHeading('Setup complete!')).toBe('setup-complete');
  });

  it('collapses multiple whitespace + dashes', () => {
    expect(slugifyHeading('Foo   bar — baz')).toBe('foo-bar-baz');
    expect(slugifyHeading('a---b')).toBe('a-b');
  });

  it('trims leading + trailing dashes', () => {
    expect(slugifyHeading('  --hi--  ')).toBe('hi');
  });

  it('caps length at 64 chars', () => {
    const long = 'a '.repeat(80).trim();
    const slug = slugifyHeading(long);
    expect(slug.length).toBeLessThanOrEqual(64);
  });

  it('returns empty string for whitespace-only / empty input', () => {
    expect(slugifyHeading('')).toBe('');
    expect(slugifyHeading('   ')).toBe('');
  });

  it('drops non-ASCII characters', () => {
    // Mirrors GitHub's anchor behavior on the conservative side —
    // accented Latin loses its accent; non-Latin gets stripped.
    // We don't include these in the slug because dropping non-
    // alphanum is simpler than transliterating.
    expect(slugifyHeading('Café résumé')).toBe('caf-rsum');
    expect(slugifyHeading('日本語')).toBe('');
  });
});
