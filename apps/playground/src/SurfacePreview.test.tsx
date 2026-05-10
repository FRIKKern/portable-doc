// @vitest-environment jsdom
/**
 * SurfacePreview specs — five tabs render kernel-direct output, each tagged
 * with its own data-testid. Email is async so its assertion waits for the
 * iframe srcDoc to populate. The welcome fixture is used as the input doc.
 *
 * Email/TUI/Text are React.lazy chunks; in jsdom the dynamic import takes a
 * few seconds to resolve (it transforms backend-ink + cli-highlight). The
 * `findByTestId` calls below pass `{ timeout: 8000 }` to absorb that latency
 * without flaking. The default 1000 ms is too tight for these chunks.
 */
import { afterEach, describe, expect, it } from 'vitest';

// Lazy-chunk specs need a wider window than vitest's 5 s default — the TUI
// chunk in particular transforms cli-highlight + highlight.js on cold load.
const LAZY_TEST_TIMEOUT = 15000;
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { PortableDoc } from '@portable-doc/core';
import welcomeJson from '../../../examples/welcome.json';
import { SurfacePreview, SURFACES, DEFAULT_SURFACE } from './SurfacePreview.js';

const welcome = welcomeJson as unknown as PortableDoc;
const LAZY_TIMEOUT = 8000;

afterEach(() => {
  cleanup();
});

describe('SurfacePreview', () => {
  it('exposes 5 surfaces in the documented order', () => {
    expect([...SURFACES]).toEqual(['web', 'email', 'tui', 'native', 'text']);
    expect(DEFAULT_SURFACE).toBe('web');
  });

  it('renders the Web surface with inline-styled HTML', () => {
    render(<SurfacePreview doc={welcome} surface="web" />);
    const el = screen.getByTestId('preview-web');
    expect(el.innerHTML).toContain('Welcome to Atlas');
    // backend-web/static emits inline `style=` (no class selectors).
    expect(el.innerHTML).toContain('style=');
  });

  it('renders the Email surface as an iframe and populates srcDoc', { timeout: LAZY_TEST_TIMEOUT }, async () => {
    render(<SurfacePreview doc={welcome} surface="email" />);
    const frame = (await screen.findByTestId('preview-email', undefined, {
      timeout: LAZY_TIMEOUT,
    })) as HTMLIFrameElement;
    expect(frame.tagName).toBe('IFRAME');
    await waitFor(
      () => {
        expect(frame.getAttribute('srcDoc') ?? frame.getAttribute('srcdoc') ?? '').toContain('Atlas');
      },
      { timeout: LAZY_TIMEOUT },
    );
  });

  it('renders the TUI surface with at least one inline-styled color span', { timeout: LAZY_TEST_TIMEOUT }, async () => {
    render(<SurfacePreview doc={welcome} surface="tui" />);
    const el = await screen.findByTestId('preview-tui', undefined, { timeout: LAZY_TIMEOUT });
    expect(el.tagName).toBe('PRE');
    // ansiToHtml emits `<span style="color: rgb(...)` for truecolor escapes.
    expect(el.innerHTML).toMatch(/<span style="color: rgb\(/);
    // No raw ESC bytes in the HTML output.
    expect(el.innerHTML).not.toContain('\x1b');
  });

  it('renders the Native surface as JSON of the composeDocument tree', () => {
    render(<SurfacePreview doc={welcome} surface="native" />);
    const el = screen.getByTestId('preview-native');
    expect(el.tagName).toBe('PRE');
    expect(el.textContent).toContain('"kind": "PdContainer"');
    expect(el.textContent).toContain('"children"');
  });

  it('renders the Text surface with no ANSI markup and no color spans', { timeout: LAZY_TEST_TIMEOUT }, async () => {
    render(<SurfacePreview doc={welcome} surface="text" />);
    const el = await screen.findByTestId('preview-text', undefined, { timeout: LAZY_TIMEOUT });
    expect(el.tagName).toBe('PRE');
    expect(el.textContent).toContain('Welcome to Atlas');
    // mono mode: zero escape bytes, zero <span> markup.
    expect(el.textContent).not.toContain('\x1b');
    expect(el.innerHTML).not.toContain('<span');
  });

  it('switching surfaces swaps the rendered testid (web → native)', async () => {
    const { rerender } = render(<SurfacePreview doc={welcome} surface="web" />);
    expect(screen.getByTestId('preview-web')).toBeTruthy();
    expect(screen.queryByTestId('preview-native')).toBeNull();
    rerender(<SurfacePreview doc={welcome} surface="native" />);
    expect(await screen.findByTestId('preview-native')).toBeTruthy();
    expect(screen.queryByTestId('preview-web')).toBeNull();
  });
});
