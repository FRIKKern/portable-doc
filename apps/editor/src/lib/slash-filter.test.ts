import { describe, expect, it } from 'vitest';
import { COMMANDS, filterCommands } from './slash-filter.js';

describe('filterCommands', () => {
  it('empty query returns all 15 commands in catalog order', () => {
    // Catalog: 6 heading levels (H1..H6) + paragraph, list, callout,
    // action, section, divider, code, image, table = 15.
    const out = filterCommands('');
    expect(out.length).toBe(15);
    expect(out.map((c) => c.type)).toEqual(COMMANDS.map((c) => c.type));
  });

  it('substring "head" narrows to all 6 heading levels', () => {
    const out = filterCommands('head');
    expect(out.map((c) => c.type)).toEqual([
      'heading',
      'heading',
      'heading',
      'heading',
      'heading',
      'heading',
    ]);
    expect(out.map((c) => c.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('substring "h1" narrows to just Heading 1', () => {
    const out = filterCommands('h1');
    expect(out.map((c) => c.level)).toEqual([1]);
  });

  it('substring "h4" narrows to just Heading 4', () => {
    const out = filterCommands('h4');
    expect(out.map((c) => c.level)).toEqual([4]);
  });

  it('substring matching is case-insensitive', () => {
    const out = filterCommands('CALL');
    expect(out.map((c) => c.type)).toEqual(['callout']);
  });

  it('Levenshtein fallback hits "calout" -> callout (dist 1, ≤ 2)', () => {
    // No substring match, but Levenshtein distance is 1.
    const out = filterCommands('calout');
    expect(out.some((c) => c.type === 'callout')).toBe(true);
  });

  it('Levenshtein fallback fires only when substring yields zero', () => {
    // "code" is a substring of "code" — substring match wins, Levenshtein
    // never runs. Result is exactly the substring hits.
    const out = filterCommands('code');
    expect(out.map((c) => c.type)).toEqual(['code']);
  });

  it('garbage query "xxxxxxxx" returns empty array (substring + Levenshtein both miss)', () => {
    const out = filterCommands('xxxxxxxx');
    expect(out.length).toBe(0);
  });
});
