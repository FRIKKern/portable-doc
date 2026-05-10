import { describe, expect, it } from 'vitest';
import { levenshtein } from './levenshtein.js';

describe('levenshtein', () => {
  it('identical strings have distance 0', () => {
    expect(levenshtein('callout', 'callout')).toBe(0);
    expect(levenshtein('action', 'action')).toBe(0);
    expect(levenshtein('', '')).toBe(0);
  });

  it('empty-string boundaries equal the other length', () => {
    expect(levenshtein('', 'heading')).toBe(7);
    expect(levenshtein('paragraph', '')).toBe(9);
  });

  it('single-char typo: "calout" -> "callout" is distance 1 (≤2 hit)', () => {
    expect(levenshtein('calout', 'callout')).toBe(1);
  });

  it('two-char typo: "headig" -> "heading" is distance 1 (≤2 hit)', () => {
    expect(levenshtein('headig', 'heading')).toBe(1);
  });

  it('out-of-range typo: "hed" -> "heading" exceeds 2', () => {
    expect(levenshtein('hed', 'heading')).toBeGreaterThan(2);
  });

  it('symmetric: dist(a,b) === dist(b,a)', () => {
    expect(levenshtein('image', 'imge')).toBe(levenshtein('imge', 'image'));
    expect(levenshtein('table', 'tabl')).toBe(levenshtein('tabl', 'table'));
  });
});
