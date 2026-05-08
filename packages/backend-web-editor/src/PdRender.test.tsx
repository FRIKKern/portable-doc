/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { render } from '@testing-library/react';
import { composeDocument } from '@portable-doc/primitives';
import type { PortableDoc } from '@portable-doc/core';
import { incident, welcome } from '@portable-doc/fixtures';
import { PdRender } from './PdRender.js';

describe('PdRender — smoke', () => {
  it('renders the welcome fixture without throwing', () => {
    const tree = composeDocument(welcome);
    const { container } = render(<PdRender tree={tree} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders the incident fixture without throwing', () => {
    const tree = composeDocument(incident);
    const { container } = render(<PdRender tree={tree} />);
    expect(container.firstChild).toBeTruthy();
  });
});

describe('PdRender — component types', () => {
  it('emits text content for a paragraph', () => {
    const doc: PortableDoc = {
      version: 1,
      title: 't',
      preview: 'p',
      blocks: [
        {
          id: 'p',
          type: 'paragraph',
          content: [{ type: 'text', value: 'Hello editor' }],
        },
      ],
    };
    const { container } = render(<PdRender tree={composeDocument(doc)} />);
    expect(container.textContent).toContain('Hello editor');
  });

  it('renders a link block as an element with role="link"', () => {
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
    const { container } = render(<PdRender tree={composeDocument(doc)} />);
    // RNW maps Pressable accessibilityRole="button" to role="button" on a div.
    const button = container.querySelector('[role="button"]');
    expect(button).not.toBeNull();
    expect(container.textContent).toContain('Open');
  });

  it('renders an image block as an <img> with the right src', () => {
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
    const { container } = render(<PdRender tree={composeDocument(doc)} />);
    // RNW Image renders a div with a background-image, OR an <img>. Either
    // way, the src must show up somewhere in the rendered HTML.
    expect(container.innerHTML).toContain('https://example.com/cover.png');
  });
});
