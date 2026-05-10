// @vitest-environment jsdom
/**
 * VariantPicker — A4 thumbnail-grid coverage.
 *
 * Hybrid rendering per grill q4:
 *   - callout / section / code → CSS-direct projection (tone, border-left,
 *     bg are visible in the inline style attribute).
 *   - action → backend-web/static `renderHtml` round-trip; the mock asserts
 *     the call happened once per variant tile.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type {
  ActionBlock,
  CalloutBlock,
  CodeBlock,
  SectionBlock,
} from '@portable-doc/core';

const renderHtmlMock = vi.fn((_root: unknown, _opts?: unknown) => '<a>preview</a>');
vi.mock('@portable-doc/backend-web/static', () => ({
  renderHtml: (root: unknown, opts?: unknown) => renderHtmlMock(root, opts),
}));

import { VariantPicker } from './VariantPicker.js';

const callout = (variant?: Record<string, string>): CalloutBlock => ({
  id: 'c1',
  type: 'callout',
  tone: 'info',
  title: 'Hi',
  content: [{ type: 'text', value: 'body' }],
  ...(variant ? { variant } : {}),
});

const action = (variant?: Record<string, string>): ActionBlock => ({
  id: 'a1',
  type: 'action',
  label: 'Open',
  href: 'https://example.com',
  priority: 'primary',
  ...(variant ? { variant } : {}),
});

const section = (variant?: Record<string, string>): SectionBlock => ({
  id: 's1',
  type: 'section',
  blocks: [],
  ...(variant ? { variant } : {}),
});

const code = (variant?: Record<string, string>): CodeBlock => ({
  id: 'k1',
  type: 'code',
  value: 'x=1',
  ...(variant ? { variant } : {}),
});

describe('VariantPicker — callout (CSS-direct path)', () => {
  it('renders 10 callout thumbnails (5 tones × 2 emphases)', () => {
    const dispatch = vi.fn();
    render(<VariantPicker block={callout()} dispatch={dispatch} />);
    const tones = ['success', 'warning', 'danger', 'info', 'neutral'];
    const emphases = ['subtle', 'bold'];
    let n = 0;
    for (const tone of tones) {
      for (const emphasis of emphases) {
        expect(screen.getByTestId(`variant-callout-${tone}-${emphasis}`)).toBeTruthy();
        n += 1;
      }
    }
    expect(n).toBe(10);
  });

  it('clicking variant-callout-success-bold dispatches merged axes + mirrors tone', () => {
    const dispatch = vi.fn();
    render(<VariantPicker block={callout()} dispatch={dispatch} />);
    fireEvent.click(screen.getByTestId('variant-callout-success-bold'));
    expect(dispatch).toHaveBeenCalledTimes(1);
    const arg = dispatch.mock.calls[0]?.[0] as {
      kind: string;
      blockId: string;
      patch: { variant?: Record<string, string>; tone?: string };
    };
    expect(arg.kind).toBe('update');
    expect(arg.blockId).toBe('c1');
    expect(arg.patch.variant).toEqual({ tone: 'success', emphasis: 'bold' });
    expect(arg.patch.tone).toBe('success');
  });

  it('CalloutGrid card carries inline CSS derived from resolveVariant', () => {
    const dispatch = vi.fn();
    render(<VariantPicker block={callout()} dispatch={dispatch} />);
    const card = screen.getByTestId('variant-callout-success-bold');
    // Inline preview div is the first child div after the absolute checkmark
    // span; its style attribute should carry the resolved palette colour as a
    // border-left value.
    const html = card.outerHTML;
    expect(html).toMatch(/border-left-color/i);
    expect(html).toMatch(/background-color/i);
  });

  it('active variant has aria-selected="true" and a checkmark', () => {
    const dispatch = vi.fn();
    render(
      <VariantPicker
        block={callout({ tone: 'warning', emphasis: 'subtle' })}
        dispatch={dispatch}
      />,
    );
    const active = screen.getByTestId('variant-callout-warning-subtle');
    expect(active.getAttribute('aria-selected')).toBe('true');
    expect(active.textContent).toMatch(/✓/);
    const inactive = screen.getByTestId('variant-callout-success-bold');
    expect(inactive.getAttribute('aria-selected')).toBe('false');
  });

  it('keyboard Enter on a focused card applies the variant', () => {
    const dispatch = vi.fn();
    render(<VariantPicker block={callout()} dispatch={dispatch} />);
    const card = screen.getByTestId('variant-callout-danger-bold');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const arg = dispatch.mock.calls[0]?.[0] as {
      patch: { variant?: Record<string, string> };
    };
    expect(arg.patch.variant).toEqual({ tone: 'danger', emphasis: 'bold' });
  });
});

describe('VariantPicker — action (backend-web/static round-trip path)', () => {
  it('renders 4 action thumbnails (2 priorities × 2 sizes)', () => {
    renderHtmlMock.mockClear();
    const dispatch = vi.fn();
    render(<VariantPicker block={action()} dispatch={dispatch} />);
    for (const priority of ['primary', 'secondary']) {
      for (const size of ['medium', 'large']) {
        expect(screen.getByTestId(`variant-action-${priority}-${size}`)).toBeTruthy();
      }
    }
  });

  it('invokes backend-web/static renderHtml for each of the 4 action variants', () => {
    renderHtmlMock.mockClear();
    const dispatch = vi.fn();
    render(<VariantPicker block={action()} dispatch={dispatch} />);
    expect(renderHtmlMock).toHaveBeenCalledTimes(4);
  });

  it('clicking variant-action-primary-large dispatches priority + size + mirror', () => {
    const dispatch = vi.fn();
    render(<VariantPicker block={action()} dispatch={dispatch} />);
    fireEvent.click(screen.getByTestId('variant-action-primary-large'));
    const arg = dispatch.mock.calls[0]?.[0] as {
      patch: { variant?: Record<string, string>; priority?: string };
    };
    expect(arg.patch.variant).toEqual({ priority: 'primary', size: 'large' });
    expect(arg.patch.priority).toBe('primary');
  });

  it('CSS-direct path (pdStyleToCss) is NOT used for action — preview HTML comes from renderHtml mock', () => {
    renderHtmlMock.mockClear();
    renderHtmlMock.mockReturnValue('<span data-from-mock="1">btn</span>');
    const dispatch = vi.fn();
    render(<VariantPicker block={action()} dispatch={dispatch} />);
    const preview = screen.getByTestId('variant-action-preview-primary-medium');
    expect(preview.innerHTML).toMatch(/data-from-mock="1"/);
  });
});

describe('VariantPicker — section + code (CSS-direct path)', () => {
  it('section grid renders 3 cards (one per density)', () => {
    const dispatch = vi.fn();
    render(<VariantPicker block={section()} dispatch={dispatch} />);
    for (const density of ['compact', 'comfortable', 'spacious']) {
      expect(screen.getByTestId(`variant-section-${density}`)).toBeTruthy();
    }
  });

  it('code grid renders 4 cards (2 themes × 2 densities)', () => {
    const dispatch = vi.fn();
    render(<VariantPicker block={code()} dispatch={dispatch} />);
    for (const theme of ['light', 'dark']) {
      for (const density of ['normal', 'compact']) {
        expect(screen.getByTestId(`variant-code-${theme}-${density}`)).toBeTruthy();
      }
    }
  });
});
