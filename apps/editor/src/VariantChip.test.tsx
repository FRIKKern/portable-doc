// @vitest-environment jsdom
/**
 * A5 — VariantChip specs (~11 covering the inline-chip contract).
 *
 * The chip lives in the chrome's `data-block-type` variant slot. It renders
 * nothing for non-variant block types; for callout/action/section/code it
 * shows a compact summary that expands on click into a `role="listbox"`
 * palette of options. Hybrid rendering matches v0.3:
 *   - callout/section/code → CSS-direct PdStyle projection
 *   - action               → backend-web/static `renderHtml` round-trip
 *
 * The slot integration is exercised in BlockChrome.test.tsx and the existing
 * extensions/withBlockChrome.test.tsx (A2). A separate spec here asserts
 * `mountVariantChip` paints into the slot for a `blockquote → callout`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const renderHtmlMock = vi.fn((_root: unknown, _opts?: unknown) => '<a data-mock-action="1">btn</a>');
vi.mock('@portable-doc/backend-web/static', () => ({
  renderHtml: (root: unknown, opts?: unknown) => renderHtmlMock(root, opts),
}));

import { VariantChip } from './VariantChip.js';
import { pdBlockTypeFor } from './BlockChrome.js';

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// 1. Non-variant blocks render nothing.
// ---------------------------------------------------------------------------

describe('VariantChip — non-variant block types render null', () => {
  it.each(['paragraph', 'heading', 'list', 'divider', 'image', 'table'])(
    '%s → renders nothing',
    (blockType) => {
      const { container } = render(
        <VariantChip blockType={blockType} attrs={{}} onChange={() => {}} />,
      );
      expect(container.firstChild).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// 2. Variant blocks render a chip.
// ---------------------------------------------------------------------------

describe('VariantChip — variant block types render the chip', () => {
  it.each(['callout', 'action', 'section', 'code'])(
    '%s → renders the chip with a current-state button',
    (blockType) => {
      render(<VariantChip blockType={blockType} attrs={{}} onChange={() => {}} />);
      const chip = screen.getByTestId(`variant-chip-${blockType}`);
      expect(chip).toBeTruthy();
      const current = screen.getByTestId(`variant-chip-current-${blockType}`);
      expect(current.getAttribute('aria-expanded')).toBe('false');
      expect(current.getAttribute('aria-haspopup')).toBe('listbox');
    },
  );
});

// ---------------------------------------------------------------------------
// 3. Option counts per block type.
// ---------------------------------------------------------------------------

describe('VariantChip — palette option counts per catalog', () => {
  it('callout chip shows 10 options on click (5 tones × 2 emphases)', () => {
    render(<VariantChip blockType="callout" attrs={{}} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('variant-chip-current-callout'));
    const palette = screen.getByTestId('variant-chip-palette-callout');
    expect(palette.getAttribute('role')).toBe('listbox');
    const options = palette.querySelectorAll('[role="option"]');
    expect(options.length).toBe(10);
  });

  it('action chip shows 4 options on click (2 priorities × 2 sizes)', () => {
    render(<VariantChip blockType="action" attrs={{}} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('variant-chip-current-action'));
    const options = screen
      .getByTestId('variant-chip-palette-action')
      .querySelectorAll('[role="option"]');
    expect(options.length).toBe(4);
  });

  it('section chip shows 3 options on click (one per density)', () => {
    render(<VariantChip blockType="section" attrs={{}} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('variant-chip-current-section'));
    const options = screen
      .getByTestId('variant-chip-palette-section')
      .querySelectorAll('[role="option"]');
    expect(options.length).toBe(3);
  });

  it('code chip shows 4 options on click (2 themes × 2 densities)', () => {
    render(<VariantChip blockType="code" attrs={{}} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('variant-chip-current-code'));
    const options = screen
      .getByTestId('variant-chip-palette-code')
      .querySelectorAll('[role="option"]');
    expect(options.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 4. onChange merges axes.
// ---------------------------------------------------------------------------

describe('VariantChip — onChange propagates merged axes', () => {
  it('clicking a callout option calls onChange with that axes set', () => {
    const onChange = vi.fn();
    render(<VariantChip blockType="callout" attrs={{}} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('variant-chip-current-callout'));
    fireEvent.click(screen.getByTestId('variant-chip-option-callout-success-bold'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toEqual({ tone: 'success', emphasis: 'bold' });
  });

  it('clicking an action option fires onChange with priority + size', () => {
    const onChange = vi.fn();
    render(<VariantChip blockType="action" attrs={{}} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('variant-chip-current-action'));
    fireEvent.click(screen.getByTestId('variant-chip-option-action-primary-large'));
    expect(onChange).toHaveBeenCalledWith({ priority: 'primary', size: 'large' });
  });
});

// ---------------------------------------------------------------------------
// 5. Active option carries aria-selected="true".
// ---------------------------------------------------------------------------

describe('VariantChip — active option indication', () => {
  it('active option has aria-selected="true"; others are false', () => {
    render(
      <VariantChip
        blockType="callout"
        attrs={{ variant: { tone: 'warning', emphasis: 'subtle' } }}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('variant-chip-current-callout'));
    const active = screen.getByTestId('variant-chip-option-callout-warning-subtle');
    expect(active.getAttribute('aria-selected')).toBe('true');
    const other = screen.getByTestId('variant-chip-option-callout-danger-bold');
    expect(other.getAttribute('aria-selected')).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// 6. Esc closes the palette (a11y; grill Q12).
// ---------------------------------------------------------------------------

describe('VariantChip — keyboard a11y', () => {
  it('Esc closes the open palette', () => {
    render(<VariantChip blockType="callout" attrs={{}} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('variant-chip-current-callout'));
    expect(screen.queryByTestId('variant-chip-palette-callout')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('variant-chip-palette-callout')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Hybrid render — callout uses CSS-direct; action uses backend-web mock.
// ---------------------------------------------------------------------------

describe('VariantChip — hybrid render (callout vs action)', () => {
  it('callout palette uses CSS-direct projection (no renderHtml calls)', () => {
    renderHtmlMock.mockClear();
    render(<VariantChip blockType="callout" attrs={{}} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('variant-chip-current-callout'));
    expect(renderHtmlMock).not.toHaveBeenCalled();
    // border-left-color is the CSS-direct fingerprint (callouts use border-left only).
    const option = screen.getByTestId('variant-chip-option-callout-success-subtle');
    expect(option.outerHTML).toMatch(/border-left-color/i);
  });

  it('action palette round-trips through backend-web/static renderHtml (4 calls)', () => {
    renderHtmlMock.mockClear();
    render(<VariantChip blockType="action" attrs={{}} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId('variant-chip-current-action'));
    expect(renderHtmlMock).toHaveBeenCalledTimes(4);
    const preview = screen.getByTestId('variant-chip-action-preview-primary-medium');
    expect(preview.innerHTML).toMatch(/data-mock-action="1"/);
  });
});

// ---------------------------------------------------------------------------
// 8. pdBlockTypeFor — pure mapping from TipTap node name to PortableDoc
// variant type. (The legacy `mountVariantChip` integration tests have been
// removed — the chip is now a direct child of `BlockChromeView.tsx` and
// covered end-to-end by the React NodeView integration tests.)
// ---------------------------------------------------------------------------

describe('pdBlockTypeFor', () => {
  it('translates TipTap names to PortableDoc variant types', () => {
    expect(pdBlockTypeFor('blockquote')).toBe('callout');
    expect(pdBlockTypeFor('codeBlock')).toBe('code');
    expect(pdBlockTypeFor('paragraph')).toBeNull();
    expect(pdBlockTypeFor('heading')).toBeNull();
    expect(pdBlockTypeFor('bulletList')).toBeNull();
  });
});
