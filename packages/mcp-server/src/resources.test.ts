/**
 * Resource handler tests — five spec-mandated URIs each return a parseable
 * JSON payload with the expected top-level shape.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PortableDoc } from '@portable-doc/core';
import { RESOURCE_LIST, RESOURCE_URIS, readResource } from './resources.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const welcome = JSON.parse(
  readFileSync(resolve(repoRoot, 'examples', 'welcome.json'), 'utf8'),
) as PortableDoc;
const incident = JSON.parse(
  readFileSync(resolve(repoRoot, 'examples', 'incident.json'), 'utf8'),
) as PortableDoc;

describe('resources', () => {
  it('lists exactly the five spec-mandated URIs in the right order', () => {
    expect(RESOURCE_URIS).toEqual([
      'portable-doc://schema/v1',
      'portable-doc://surface-contracts',
      'portable-doc://tokens/default',
      'portable-doc://examples/welcome',
      'portable-doc://examples/incident',
    ]);
    expect(RESOURCE_LIST.map((r) => r.uri)).toEqual(RESOURCE_URIS);
  });

  it('returns parseable JSON for portable-doc://schema/v1 (block-type list + shapes)', () => {
    const out = readResource('portable-doc://schema/v1');
    expect(out.contents).toHaveLength(1);
    const c = out.contents[0]!;
    expect(c.uri).toBe('portable-doc://schema/v1');
    expect(c.mimeType).toBe('application/json');
    const parsed = JSON.parse(c.text) as Record<string, unknown>;
    expect(parsed['version']).toBe(1);
    const blockTypes = parsed['blockTypes'] as string[];
    expect(blockTypes).toContain('heading');
    expect(blockTypes).toContain('table');
    expect(blockTypes).toHaveLength(10);
    expect(parsed['shapes']).toBeTypeOf('object');
  });

  it('returns parseable JSON for portable-doc://surface-contracts (10 block × 5 surface)', () => {
    const out = readResource('portable-doc://surface-contracts');
    const parsed = JSON.parse(out.contents[0]!.text) as Record<string, Record<string, string>>;
    expect(Object.keys(parsed)).toHaveLength(10);
    // image is unsupported on email/tui/text per spec.
    expect(parsed['image']!['email']).toBe('unsupported');
    expect(parsed['image']!['tui']).toBe('unsupported');
    expect(parsed['image']!['text']).toBe('unsupported');
    expect(parsed['heading']!['email']).toBe('native');
  });

  it('returns parseable JSON for portable-doc://tokens/default (color/space/typography)', () => {
    const out = readResource('portable-doc://tokens/default');
    const parsed = JSON.parse(out.contents[0]!.text) as Record<string, unknown>;
    expect(parsed['color']).toBeTypeOf('object');
    expect(parsed['space']).toBeTypeOf('object');
    expect(parsed['typography']).toBeTypeOf('object');
    const color = parsed['color'] as Record<string, unknown>;
    expect(color['tone']).toBeTypeOf('object');
  });

  it('returns parseable JSON for portable-doc://examples/welcome', () => {
    const out = readResource('portable-doc://examples/welcome');
    const parsed = JSON.parse(out.contents[0]!.text);
    expect(parsed).toEqual(welcome);
  });

  it('returns parseable JSON for portable-doc://examples/incident', () => {
    const out = readResource('portable-doc://examples/incident');
    const parsed = JSON.parse(out.contents[0]!.text);
    expect(parsed).toEqual(incident);
  });

  it('throws on an unknown URI', () => {
    expect(() => readResource('portable-doc://nope')).toThrow(/Unknown resource/);
  });
});
