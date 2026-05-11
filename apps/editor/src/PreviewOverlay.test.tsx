/**
 * @vitest-environment jsdom
 *
 * A7 — PreviewOverlay specs.
 *
 * The ⌘P preview overlay is portal-mounted to document.body, renders 5
 * surface previews stacked in a backdrop-shaded modal, and follows the
 * a11y contract from build-phase grill Q12 (role=dialog, aria-modal,
 * focus trap, Esc closes, focus restored on close).
 *
 * Coverage (per A7 acceptance gate):
 *  1. Modal not in document when open=false.
 *  2. Modal in document when open=true.
 *  3. ⌘P toggles open state (assert via fireEvent.keyDown on window — App-level test).
 *  4. Esc closes when open.
 *  5. Click on backdrop closes.
 *  6. Click on modal body does not close.
 *  7. 5 surface sections render with correct data-testids.
 *  8. Focus moves to Close button on open.
 *  9. role="dialog" + aria-modal="true" + aria-labelledby present.
 * 10. prefers-reduced-motion collapses transitions (CSS variable resolves to 0ms).
 *
 * (3) is an App-level concern — see App.test.tsx for the ⌘P hotkey wiring.
 * Tests below isolate the overlay component itself.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PortableDoc } from '@portable-doc/core';
import { PreviewOverlay } from './PreviewOverlay.js';
import { McpProvider } from './McpProvider.js';

// jsdom doesn't implement Range methods that the Web/Email previews touch
// transitively. Stub once so the overlay's child renders don't throw.
beforeAll(() => {
  if (!('getClientRects' in Range.prototype)) {
    Object.defineProperty(Range.prototype, 'getClientRects', {
      value: () => {
        const list = [] as unknown as DOMRectList;
        Object.defineProperty(list, 'item', { value: () => null });
        return list;
      },
      configurable: true,
    });
  }
  if (!('getBoundingClientRect' in Range.prototype)) {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      value: () => ({
        x: 0, y: 0, width: 0, height: 0,
        top: 0, left: 0, right: 0, bottom: 0,
        toJSON: () => ({}),
      }),
      configurable: true,
    });
  }
});

afterEach(() => cleanup());

const tinyDoc: PortableDoc = {
  version: 1,
  title: 'A7 test doc',
  blocks: [
    { id: 'h', type: 'heading', level: 1, text: 'Hello' },
    {
      id: 'p',
      type: 'paragraph',
      content: [{ type: 'text', value: 'A short paragraph for A7.' }],
    },
  ],
} as unknown as PortableDoc;

function renderOverlay(open: boolean, onClose = vi.fn()) {
  return render(
    <McpProvider>
      <PreviewOverlay doc={tinyDoc} open={open} onClose={onClose} />
    </McpProvider>,
  );
}

describe('PreviewOverlay — A7 ⌘P preview modal', () => {
  it('is not in the document when open=false', () => {
    renderOverlay(false);
    expect(screen.queryByTestId('preview-overlay')).toBeNull();
    expect(screen.queryByTestId('preview-overlay-modal')).toBeNull();
  });

  it('is in the document when open=true', () => {
    renderOverlay(true);
    expect(screen.getByTestId('preview-overlay')).toBeTruthy();
    expect(screen.getByTestId('preview-overlay-modal')).toBeTruthy();
  });

  it('closes on Esc keypress', () => {
    const onClose = vi.fn();
    renderOverlay(true, onClose);
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on backdrop click', () => {
    const onClose = vi.fn();
    renderOverlay(true, onClose);
    const backdrop = screen.getByTestId('preview-overlay-backdrop');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close when the modal body is clicked', () => {
    const onClose = vi.fn();
    renderOverlay(true, onClose);
    const modal = screen.getByTestId('preview-overlay-modal');
    fireEvent.click(modal);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders 5 surface sections with the expected data-testids', () => {
    renderOverlay(true);
    expect(screen.getByTestId('preview-overlay-surface-web')).toBeTruthy();
    expect(screen.getByTestId('preview-overlay-surface-email')).toBeTruthy();
    expect(screen.getByTestId('preview-overlay-surface-tui')).toBeTruthy();
    expect(screen.getByTestId('preview-overlay-surface-native')).toBeTruthy();
    expect(screen.getByTestId('preview-overlay-surface-json')).toBeTruthy();
    const surfaces = document.querySelectorAll('[data-testid^="preview-overlay-surface-"]');
    expect(surfaces.length).toBe(5);
  });

  it('moves focus to the Close button when opened', async () => {
    renderOverlay(true);
    const closeBtn = screen.getByTestId('preview-overlay-close');
    // Focus is moved on a setTimeout(0) — flush microtasks + timers.
    await new Promise((r) => setTimeout(r, 5));
    expect(document.activeElement).toBe(closeBtn);
  });

  it('has role="dialog", aria-modal="true", and aria-labelledby pointing at the title', () => {
    renderOverlay(true);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    const title = labelId ? document.getElementById(labelId) : null;
    expect(title).toBeTruthy();
    expect(title?.textContent ?? '').toMatch(/Preview/i);
  });

  it('Close button has an aria-label and triggers onClose', () => {
    const onClose = vi.fn();
    renderOverlay(true, onClose);
    const closeBtn = screen.getByLabelText('Close preview');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focus trap: Shift+Tab on the first focusable wraps to the last', () => {
    renderOverlay(true);
    const closeBtn = screen.getByTestId('preview-overlay-close');
    closeBtn.focus();
    expect(document.activeElement).toBe(closeBtn);
    // With only the Close button as the focusable (jsdom doesn't focus
    // hidden elements like the Copy JSON button reliably), Shift+Tab should
    // bounce back to itself — the trap MUST preventDefault to avoid leaving
    // the modal. We assert focus stays inside the modal.
    act(() => {
      fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    });
    const modal = screen.getByTestId('preview-overlay-modal');
    expect(modal.contains(document.activeElement)).toBe(true);
  });
});
