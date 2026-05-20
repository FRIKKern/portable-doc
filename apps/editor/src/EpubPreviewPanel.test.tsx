/**
 * Pioneer move A — EpubPreviewPanel specs.
 *
 * Mirrors DocxPreviewPanel.test.tsx + InkPreviewPanel.test.tsx — coverage:
 *   1. Returns null when visible=false (no panel mounts).
 *   2. Renders the title chrome when visible=true.
 *   3. Calls toEpubBlob with the doc after the 500ms debounce.
 *   4. Re-renders the panel when the doc reference changes.
 *   5. Surfaces "Rendering EPUB preview…" while the build is in flight.
 *   6. Surfaces "Preview failed: {message}" when toEpubBlob throws.
 *   7. The × close button fires onClose when clicked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type { PortableDoc } from '@portable-doc/core';

// Mock epubjs so the test never has to walk a real EPUB iframe pipeline.
// `display()` resolves immediately; `destroy()` is a spy so we can assert
// cleanup on unmount.
const displayMock = vi.fn().mockResolvedValue(undefined);
const renderToMock = vi.fn(() => ({ display: displayMock }));
const destroyMock = vi.fn();
const ePubFactory = vi.fn((..._args: unknown[]) => ({
  renderTo: renderToMock,
  destroy: destroyMock,
}));
vi.mock('epubjs', () => ({
  default: (...args: unknown[]) => ePubFactory(...(args as [])),
}));

// Mock the serializer so we observe doc plumbing without exercising the
// real JSZip-backed EPUB builder on every render.
const toEpubBlobMock = vi.fn(
  async (_doc: unknown) =>
    new Blob(['epub'], { type: 'application/epub+zip' }),
);
vi.mock('./export/toEpub.js', () => ({
  toEpubBlob: (doc: unknown) => toEpubBlobMock(doc),
}));

import { EpubPreviewPanel } from './EpubPreviewPanel.js';

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
  displayMock.mockClear();
  displayMock.mockResolvedValue(undefined);
  renderToMock.mockClear();
  destroyMock.mockClear();
  ePubFactory.mockClear();
  toEpubBlobMock.mockClear();
  toEpubBlobMock.mockResolvedValue(
    new Blob(['epub'], { type: 'application/epub+zip' }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/** Advance past the 500ms debounce and flush pending promise jobs so React
 *  commits the post-render state updates. Three ticks cover the chain:
 *  toEpubBlob → blob.arrayBuffer → rendition.display. */
async function flushDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('EpubPreviewPanel', () => {
  it('returns null when visible=false', () => {
    const { container } = render(
      <EpubPreviewPanel doc={docA} visible={false} />,
    );
    expect(container.querySelector('[data-testid="epub-preview-panel"]')).toBeNull();
    expect(toEpubBlobMock).not.toHaveBeenCalled();
  });

  it('renders the title chrome when visible=true', () => {
    render(<EpubPreviewPanel doc={docA} visible={true} />);
    expect(screen.getByTestId('epub-preview-panel')).toBeTruthy();
    expect(screen.getByTestId('epub-preview-title').textContent).toContain(
      'EPUB preview',
    );
  });

  it('calls toEpubBlob with the provided doc after the debounce', async () => {
    render(<EpubPreviewPanel doc={docA} visible={true} />);
    expect(toEpubBlobMock).not.toHaveBeenCalled();
    await flushDebounce();
    expect(toEpubBlobMock).toHaveBeenCalledTimes(1);
    expect(toEpubBlobMock).toHaveBeenCalledWith(docA);
    // epub.js should have been invoked with the buffer and asked to render.
    expect(ePubFactory).toHaveBeenCalledTimes(1);
    expect(renderToMock).toHaveBeenCalledTimes(1);
    expect(displayMock).toHaveBeenCalledTimes(1);
  });

  it('re-renders the panel when the doc reference changes', async () => {
    const { rerender } = render(
      <EpubPreviewPanel doc={docA} visible={true} />,
    );
    await flushDebounce();
    expect(toEpubBlobMock).toHaveBeenCalledTimes(1);
    expect(toEpubBlobMock).toHaveBeenLastCalledWith(docA);

    rerender(<EpubPreviewPanel doc={docB} visible={true} />);
    await flushDebounce();
    expect(toEpubBlobMock).toHaveBeenCalledTimes(2);
    expect(toEpubBlobMock).toHaveBeenLastCalledWith(docB);
    // Cleanup between renders — previous book should have been destroyed.
    expect(destroyMock).toHaveBeenCalled();
  });

  it('surfaces "Rendering EPUB preview…" while toEpubBlob is in flight', async () => {
    // Hold toEpubBlob open so the loading state is observable.
    let resolve!: (b: Blob) => void;
    toEpubBlobMock.mockImplementationOnce(
      () =>
        new Promise<Blob>((r) => {
          resolve = r;
        }),
    );
    render(<EpubPreviewPanel doc={docA} visible={true} />);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId('epub-preview-loading').textContent).toContain(
      'Rendering EPUB preview',
    );
    // Settle so React state updates don't leak into the next test.
    await act(async () => {
      resolve(new Blob(['epub'], { type: 'application/epub+zip' }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('surfaces "Preview failed: …" when toEpubBlob throws', async () => {
    toEpubBlobMock.mockRejectedValueOnce(new Error('boom'));
    render(<EpubPreviewPanel doc={docA} visible={true} />);
    await flushDebounce();
    const err = screen.getByTestId('epub-preview-error');
    expect(err.textContent).toContain('Preview failed: boom');
  });

  it('calls onClose when the × button is clicked', () => {
    const onClose = vi.fn();
    render(<EpubPreviewPanel doc={docA} visible={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('epub-preview-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
