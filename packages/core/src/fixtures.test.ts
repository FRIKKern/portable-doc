/**
 * Validator coverage gate against the canonical JSON examples at repo root.
 *
 * The two example documents at `examples/welcome.json` and
 * `examples/incident.json` are the source of truth for what a valid
 * PortableDoc looks like — MCP `portable-doc://examples/...` resources, the
 * editor's "Load welcome / Load incident" buttons, and the visual-goldens
 * script all read these files directly.
 *
 * - Both must round-trip through `validateDoc` with zero issues.
 * - Across the two examples, every BlockType must appear at least once.
 *
 * Located in @portable-doc/core because the assertion is about the validator,
 * not about any backend.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateDoc } from './validate.js';
import type { Block, BlockType, PortableDoc } from './ast.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function loadExample(name: 'welcome' | 'incident'): PortableDoc {
  const path = resolve(repoRoot, 'examples', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as PortableDoc;
}

const welcome = loadExample('welcome');
const incident = loadExample('incident');

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

describe('examples', () => {
  it('welcome validates', () => {
    expect(validateDoc(welcome)).toEqual([]);
  });

  it('incident validates', () => {
    expect(validateDoc(incident)).toEqual([]);
  });

  it('coverage: every block type appears across the two examples', () => {
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
