/**
 * Block × Surface support matrix.
 *
 * Binary `native | unsupported` per spec §9 (grill resolution): no fuzzy
 * "approximation". A backend either renders the block in its idiomatic shape
 * or it refuses, and the renderer falls back to a plain text representation.
 */

import type { BlockType, Surface, SurfaceSupport } from './ast.js';

export type { Surface, SurfaceSupport } from './ast.js';

export type BlockContracts = Record<BlockType, Record<Surface, SurfaceSupport>>;

export const blockContracts: BlockContracts = {
  heading: {
    web: 'native',
    native: 'native',
    email: 'native',
    tui: 'native',
    text: 'native',
  },
  paragraph: {
    web: 'native',
    native: 'native',
    email: 'native',
    tui: 'native',
    text: 'native',
  },
  list: {
    web: 'native',
    native: 'native',
    email: 'native',
    tui: 'native',
    text: 'native',
  },
  callout: {
    web: 'native',
    native: 'native',
    email: 'native',
    tui: 'native',
    text: 'native',
  },
  action: {
    web: 'native',
    native: 'native',
    email: 'native',
    tui: 'native',
    text: 'native',
  },
  section: {
    web: 'native',
    native: 'native',
    email: 'native',
    tui: 'native',
    text: 'native',
  },
  divider: {
    web: 'native',
    native: 'native',
    email: 'native',
    tui: 'native',
    text: 'native',
  },
  code: {
    web: 'native',
    native: 'native',
    email: 'native',
    tui: 'native',
    text: 'native',
  },
  image: {
    web: 'native',
    native: 'native',
    email: 'unsupported',
    tui: 'unsupported',
    text: 'unsupported',
  },
  table: {
    web: 'native',
    native: 'native',
    email: 'unsupported',
    tui: 'unsupported',
    text: 'unsupported',
  },
};

/** Quick lookup helper. */
export function isSupported(block: BlockType, surface: Surface): boolean {
  return blockContracts[block][surface] === 'native';
}
