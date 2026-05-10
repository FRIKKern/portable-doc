// @vitest-environment jsdom
/**
 * CopyButton specs — clipboard-mocked. The real `navigator.clipboard` doesn't
 * exist in jsdom by default, so we install a vi.fn() before each test and
 * read it back to assert the call site. Label flips to "Copied!" for ~1.5 s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CopyButton } from './CopyButton.js';

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('CopyButton', () => {
  it('calls navigator.clipboard.writeText with the value from getValue', async () => {
    render(<CopyButton getValue={() => 'hello world'} />);
    const btn = screen.getByTestId('copy-button');
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('hello world');
  });

  it('flips label to "Copied!" then reverts after the timeout', async () => {
    vi.useFakeTimers();
    render(<CopyButton getValue={() => 'x'} label="Copy" />);
    const btn = screen.getByTestId('copy-button');
    expect(btn.textContent).toBe('Copy');
    await act(async () => {
      fireEvent.click(btn);
      // resolve the awaited writeText
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(btn.textContent).toBe('Copied!');
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(btn.textContent).toBe('Copy');
  });
});
