// @vitest-environment jsdom
/**
 * Playground B1 specs — JSON paste box + live validateDoc + fixture loaders.
 *
 * Coverage:
 *   1. Default content is the welcome fixture, pretty-printed; validates clean.
 *   2. Clicking "Incident" replaces the textarea content with the incident
 *      fixture.
 *   3. Typing invalid JSON surfaces a parse error (after the 300ms debounce).
 *   4. Typing a block with an unknown variant (tone:'rainbow') surfaces a
 *      validation issue tagged with the offending rule name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App.js';
import { encodeDoc } from './lib/url-state.js';

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  // Reset the URL between tests so ?doc= from a prior render doesn't leak.
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
});

const DEBOUNCE_MS = 300;

function getTextarea(): HTMLTextAreaElement {
  return screen.getByTestId('json-input') as HTMLTextAreaElement;
}

function flushDebounce() {
  // Component debounces validation by 300ms via setTimeout. In jsdom the
  // setTimeout is real, so we advance wall-clock via a small await. Using
  // act() so any state updates triggered by the timer are flushed before we
  // make assertions.
  return new Promise<void>((resolve) =>
    setTimeout(() => {
      resolve();
    }, DEBOUNCE_MS + 50),
  );
}

describe('Playground App', () => {
  it('default loads the welcome fixture and reports 0 validation issues', async () => {
    render(<App />);
    const ta = getTextarea();
    expect(ta.value).toMatch(/Welcome to Atlas/);
    // Initial render seeds validation synchronously from the welcome fixture,
    // so the "valid" badge is already on screen — no debounce wait needed.
    expect(screen.getByTestId('validation-ok')).toBeTruthy();
    // After the debounce nothing should change (welcome is still valid).
    await act(async () => {
      await flushDebounce();
    });
    expect(screen.getByTestId('validation-ok')).toBeTruthy();
  });

  it('clicking "Incident" replaces the textarea content with the incident fixture', async () => {
    render(<App />);
    const ta = getTextarea();
    expect(ta.value).toMatch(/Welcome to Atlas/);
    fireEvent.click(screen.getByTestId('fixture-incident'));
    expect(ta.value).toMatch(/Database failover detected/);
    expect(ta.value).not.toMatch(/Welcome to Atlas/);
    // Incident fixture is also a valid document.
    await act(async () => {
      await flushDebounce();
    });
    expect(screen.getByTestId('validation-ok')).toBeTruthy();
  });

  it('typing invalid JSON shows a parse error after the debounce window', async () => {
    render(<App />);
    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: '{not json' } });
    await act(async () => {
      await flushDebounce();
    });
    const panel = screen.getByTestId('validation-parse-error');
    expect(panel.textContent ?? '').toMatch(/Parse error/);
  });

  it('typing an invalid block (tone:"rainbow") shows a validation issue tagged with the rule name', async () => {
    render(<App />);
    const ta = getTextarea();
    const bogus = {
      version: 1,
      title: 'Bad',
      blocks: [
        {
          id: 'cb',
          type: 'callout',
          tone: 'rainbow',
          content: [{ type: 'text', value: 'hi' }],
        },
      ],
    };
    fireEvent.change(ta, { target: { value: JSON.stringify(bogus, null, 2) } });
    await act(async () => {
      await flushDebounce();
    });
    const issues = screen.getByTestId('validation-issues');
    const items = screen.getAllByTestId('validation-issue');
    expect(items.length).toBeGreaterThan(0);
    // tone:"rainbow" violates the 16-safe palette → content-constraint rule.
    const toneIssue = items.find((li) =>
      (li.textContent ?? '').includes('content-constraint'),
    );
    expect(toneIssue).toBeTruthy();
    expect(toneIssue!.textContent ?? '').toMatch(/rainbow|tone/);
    expect(issues.textContent ?? '').toMatch(/validation issue/);
  });

  it('loads the doc from ?doc=<encoded> on mount', async () => {
    const fixture = JSON.stringify(
      { version: 1, title: 'From URL', blocks: [] },
      null,
      2,
    );
    const encoded = await encodeDoc(fixture);
    window.history.replaceState(null, '', `/?doc=${encoded}`);
    render(<App />);
    await waitFor(
      () => {
        expect(getTextarea().value).toContain('From URL');
      },
      { timeout: 2000 },
    );
  });

  it('shows the over-2000-char warning when the URL is too long', async () => {
    render(<App />);
    // 4 KB of high-entropy text resists gzip — the resulting URL clears the
    // 2000-char threshold easily.
    const big = {
      version: 1,
      title: 'Big',
      blocks: [
        {
          id: 'p',
          type: 'paragraph',
          content: [
            {
              type: 'text',
              value: Array.from({ length: 4000 }, () =>
                Math.random().toString(36).slice(2, 4),
              ).join(''),
            },
          ],
        },
      ],
    };
    fireEvent.change(getTextarea(), {
      target: { value: JSON.stringify(big) },
    });
    await waitFor(
      () => {
        expect(screen.queryByTestId('url-too-long')).toBeTruthy();
      },
      { timeout: 2000 },
    );
    const banner = screen.getByTestId('url-too-long');
    expect(banner.textContent ?? '').toMatch(/2000 chars/);
  });

  it('Copy share URL button copies the live share URL', async () => {
    render(<App />);
    // Wait for the initial encode → setShareUrl to settle so the button has
    // something non-empty to copy.
    await waitFor(
      () => {
        expect(window.location.search).toMatch(/^\?doc=/);
      },
      { timeout: 2000 },
    );
    const btn = screen.getByTestId('copy-share-url');
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    const arg = writeText.mock.calls[0]?.[0] as string;
    expect(arg).toContain('?doc=');
  });
});
