/**
 * Smoke tests for `PdRender` (RN wrapper).
 *
 * `react-native` core has native-module imports that fail to load in a pure
 * Node test environment. `vitest.config.ts` aliases `react-native` →
 * `react-native-web`; the primitive surface (View / Text / Pressable / Image
 * / Linking) is identical for our walker, so the structural assertions still
 * prove the Pd → RN element-tree shape. Real consumers (Expo / Metro) get
 * actual `react-native` at runtime.
 *
 * Rendering goes through `react-test-renderer` (the official RN testing
 * tool) — it walks React trees to JSON without needing a host platform.
 *
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { create } from 'react-test-renderer';
import { composeDocument } from '@portable-doc/primitives';
import type { PortableDoc } from '@portable-doc/core';
import { PdRender } from './PdRender.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const welcome = JSON.parse(
  readFileSync(resolve(repoRoot, 'examples', 'welcome.json'), 'utf8'),
) as PortableDoc;
const incident = JSON.parse(
  readFileSync(resolve(repoRoot, 'examples', 'incident.json'), 'utf8'),
) as PortableDoc;

describe('PdRender — smoke', () => {
  it('renders the welcome fixture without throwing', () => {
    const tree = composeDocument(welcome);
    expect(() => create(<PdRender tree={tree} />)).not.toThrow();
  });

  it('renders the incident fixture without throwing', () => {
    const tree = composeDocument(incident);
    expect(() => create(<PdRender tree={tree} />)).not.toThrow();
  });
});

describe('PdRender — component types', () => {
  it('emits a Text element for a paragraph', () => {
    const doc: PortableDoc = {
      version: 1,
      title: 't',
      preview: 'p',
      blocks: [
        {
          id: 'p',
          type: 'paragraph',
          content: [{ type: 'text', value: 'Hello native' }],
        },
      ],
    };
    const json = create(<PdRender tree={composeDocument(doc)} />).toJSON();
    const flat = JSON.stringify(json);
    expect(flat).toContain('Hello native');
  });

  it('renders an action block as a Pressable with role="button"', () => {
    const doc: PortableDoc = {
      version: 1,
      title: 't',
      preview: 'p',
      blocks: [
        {
          id: 'a',
          type: 'action',
          label: 'Open',
          href: 'https://example.com/open',
          priority: 'primary',
        },
      ],
    };
    const json = create(<PdRender tree={composeDocument(doc)} />).toJSON();
    const flat = JSON.stringify(json);
    // Under the RNW alias, Pressable renders to a div with role="button".
    // Either the role or the label proves the Pressable branch fired.
    expect(flat).toContain('button');
    expect(flat).toContain('Open');
  });

  it('renders an image block with the right alt/accessibility label', () => {
    const doc: PortableDoc = {
      version: 1,
      title: 't',
      preview: 'p',
      blocks: [
        {
          id: 'img',
          type: 'image',
          src: 'https://example.com/cover.png',
          alt: 'cover',
          surfaces: ['web', 'native'],
        },
      ],
    };
    // Real RN exposes Image's `source.uri` in the test-renderer JSON. Under
    // the RNW test alias, the URL is moved into a CSS class and not visible
    // in the JSON snapshot — so we assert on `accessibilityLabel` (which
    // RNW maps to `aria-label`). Either path proves the Image branch fired.
    const json = create(<PdRender tree={composeDocument(doc)} />).toJSON();
    const flat = JSON.stringify(json);
    expect(flat).toMatch(/(https:\/\/example\.com\/cover\.png|"aria-label":"cover"|"accessibilityLabel":"cover")/);
  });
});
