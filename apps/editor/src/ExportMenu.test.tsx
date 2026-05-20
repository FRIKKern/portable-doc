/**
 * A11 — ExportMenu specs.
 *
 * Coverage:
 *   1. Renders an "Export" trigger button.
 *   2. Click trigger flips aria-expanded and shows menuitems.
 *   3. Outside click closes the popover.
 *   4. Escape key closes the popover.
 *   5. Click HTML triggers a download of a text/html Blob.
 *   6. Click Markdown triggers a download of a text/markdown Blob.
 *   7. Click Print / PDF calls window.print().
 *   8. serializeMarkdown emits headings, strong, list, blockquote, fence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type { PortableDoc } from '@portable-doc/core';
import { ExportMenu, serializeMarkdown } from './ExportMenu.js';

const minimalDoc: PortableDoc = {
  version: 1,
  title: 'Hello World',
  blocks: [
    { id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'hi' }] },
  ],
};

function stubEditor(html: string) {
  return {
    getHTML: () => html,
    storage: {},
  } as unknown as import('@tiptap/react').Editor;
}

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
const capturedBlobs: Blob[] = [];

beforeEach(() => {
  capturedBlobs.length = 0;
  createObjectURL = vi.fn((blob: Blob) => {
    capturedBlobs.push(blob);
    return 'blob:mock-url';
  });
  revokeObjectURL = vi.fn();
  // happy-dom does not implement these on the URL global; stub each spec.
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
  cleanup();
  vi.restoreAllMocks();
});

describe('ExportMenu', () => {
  it('renders an Export trigger button', () => {
    render(<ExportMenu doc={minimalDoc} editor={stubEditor('<p>hi</p>')} />);
    const trigger = screen.getByTestId('footer-export-trigger');
    expect(trigger.textContent).toContain('Export');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the popover with six menuitems on click (Word, EPUB, HTML, Markdown, Print/PDF, Import)', () => {
    render(<ExportMenu doc={minimalDoc} editor={stubEditor('<p>hi</p>')} />);
    fireEvent.click(screen.getByTestId('footer-export-trigger'));
    expect(
      screen.getByTestId('footer-export-trigger').getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.getByTestId('footer-export-popover')).toBeTruthy();
    expect(screen.getByTestId('footer-export-docx')).toBeTruthy();
    expect(screen.getByTestId('footer-export-epub')).toBeTruthy();
    expect(screen.getByTestId('footer-export-html')).toBeTruthy();
    expect(screen.getByTestId('footer-export-markdown')).toBeTruthy();
    expect(screen.getByTestId('footer-export-print')).toBeTruthy();
    expect(screen.getByTestId('footer-import-docx')).toBeTruthy();
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(6);
  });

  it('closes on outside click', () => {
    render(
      <div>
        <ExportMenu doc={minimalDoc} editor={stubEditor('<p>hi</p>')} />
        <span data-testid="outside">outside</span>
      </div>,
    );
    fireEvent.click(screen.getByTestId('footer-export-trigger'));
    expect(screen.queryByTestId('footer-export-popover')).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByTestId('footer-export-popover')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<ExportMenu doc={minimalDoc} editor={stubEditor('<p>hi</p>')} />);
    fireEvent.click(screen.getByTestId('footer-export-trigger'));
    expect(screen.queryByTestId('footer-export-popover')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('footer-export-popover')).toBeNull();
  });

  it('exports an HTML blob with type text/html', () => {
    render(<ExportMenu doc={minimalDoc} editor={stubEditor('<p>hi</p>')} />);
    fireEvent.click(screen.getByTestId('footer-export-trigger'));
    fireEvent.click(screen.getByTestId('footer-export-html'));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(capturedBlobs[0]?.type).toBe('text/html');
  });

  it('exports a Markdown blob with type text/markdown', () => {
    render(<ExportMenu doc={minimalDoc} editor={stubEditor('<p>hi</p>')} />);
    fireEvent.click(screen.getByTestId('footer-export-trigger'));
    fireEvent.click(screen.getByTestId('footer-export-markdown'));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(capturedBlobs[0]?.type).toBe('text/markdown');
  });

  it('calls window.print on Print / PDF', () => {
    const printSpy = vi.fn();
    Object.defineProperty(window, 'print', {
      configurable: true,
      writable: true,
      value: printSpy,
    });
    render(<ExportMenu doc={minimalDoc} editor={stubEditor('<p>hi</p>')} />);
    fireEvent.click(screen.getByTestId('footer-export-trigger'));
    fireEvent.click(screen.getByTestId('footer-export-print'));
    expect(printSpy).toHaveBeenCalledTimes(1);
  });
});

describe('serializeMarkdown', () => {
  it('emits headings, strong, list, blockquote, fenced code', () => {
    const doc: PortableDoc = {
      version: 1,
      title: 'Doc',
      blocks: [
        { id: 'h1', type: 'heading', level: 2, text: 'Section' },
        {
          id: 'p1',
          type: 'paragraph',
          content: [
            { type: 'text', value: 'plain and ' },
            { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
          ],
        },
        {
          id: 'l1',
          type: 'list',
          items: [
            [{ type: 'text', value: 'one' }],
            [{ type: 'text', value: 'two' }],
          ],
        },
        {
          id: 'c1',
          type: 'callout',
          tone: 'info',
          title: 'Heads up',
          content: [{ type: 'text', value: 'beware' }],
        },
        { id: 'k1', type: 'code', lang: 'ts', value: 'const x = 1;' },
      ],
    };
    const md = serializeMarkdown(doc);
    expect(md).toContain('# Doc');
    expect(md).toContain('## Section');
    expect(md).toContain('**bold**');
    expect(md).toContain('- one');
    expect(md).toContain('- two');
    expect(md).toContain('> ');
    expect(md).toContain('**Heads up**');
    expect(md).toContain('```ts');
    expect(md).toContain('const x = 1;');
    expect(md).toContain('```');
  });
});
