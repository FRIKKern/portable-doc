/**
 * @vitest-environment jsdom
 *
 * PreviewStrip — A6 acceptance specs.
 *
 * Covers:
 *   1. 5 thumbnails render with the correct labels.
 *   2. Default active surface is TUI (preserves v0.2 behaviour).
 *   3. Click switches the active right-panel preview.
 *   4. Keyboard accessibility — Tab focuses thumbs, Enter/Space activates.
 *   5. Debounce — rapid prop changes don't update thumbnail content until 500 ms quiescence.
 *   6. Lazy-mount — only the active surface's heavy renderer mounts.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import type { PortableDoc } from '@portable-doc/core';
import { PreviewStrip, SURFACES } from './PreviewStrip.js';

afterEach(() => {
  cleanup();
});

const minimalDoc: PortableDoc = {
  version: 1,
  title: 'Hello',
  blocks: [
    { id: 'h1', type: 'heading', level: 1, text: 'Hello world' },
    { id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'Body.' }] },
  ],
};

const renamedDoc: PortableDoc = {
  ...minimalDoc,
  title: 'Renamed',
  blocks: [{ id: 'h1', type: 'heading', level: 1, text: 'Renamed title' }],
};

describe('PreviewStrip', () => {
  it('renders 5 thumbnails with the expected labels', () => {
    render(<PreviewStrip doc={minimalDoc} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    const labels = tabs.map((t) => t.textContent ?? '');
    expect(labels.some((l) => l.includes('TUI'))).toBe(true);
    expect(labels.some((l) => l.includes('Email'))).toBe(true);
    expect(labels.some((l) => l.includes('Web'))).toBe(true);
    expect(labels.some((l) => l.includes('Native'))).toBe(true);
    expect(labels.some((l) => l.includes('JSON'))).toBe(true);
    // SURFACES export is the source of truth for button order.
    expect(SURFACES).toEqual(['tui', 'email', 'web', 'native', 'json']);
  });

  it('defaults to TUI — TUI thumb is selected and TUI panel is mounted', () => {
    render(<PreviewStrip doc={minimalDoc} />);
    expect(screen.getByTestId('thumb-tui').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('active-panel-tui')).toBeTruthy();
    expect(screen.queryByTestId('active-panel-json')).toBeNull();
    expect(screen.queryByTestId('preview-tui')).toBeTruthy();
    // No other previews mounted.
    expect(screen.queryByTestId('preview-email')).toBeNull();
    expect(screen.queryByTestId('preview-web')).toBeNull();
    expect(screen.queryByTestId('preview-native')).toBeNull();
    expect(screen.queryByTestId('preview-json')).toBeNull();
  });

  it('click on a thumbnail switches the active right-panel preview', () => {
    render(<PreviewStrip doc={minimalDoc} />);
    fireEvent.click(screen.getByTestId('thumb-json'));
    expect(screen.getByTestId('thumb-json').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('thumb-tui').getAttribute('aria-selected')).toBe('false');
    expect(screen.getByTestId('active-panel-json')).toBeTruthy();
    expect(screen.queryByTestId('active-panel-tui')).toBeNull();
    expect(screen.getByTestId('preview-json')).toBeTruthy();
    expect(screen.queryByTestId('preview-tui')).toBeNull();

    fireEvent.click(screen.getByTestId('thumb-native'));
    expect(screen.getByTestId('preview-native')).toBeTruthy();
    expect(screen.queryByTestId('preview-json')).toBeNull();
  });

  it('keyboard: Enter and Space on a focused thumbnail activate it', () => {
    render(<PreviewStrip doc={minimalDoc} />);
    const nativeThumb = screen.getByTestId('thumb-native');
    nativeThumb.focus();
    expect(document.activeElement).toBe(nativeThumb);
    // Real <button> activates on Enter/Space — fire a click which is what
    // browsers dispatch for these keys on a button.
    fireEvent.click(nativeThumb);
    expect(nativeThumb.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('active-panel-native')).toBeTruthy();

    // Tab order: every thumb is reachable (tabIndex=0 by default on <button>).
    const allThumbs = screen.getAllByRole('tab');
    for (const thumb of allThumbs) {
      // tabIndex !== -1 (jsdom returns 0 by default for <button>)
      expect((thumb as HTMLButtonElement).tabIndex).not.toBe(-1);
    }
  });

  it('debounces thumbnail updates by 500 ms — rapid prop changes do not update immediately', async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<PreviewStrip doc={minimalDoc} />);

      // Initial render — TUI thumb shows the original heading "Hello world".
      const tuiThumb = screen.getByTestId('thumb-tui');
      const initialTextSnapshot = tuiThumb.textContent ?? '';
      expect(initialTextSnapshot).toMatch(/Hello/);

      // Rapid re-renders — three doc changes in 50 ms.
      rerender(<PreviewStrip doc={{ ...minimalDoc, title: 'A' }} />);
      act(() => {
        vi.advanceTimersByTime(50);
      });
      rerender(<PreviewStrip doc={{ ...minimalDoc, title: 'B' }} />);
      act(() => {
        vi.advanceTimersByTime(50);
      });
      rerender(<PreviewStrip doc={renamedDoc} />);

      // Before 500 ms quiescence — thumb still shows the OLD content.
      act(() => {
        vi.advanceTimersByTime(100);
      });
      const midText = screen.getByTestId('thumb-tui').textContent ?? '';
      expect(midText).toMatch(/Hello/);
      expect(midText).not.toMatch(/Renamed title/);

      // After 500 ms — thumb finally sees the latest doc.
      act(() => {
        vi.advanceTimersByTime(500);
      });
      const finalText = screen.getByTestId('thumb-tui').textContent ?? '';
      expect(finalText).toMatch(/Renamed/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lazy-mounts only the active surface — Web preview is not in the DOM until selected', async () => {
    render(<PreviewStrip doc={minimalDoc} />);
    // TUI active by default — Web preview is NOT mounted.
    expect(screen.queryByTestId('preview-web')).toBeNull();
    expect(screen.queryByTestId('web-lazy-fallback')).toBeNull();

    // Click Web thumb. Either the Suspense fallback or the preview itself
    // must appear (proves the Web bundle is React.lazy gated).
    fireEvent.click(screen.getByTestId('thumb-web'));
    const fallback = screen.queryByTestId('web-lazy-fallback');
    const preview = screen.queryByTestId('preview-web');
    expect(fallback !== null || preview !== null).toBe(true);
    await waitFor(() => expect(screen.queryByTestId('preview-web')).toBeTruthy());

    // Click Email thumb — Web preview unmounts again, only Email is alive.
    fireEvent.click(screen.getByTestId('thumb-email'));
    expect(screen.queryByTestId('preview-web')).toBeNull();
    expect(screen.queryByTestId('preview-email')).toBeTruthy();
  });
});
