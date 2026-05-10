/**
 * @vitest-environment happy-dom
 *
 * Variant-section coverage for BlockForm (T4):
 *   - dropdowns render only when the block type has a VARIANT_CATALOG entry
 *   - changing a dropdown dispatches an update action with merged axes
 *   - multi-axis variants persist through sequential changes
 *   - the swatch preview shows when every axis is set; the placeholder shows
 *     while at least one axis is missing
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type {
  Block,
  CalloutBlock,
  HeadingBlock,
  ActionBlock,
  PortableDoc,
} from '@portable-doc/core';
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

describe('BlockForm — variant section', () => {
  it('renders tone + emphasis dropdowns for a callout', () => {
    const dispatch = vi.fn();
    render(<BlockForm block={callout()} dispatch={dispatch} />);
    expect(screen.getByTestId('variant-section')).toBeTruthy();
    expect(screen.getByTestId('variant-tone')).toBeTruthy();
    expect(screen.getByTestId('variant-emphasis')).toBeTruthy();
  });

  it('hides the variant section for blocks with no catalog entry (heading)', () => {
    const dispatch = vi.fn();
    render(<BlockForm block={heading()} dispatch={dispatch} />);
    expect(screen.queryByTestId('variant-section')).toBeNull();
    expect(screen.queryByTestId('variant-tone')).toBeNull();
  });

  it('changing a variant dropdown dispatches an update with merged axes', () => {
    const dispatch = vi.fn();
    render(<BlockForm block={callout({ tone: 'info', emphasis: 'subtle' })} dispatch={dispatch} />);
    fireEvent.change(screen.getByTestId('variant-tone'), { target: { value: 'success' } });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const arg = dispatch.mock.calls[0]?.[0] as {
      kind: string;
      blockId: string;
      patch: { variant?: Record<string, string> };
    };
    expect(arg.kind).toBe('update');
    expect(arg.blockId).toBe('c1');
    expect(arg.patch.variant).toEqual({ tone: 'success', emphasis: 'subtle' });
  });

  it('multi-axis variants persist into the AST through sequential changes', () => {
    const initial: PortableDoc = {
      version: 1,
      blocks: [callout()],
    };

    // Step 1: dispatch sets tone — emphasis still absent.
    const afterTone = reducer(initial, {
      kind: 'update',
      blockId: 'c1',
      patch: { variant: { tone: 'warning' } } as Partial<Block>,
    });
    const c1 = afterTone.blocks[0] as CalloutBlock;
    expect(c1.variant).toEqual({ tone: 'warning' });

    // Step 2: dispatch sets emphasis — UI computes merged {tone, emphasis}
    // from current.variant before dispatching, so reducer just stores it.
    const afterEmphasis = reducer(afterTone, {
      kind: 'update',
      blockId: 'c1',
      patch: { variant: { tone: 'warning', emphasis: 'bold' } } as Partial<Block>,
    });
    const c2 = afterEmphasis.blocks[0] as CalloutBlock;
    expect(c2.variant).toEqual({ tone: 'warning', emphasis: 'bold' });
  });

  it('VariantSection itself merges current axes when the user changes only one', () => {
    // This covers the UI-side merge: the dropdown change fires once with the
    // FULL merged variant object, not just the changed axis.
    const dispatch = vi.fn();
    render(
      <BlockForm
        block={callout({ tone: 'info', emphasis: 'subtle' })}
        dispatch={dispatch}
      />,
    );
    fireEvent.change(screen.getByTestId('variant-emphasis'), { target: { value: 'bold' } });
    const arg = dispatch.mock.calls[0]?.[0] as {
      patch: { variant?: Record<string, string> };
    };
    expect(arg.patch.variant).toEqual({ tone: 'info', emphasis: 'bold' });
  });

  it('swatch preview renders when every axis is set; placeholder when not', () => {
    const dispatchA = vi.fn();
    const { unmount } = render(
      <BlockForm
        block={callout({ tone: 'success', emphasis: 'bold' })}
        dispatch={dispatchA}
      />,
    );
    expect(screen.getByTestId('variant-swatch')).toBeTruthy();
    expect(screen.queryByTestId('variant-swatch-placeholder')).toBeNull();
    unmount();

    // No variant set on the block — the dropdowns SHOW first allowed values
    // visually but block.variant is still empty, so resolveVariant throws
    // (missing axes) and we render the placeholder.
    const dispatchB = vi.fn();
    render(<BlockForm block={callout()} dispatch={dispatchB} />);
    expect(screen.getByTestId('variant-swatch-placeholder')).toBeTruthy();
    expect(screen.queryByTestId('variant-swatch')).toBeNull();
  });

  it('action block surfaces priority + size axes (different catalog shape)', () => {
    const dispatch = vi.fn();
    render(<BlockForm block={action({ priority: 'primary', size: 'medium' })} dispatch={dispatch} />);
    expect(screen.getByTestId('variant-priority')).toBeTruthy();
    expect(screen.getByTestId('variant-size')).toBeTruthy();
    // No tone axis on action.
    expect(screen.queryByTestId('variant-tone')).toBeNull();
  });
});
