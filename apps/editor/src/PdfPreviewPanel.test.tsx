/**
 * Pioneer move B — PdfPreviewPanel specs.
 *
 * Mirrors EpubPreviewPanel.test.tsx coverage:
 *   1. Returns null when visible=false (no panel mounts).
 *   2. Renders the title chrome when visible=true.
 *   3. Calls toPdfBlob with the doc after the 500ms debounce.
 *   4. Re-renders the panel when the doc reference changes.
 *   5. Surfaces "Rendering PDF preview…" while toPdfBlob is in flight.
 *   6. Surfaces "Preview failed: {message}" when toPdfBlob throws.
 *   7. The × close button fires onClose when clicked.
 *   8. Mounts an <iframe> pointing at the minted blob URL.
 *   9. Revokes the previous blob URL when the doc changes.
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

// Mock the serializer so we observe doc plumbing without exercising the
// real pdfmake pipeline on every render.
const toPdfBlobMock = vi.fn(
  async (_doc: unknown) => new Blob(['%PDF-1.3 mock'], { type: 'application/pdf' }),
);
vi.mock('./export/toPdf.js', () => ({
  toPdfBlob: (doc: unknown) => toPdfBlobMock(doc),
}));

import { PdfPreviewPanel } from './PdfPreviewPanel.js';

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

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  toPdfBlobMock.mockClear();
  toPdfBlobMock.mockResolvedValue(
    new Blob(['%PDF-1.3 mock'], { type: 'application/pdf' }),
  );
  let counter = 0;
  createObjectURL = vi.fn(() => `blob:mock-pdf-${++counter}`);
  revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: revokeObjectURL,
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/** Advance past the 500ms debounce and flush pending promise jobs so React
 *  commits the post-render state updates. Three ticks cover the chain:
 *  toPdfBlob → setPdfUrl → setStatus. */
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

describe('PdfPreviewPanel', () => {
  it('returns null when visible=false', () => {
    const { container } = render(
      <PdfPreviewPanel doc={docA} visible={false} />,
    );
    expect(container.querySelector('[data-testid="pdf-preview-panel"]')).toBeNull();
    expect(toPdfBlobMock).not.toHaveBeenCalled();
  });

  it('renders the title chrome when visible=true', () => {
    render(<PdfPreviewPanel doc={docA} visible={true} />);
    expect(screen.getByTestId('pdf-preview-panel')).toBeTruthy();
    expect(screen.getByTestId('pdf-preview-title').textContent).toContain(
      'PDF preview',
    );
  });

  it('calls toPdfBlob with the provided doc after the debounce', async () => {
    render(<PdfPreviewPanel doc={docA} visible={true} />);
    expect(toPdfBlobMock).not.toHaveBeenCalled();
    await flushDebounce();
    expect(toPdfBlobMock).toHaveBeenCalledTimes(1);
    expect(toPdfBlobMock).toHaveBeenCalledWith(docA);
    // createObjectURL should have minted a URL the iframe can point at.
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('mounts an iframe pointing at the minted blob URL', async () => {
    render(<PdfPreviewPanel doc={docA} visible={true} />);
    await flushDebounce();
    const iframe = screen.getByTestId('pdf-preview-iframe') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute('src')).toMatch(/^blob:mock-pdf-/);
  });

  it('re-renders the panel + revokes the previous URL when the doc changes', async () => {
    const { rerender } = render(
      <PdfPreviewPanel doc={docA} visible={true} />,
    );
    await flushDebounce();
    expect(toPdfBlobMock).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    rerender(<PdfPreviewPanel doc={docB} visible={true} />);
    await flushDebounce();
    expect(toPdfBlobMock).toHaveBeenCalledTimes(2);
    expect(toPdfBlobMock).toHaveBeenLastCalledWith(docB);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    // The first URL should have been revoked before the second was installed.
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it('surfaces "Rendering PDF preview…" while toPdfBlob is in flight', async () => {
    let resolve!: (b: Blob) => void;
    toPdfBlobMock.mockImplementationOnce(
      () =>
        new Promise<Blob>((r) => {
          resolve = r;
        }),
    );
    render(<PdfPreviewPanel doc={docA} visible={true} />);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId('pdf-preview-loading').textContent).toContain(
      'Rendering PDF preview',
    );
    // Settle so React state updates don't leak into the next test.
    await act(async () => {
      resolve(new Blob(['%PDF-1.3'], { type: 'application/pdf' }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('surfaces "Preview failed: …" when toPdfBlob throws', async () => {
    toPdfBlobMock.mockRejectedValueOnce(new Error('boom'));
    render(<PdfPreviewPanel doc={docA} visible={true} />);
    await flushDebounce();
    const err = screen.getByTestId('pdf-preview-error');
    expect(err.textContent).toContain('Preview failed: boom');
  });

  it('calls onClose when the × button is clicked', () => {
    const onClose = vi.fn();
    render(<PdfPreviewPanel doc={docA} visible={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('pdf-preview-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('revokes the minted blob URL on unmount', async () => {
    const { unmount } = render(
      <PdfPreviewPanel doc={docA} visible={true} />,
    );
    await flushDebounce();
    // createObjectURL has minted exactly one URL and stashed it in state.
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const mintedUrl = createObjectURL.mock.results[0]?.value as string;
    expect(mintedUrl).toMatch(/^blob:mock-pdf-/);
    // Cleanup branch: unmount must revoke the stashed URL so the underlying
    // Blob is not leaked across an editing session.
    expect(revokeObjectURL).not.toHaveBeenCalledWith(mintedUrl);
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith(mintedUrl);
  });
});
