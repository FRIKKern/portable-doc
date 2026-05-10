/**
 * @vitest-environment jsdom
 *
 * Variant-section coverage for BlockForm (post-A4):
 *   - the <details data-testid="variant-section"> wrapper renders only when
 *     the block has a VARIANT_CATALOG entry; the picker grid lives inside.
 *   - hidden entirely for catalog-less blocks (heading, paragraph, …).
 *   - reducer round-trips multi-axis variants written by the picker.
 *
 * Grid-rendering / click / keyboard / active-state specs live in
 * VariantPicker.test.tsx.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type {
  Block,
  CalloutBlock,
  HeadingBlock,
  ActionBlock,
  PortableDoc,
} from '@portable-doc/core';

vi.mock('@portable-doc/backend-web/static', () => ({
  renderHtml: () => '<a>preview</a>',
}));

import { BlockForm } from './BlockForm.js';
import { reducer } from './store.js';

const callout = (variant?: Record<string, string>): CalloutBlock => ({
  id: 'c1',
  type: 'callout',
  tone: 'info',
  title: 'Hi',
  content: [{ type: 'text', value: 'body' }],
  ...(variant ? { variant } : {}),
});

const heading = (): HeadingBlock => ({
  id: 'h1',
  type: 'heading',
  level: 2,
  text: 'A heading',
});

const action = (variant?: Record<string, string>): ActionBlock => ({
  id: 'a1',
  type: 'action',
  label: 'Open',
  href: 'https://x',
  priority: 'primary',
  ...(variant ? { variant } : {}),
});

describe('BlockForm — variant section wrapper', () => {
  it('renders the variant-section wrapper for a callout', () => {
    const dispatch = vi.fn();
    render(<BlockForm block={callout()} dispatch={dispatch} />);
    expect(screen.getByTestId('variant-section')).toBeTruthy();
    // Picker grid is inside.
    expect(screen.getByTestId('variant-grid-callout')).toBeTruthy();
  });

  it('renders the variant-section wrapper for an action block (different grid)', () => {
    const dispatch = vi.fn();
    render(<BlockForm block={action()} dispatch={dispatch} />);
    expect(screen.getByTestId('variant-section')).toBeTruthy();
    expect(screen.getByTestId('variant-grid-action')).toBeTruthy();
    expect(screen.queryByTestId('variant-grid-callout')).toBeNull();
  });

  it('hides the variant section for blocks with no catalog entry (heading)', () => {
    const dispatch = vi.fn();
    render(<BlockForm block={heading()} dispatch={dispatch} />);
    expect(screen.queryByTestId('variant-section')).toBeNull();
    expect(screen.queryByTestId('variant-grid-callout')).toBeNull();
  });

  it('multi-axis variants persist into the AST through sequential reducer dispatches', () => {
    const initial: PortableDoc = { version: 1, blocks: [callout()] };
    const afterTone = reducer(initial, {
      kind: 'update',
      blockId: 'c1',
      patch: { variant: { tone: 'warning' } } as Partial<Block>,
    });
    expect((afterTone.blocks[0] as CalloutBlock).variant).toEqual({ tone: 'warning' });

    const afterEmphasis = reducer(afterTone, {
      kind: 'update',
      blockId: 'c1',
      patch: { variant: { tone: 'warning', emphasis: 'bold' } } as Partial<Block>,
    });
    expect((afterEmphasis.blocks[0] as CalloutBlock).variant).toEqual({
      tone: 'warning',
      emphasis: 'bold',
    });
  });
});
