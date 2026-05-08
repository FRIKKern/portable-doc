/**
 * Fixture validation + block-type coverage gate.
 *
 * - Both fixtures must round-trip through validateDoc with zero issues.
 * - Across the two fixtures, every BlockType must appear at least once.
 */

import { describe, expect, it } from 'vitest';

import { validateDoc, type Block, type BlockType } from '@portable-doc/core';

import { incident, welcome } from './index.js';

const ALL_BLOCK_TYPES: BlockType[] = [
  'heading',
  'paragraph',
  'list',
  'callout',
  'action',
  'section',
  'divider',
  'code',
  'image',
  'table',
];

describe('fixtures', () => {
  it('welcome validates', () => {
    expect(validateDoc(welcome)).toEqual([]);
  });

  it('incident validates', () => {
    expect(validateDoc(incident)).toEqual([]);
  });

  it('coverage: every block type appears across the two fixtures', () => {
    const seen = new Set<BlockType>();
    const walk = (b: Block): void => {
      seen.add(b.type);
      if (b.type === 'section') {
        for (const child of b.blocks) walk(child);
      }
    };
    welcome.blocks.forEach(walk);
    incident.blocks.forEach(walk);
    for (const t of ALL_BLOCK_TYPES) {
      expect(seen.has(t), `missing block type: ${t}`).toBe(true);
    }
  });
});
