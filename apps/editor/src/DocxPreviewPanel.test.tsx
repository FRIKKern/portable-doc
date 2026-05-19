/**
 * Pioneer move A — DocxPreviewPanel specs.
 *
 * Coverage:
 *   1. Returns null when visible=false (no panel mounts).
 *   2. Renders the title chrome when visible=true.
 *   3. Calls toDocxBlob with the provided doc after the 500ms debounce.
 *   4. Clears the container + re-renders when the doc reference changes.
 *   5. Surfaces "Rendering preview…" while toDocxBlob is in flight.
 *   6. Surfaces "Preview failed: {message}" when render throws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { PortableDoc } from '@portable-doc/core';

// Mock `docx-preview`'s renderAsync first so the component imports the spy.
const renderAsyncMock = vi.fn().mockResolvedValue(undefined);
vi.mock('docx-preview', () => ({
  renderAsync: (...args: unknown[]) => renderAsyncMock(...args),
}));

// Mock the serializer so we observe doc plumbing without exercising the
// heavyweight `docx` package on every render.
const toDocxBlobMock = vi.fn(
  async (_doc: unknown) =>
    new Blob(['docx'], { type: 'application/octet-stream' }),
);
vi.mock('./export/toDocx.js', () => ({
  toDocxBlob: (doc: unknown) => toDocxBlobMock(doc),
}));

import { DocxPreviewPanel } from './DocxPreviewPanel.js';

const docA: PortableDoc = {
  version: 1,
  title: 'Doc A',
  blocks: [{ id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'one' }] }],
};
const docB: PortableDoc = {
  version: 1,
  title: 'Doc B',
  blocks: [{ id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'two' }] }],
};

beforeEach(() => {
  vi.useFakeTimers();
  renderAsyncMock.mockClear();
  renderAsyncMock.mockResolvedValue(undefined);
  toDocxBlobMock.mockClear();
  toDocxBlobMock.mockResolvedValue(
    new Blob(['docx'], { type: 'application/octet-stream' }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/** Advance past the 500ms debounce and flush any pending promise jobs so
 *  React commits the post-render state updates. */
async function flushDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  // Two ticks: one for toDocxBlob's resolution, one for renderAsync's.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DocxPreviewPanel', () => {
  it('returns null when visible=false', () => {
    const { container } = render(
      <DocxPreviewPanel doc={docA} visible={false} />,
    );
    expect(container.querySelector('[data-testid="docx-preview-panel"]')).toBeNull();
    expect(toDocxBlobMock).not.toHaveBeenCalled();
  });

  it('renders the title chrome when visible=true', () => {
    render(<DocxPreviewPanel doc={docA} visible={true} />);
    expect(screen.getByTestId('docx-preview-panel')).toBeTruthy();
    expect(screen.getByTestId('docx-preview-title').textContent).toContain(
      'Word preview',
    );
  });

  it('calls toDocxBlob with the provided doc after the debounce', async () => {
    render(<DocxPreviewPanel doc={docA} visible={true} />);
    expect(toDocxBlobMock).not.toHaveBeenCalled();
    await flushDebounce();
    expect(toDocxBlobMock).toHaveBeenCalledTimes(1);
    expect(toDocxBlobMock).toHaveBeenCalledWith(docA);
    expect(renderAsyncMock).toHaveBeenCalledTimes(1);
  });

  it('re-renders the panel when the doc reference changes', async () => {
    const { rerender } = render(
      <DocxPreviewPanel doc={docA} visible={true} />,
    );
    await flushDebounce();
    expect(toDocxBlobMock).toHaveBeenCalledTimes(1);
    expect(toDocxBlobMock).toHaveBeenLastCalledWith(docA);

    rerender(<DocxPreviewPanel doc={docB} visible={true} />);
    await flushDebounce();
    expect(toDocxBlobMock).toHaveBeenCalledTimes(2);
    expect(toDocxBlobMock).toHaveBeenLastCalledWith(docB);
  });

  it('surfaces "Rendering preview…" while toDocxBlob is in flight', async () => {
    // Hold toDocxBlob open so we can observe the loading state.
    let resolve!: (b: Blob) => void;
    toDocxBlobMock.mockImplementationOnce(
      () =>
        new Promise<Blob>((r) => {
          resolve = r;
        }),
    );
    render(<DocxPreviewPanel doc={docA} visible={true} />);
    // Fire the debounce so loading state turns on.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId('docx-preview-loading').textContent).toContain(
      'Rendering preview',
    );
    // Resolve and let the promise chain settle so React's state update
    // doesn't leak into the next test.
    await act(async () => {
      resolve(new Blob(['docx']));
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('surfaces "Preview failed: …" when render throws', async () => {
    toDocxBlobMock.mockRejectedValueOnce(new Error('boom'));
    render(<DocxPreviewPanel doc={docA} visible={true} />);
    await flushDebounce();
    const err = screen.getByTestId('docx-preview-error');
    expect(err.textContent).toContain('Preview failed: boom');
  });
});
