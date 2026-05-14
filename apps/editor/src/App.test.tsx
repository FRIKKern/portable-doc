/**
 * @vitest-environment jsdom
 *
 * A1 — single-column-layout. The App shell renders a centered paper column
 * with one TipTap editor inside, plus a fixed 36px footer placeholder. The
 * v0.3 three-panel grid (BlockList | center | PreviewStrip) is gone.
 *
 * These specs replace the v0.3 App tests per the T4 test-triage CSV
 * (apps/editor/src/App.test.tsx — disposition `rewrite`).
 *
 * Coverage:
 *   1. paper-app container renders.
 *   2. paper-column lands as the only content host.
 *   3. paper-footer empty placeholder is mounted (A8 fills it).
 *   4. ONE TipTap editor surface mounts (single document model, not five).
 *   5. The welcome fixture content is visible in the editor.
 *   6. v0.3 surfaces are GONE — no preview-tui, no block-list, no add-block btn.
 *   7. Cmd+Shift+J still opens the JSON-edit-mode overlay (keep-disposition).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App.js';

// jsdom doesn't implement Range.getClientRects on text nodes; ProseMirror calls
// it after every transaction. Stub so TipTap mount doesn't throw on layout.
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

describe('App — v0.4 single-column shell (A1)', () => {
  it('renders the paper-app container', () => {
    render(<App />);
    expect(screen.getByTestId('paper-app')).toBeTruthy();
  });

  it('renders the centered paper-column as the only content host', () => {
    render(<App />);
    const cols = screen.getAllByTestId('paper-column');
    expect(cols.length).toBe(1);
    // The column hosts the single editor.
    expect(cols[0]?.querySelector('[data-testid="paper-editor"]')).toBeTruthy();
  });

  it('mounts the fixed footer status row (A8 fills the A1 placeholder)', () => {
    render(<App />);
    const footer = screen.getByTestId('paper-footer');
    expect(footer.tagName.toLowerCase()).toBe('footer');
    // A8 filled the placeholder — FooterStatus renders the validation, MCP,
    // saved, and word-count chips. The fine-grained UX lives in
    // FooterStatus.test.tsx; here we just confirm A8 mounted onto A1's slot.
    expect(footer.querySelector('[data-testid="footer-validation"]')).toBeTruthy();
    expect(footer.querySelector('[data-testid="footer-mcp"]')).toBeTruthy();
    expect(footer.querySelector('[data-testid="footer-saved"]')).toBeTruthy();
    expect(footer.querySelector('[data-testid="footer-words"]')).toBeTruthy();
  });

  it('mounts exactly ONE TipTap editor surface (single doc model)', () => {
    render(<App />);
    const editors = screen.getAllByTestId('paper-editor');
    expect(editors.length).toBe(1);
    // ProseMirror's contenteditable lives inside the editor mount.
    const pm = editors[0]?.querySelector('.ProseMirror');
    expect(pm).toBeTruthy();
    expect(pm?.getAttribute('contenteditable')).toBe('true');
  });

  it('renders the welcome fixture content in the editor on mount', async () => {
    render(<App />);
    // `@tiptap/react`'s ReactRenderer queues each NodeView's React render
    // via queueMicrotask until the EditorContent component reports
    // `isEditorContentInitialized`. Wait one macrotask so the queued
    // renders flush before we read content.
    await new Promise<void>((r) => setTimeout(r, 0));
    const editor = screen.getByTestId('paper-editor');
    // Welcome fixture has an h1 "Welcome to Atlas" and a paragraph below.
    expect(editor.textContent ?? '').toMatch(/Welcome to Atlas/);
  });

  it('does NOT render the v0.3 three-panel surfaces (preview / block list / add button)', () => {
    render(<App />);
    expect(screen.queryByTestId('preview-tui')).toBeNull();
    expect(screen.queryByTestId('preview-json')).toBeNull();
    expect(screen.queryByTestId('block-list')).toBeNull();
    expect(screen.queryByTestId('block-form')).toBeNull();
    expect(screen.queryByLabelText('Add block')).toBeNull();
  });

  it('Cmd+Shift+J still opens the JSON-edit-mode overlay (keep-disposition)', () => {
    render(<App />);
    expect(screen.queryByRole('dialog', { name: 'JSON edit mode' })).toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: 'j', metaKey: true, shiftKey: true });
    });
    expect(screen.getByRole('dialog', { name: 'JSON edit mode' })).toBeTruthy();
  });

  it('Cmd+P toggles the A7 preview overlay (open then close)', () => {
    render(<App />);
    expect(screen.queryByTestId('preview-overlay')).toBeNull();
    // Open with ⌘P.
    act(() => {
      fireEvent.keyDown(window, { key: 'p', metaKey: true });
    });
    expect(screen.getByTestId('preview-overlay')).toBeTruthy();
    // Close with ⌘P again (toggle).
    act(() => {
      fireEvent.keyDown(window, { key: 'p', metaKey: true });
    });
    expect(screen.queryByTestId('preview-overlay')).toBeNull();
  });

  it('Ctrl+P also opens the A7 preview overlay (Linux/Windows)', () => {
    render(<App />);
    expect(screen.queryByTestId('preview-overlay')).toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
    });
    expect(screen.getByTestId('preview-overlay')).toBeTruthy();
  });

  it('Esc closes the A7 preview overlay (global handler)', () => {
    render(<App />);
    act(() => {
      fireEvent.keyDown(window, { key: 'p', metaKey: true });
    });
    expect(screen.getByTestId('preview-overlay')).toBeTruthy();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByTestId('preview-overlay')).toBeNull();
  });
});
