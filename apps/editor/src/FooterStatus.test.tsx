/**
 * @vitest-environment jsdom
 *
 * A8 — footer status row. The 36px fixed strip below the centered column.
 *
 * Coverage (≥10 specs):
 *   1. Renders "✓ valid" + success-tone dot when validateDoc returns 0 issues.
 *   2. Renders "N issues" + danger-tone dot when validateDoc returns N>0.
 *   3. Renders "1 issue" (singular) when exactly one issue.
 *   4. MCP dot tone tracks reachable state (success / warning / neutral).
 *   5. MCP chip aria-label tracks status.
 *   6. Word count matches a known fixture's count.
 *   7. "saved Ns ago" advances after the 1Hz tick.
 *   8. "saved Ns ago" resets to "just now" when doc changes.
 *   9. Click MCP dot at ≥768px shows inline popover (no role=dialog).
 *  10. Click MCP dot at <768px shows the bottom sheet with role=dialog.
 *  11. Sheet has aria-modal="true".
 *  12. Sheet dismisses on Escape.
 *  13. Sheet dismisses on backdrop click.
 *  14. Sheet contains a Retry button that calls retry() when disconnected.
 *  15. Inline popover dismisses on outside click.
 *
 * happy-dom is the editor's test env (vite.config.ts). matchMedia is
 * available; we stub `.matches` per spec to control the wide/narrow branch.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type { PortableDoc } from '@portable-doc/core';
import { FooterStatus, countWords } from './FooterStatus.js';
import { McpProvider } from './McpProvider.js';

const probeMcp = vi.fn();
const renderViaMcp = vi.fn();

vi.mock('./lib/mcp-client.js', () => ({
  probeMcp: (...args: unknown[]) => probeMcp(...args),
  renderViaMcp: (...args: unknown[]) => renderViaMcp(...args),
  __resetMcpForTests: vi.fn(),
  isReachable: vi.fn(),
  DEFAULT_MCP_URL: 'http://127.0.0.1:6123/mcp',
}));

// ---------------------------------------------------------------------------
// matchMedia helper — controls the wide/narrow branch for the popover/sheet.
// ---------------------------------------------------------------------------

function mockMatchMedia(wide: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === '(min-width: 768px)' ? wide : false,
      media: query,
      onchange: null,
      addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => {
        listeners.add(l);
      },
      removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => {
        listeners.delete(l);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validDoc: PortableDoc = {
  version: 1,
  title: 'Title',
  blocks: [
    {
      id: 'h1',
      type: 'heading',
      level: 1,
      text: 'Hello world',
    },
    {
      id: 'p1',
      type: 'paragraph',
      content: [{ type: 'text', value: 'four more words here' }],
    },
  ],
};

// Three blocks share id 'dup' → triggers content-constraint rule (unique ids).
// "x".repeat(81) heading text → exceeds the 80-char cap → another issue.
const invalidDoc: PortableDoc = {
  version: 1,
  title: 'T',
  blocks: [
    { id: 'dup', type: 'heading', level: 1, text: 'A' },
    { id: 'dup', type: 'heading', level: 2, text: 'x'.repeat(81) },
    { id: 'dup', type: 'paragraph', content: [{ type: 'text', value: 'p' }] },
  ],
};

// Exactly one issue — single-block doc with 81-char heading.
const oneIssueDoc: PortableDoc = {
  version: 1,
  title: 'T',
  blocks: [{ id: 'h1', type: 'heading', level: 1, text: 'x'.repeat(81) }],
};

function renderWithMcp(ui: JSX.Element) {
  return render(<McpProvider>{ui}</McpProvider>);
}

beforeEach(() => {
  probeMcp.mockReset();
  renderViaMcp.mockReset();
  // Default to wide for predictable initial state; override per-test.
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('FooterStatus — validation', () => {
  it('renders "✓ valid" + success-tone dot when there are no issues', () => {
    vi.useFakeTimers();
    probeMcp.mockResolvedValue(true);
    renderWithMcp(<FooterStatus doc={validDoc} />);
    // Flush the 500ms debounce so validation flips from initial.
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByTestId('footer-validation-label').textContent).toBe('✓ valid');
    expect(
      screen.getByTestId('footer-validation-dot').getAttribute('data-tone'),
    ).toBe('success');
  });

  it('renders "N issues" + danger-tone dot when validateDoc returns N>0', () => {
    vi.useFakeTimers();
    probeMcp.mockResolvedValue(true);
    renderWithMcp(<FooterStatus doc={invalidDoc} />);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const label = screen.getByTestId('footer-validation-label').textContent ?? '';
    expect(label).toMatch(/^\d+ issues?$/);
    expect(label).not.toBe('✓ valid');
    // Count > 0 → number prefix is at least 1.
    const n = Number(label.split(' ')[0]);
    expect(n).toBeGreaterThan(0);
    expect(
      screen.getByTestId('footer-validation-dot').getAttribute('data-tone'),
    ).toBe('danger');
  });

  it('uses the singular "1 issue" form when exactly one issue', () => {
    vi.useFakeTimers();
    probeMcp.mockResolvedValue(true);
    renderWithMcp(<FooterStatus doc={oneIssueDoc} />);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByTestId('footer-validation-label').textContent).toBe('1 issue');
  });
});

describe('FooterStatus — MCP dot', () => {
  it('dot tone is "warning" while the probe is in flight (reachable=null)', () => {
    // probeMcp never resolves → reachable stays at null.
    probeMcp.mockReturnValue(new Promise(() => {}));
    renderWithMcp(<FooterStatus doc={validDoc} />);
    expect(
      screen.getByTestId('footer-mcp-dot').getAttribute('data-tone'),
    ).toBe('warning');
    expect(
      screen.getByTestId('footer-mcp-dot').getAttribute('data-mcp-status'),
    ).toBe('connecting');
  });

  it('dot tone flips to "success" once the probe resolves true', async () => {
    probeMcp.mockResolvedValue(true);
    renderWithMcp(<FooterStatus doc={validDoc} />);
    // probeMcp resolves on a microtask; let React flush.
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByTestId('footer-mcp-dot').getAttribute('data-tone'),
    ).toBe('success');
    expect(
      screen.getByTestId('footer-mcp-dot').getAttribute('data-mcp-status'),
    ).toBe('connected');
  });

  it('dot tone flips to "neutral" once the probe resolves false', async () => {
    probeMcp.mockResolvedValue(false);
    renderWithMcp(<FooterStatus doc={validDoc} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByTestId('footer-mcp-dot').getAttribute('data-tone'),
    ).toBe('neutral');
    expect(
      screen.getByTestId('footer-mcp-dot').getAttribute('data-mcp-status'),
    ).toBe('disconnected');
  });

  it('MCP chip aria-label tracks the connection state', async () => {
    probeMcp.mockResolvedValue(false);
    renderWithMcp(<FooterStatus doc={validDoc} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('footer-mcp').getAttribute('aria-label')).toBe(
      'MCP disconnected',
    );
  });
});

describe('FooterStatus — word count', () => {
  it('matches countWords for the doc', () => {
    expect(countWords(validDoc)).toBe(7); // "Title Hello world four more words here"
  });

  it('renders the word count in the strip after debounce', () => {
    vi.useFakeTimers();
    probeMcp.mockResolvedValue(true);
    renderWithMcp(<FooterStatus doc={validDoc} />);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByTestId('footer-words').textContent).toBe('7 words');
  });

  it('renders the singular "1 word" form', () => {
    vi.useFakeTimers();
    probeMcp.mockResolvedValue(true);
    const oneWord: PortableDoc = {
      version: 1,
      blocks: [{ id: 'h', type: 'heading', level: 1, text: 'Hello' }],
    };
    renderWithMcp(<FooterStatus doc={oneWord} />);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByTestId('footer-words').textContent).toBe('1 word');
  });
});

describe('FooterStatus — saved indicator', () => {
  it('renders "saved Ns ago" with a 1s tick', () => {
    vi.useFakeTimers();
    const start = new Date('2026-05-11T09:00:00Z').getTime();
    vi.setSystemTime(start);
    probeMcp.mockResolvedValue(true);
    renderWithMcp(<FooterStatus doc={validDoc} />);
    // Immediately after mount → "saved just now" (delta 0s).
    expect(screen.getByTestId('footer-saved').textContent).toBe('saved just now');
    // Advance the fake clock by 3s — three tick events fire and the last
    // brings the wall-clock delta to 3000ms.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('footer-saved').textContent).toBe('saved 3s ago');
  });

  it('resets the savedAt timestamp when the doc reference changes', () => {
    vi.useFakeTimers();
    const start = new Date('2026-05-11T09:00:00Z').getTime();
    vi.setSystemTime(start);
    probeMcp.mockResolvedValue(true);
    const { rerender } = renderWithMcp(<FooterStatus doc={validDoc} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('footer-saved').textContent).toBe('saved 5s ago');
    // A new doc reference is the "save" event — savedAt resets to now.
    const nextDoc: PortableDoc = { ...validDoc };
    rerender(
      <McpProvider>
        <FooterStatus doc={nextDoc} />
      </McpProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByTestId('footer-saved').textContent).toBe('saved just now');
  });
});

describe('FooterStatus — MCP click at ≥768px (inline popover)', () => {
  it('clicking the MCP chip shows the inline popover (no role=dialog)', async () => {
    mockMatchMedia(true);
    probeMcp.mockResolvedValue(false);
    renderWithMcp(<FooterStatus doc={validDoc} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('footer-mcp-popover')).toBeNull();
    expect(screen.queryByTestId('footer-mcp-sheet')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId('footer-mcp'));
    });
    expect(screen.getByTestId('footer-mcp-popover')).toBeTruthy();
    // Inline popover is NOT a dialog.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clicking outside the popover dismisses it', async () => {
    mockMatchMedia(true);
    probeMcp.mockResolvedValue(false);
    renderWithMcp(<FooterStatus doc={validDoc} />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('footer-mcp'));
    });
    expect(screen.getByTestId('footer-mcp-popover')).toBeTruthy();
    await act(async () => {
      fireEvent.mouseDown(document.body);
    });
    expect(screen.queryByTestId('footer-mcp-popover')).toBeNull();
  });
});

describe('FooterStatus — MCP click at <768px (bottom sheet)', () => {
  it('clicking the MCP chip opens the bottom sheet with role=dialog', async () => {
    mockMatchMedia(false);
    probeMcp.mockResolvedValue(false);
    renderWithMcp(<FooterStatus doc={validDoc} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('footer-mcp-sheet')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId('footer-mcp'));
    });
    const sheet = screen.getByTestId('footer-mcp-sheet');
    expect(sheet).toBeTruthy();
    expect(sheet.getAttribute('role')).toBe('dialog');
  });

  it('sheet has aria-modal="true"', async () => {
    mockMatchMedia(false);
    probeMcp.mockResolvedValue(false);
    renderWithMcp(<FooterStatus doc={validDoc} />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('footer-mcp'));
    });
    expect(
      screen.getByTestId('footer-mcp-sheet').getAttribute('aria-modal'),
    ).toBe('true');
  });

  it('Escape dismisses the sheet', async () => {
    mockMatchMedia(false);
    probeMcp.mockResolvedValue(false);
    renderWithMcp(<FooterStatus doc={validDoc} />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('footer-mcp'));
    });
    expect(screen.getByTestId('footer-mcp-sheet')).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByTestId('footer-mcp-sheet')).toBeNull();
  });

  it('clicking the backdrop dismisses the sheet', async () => {
    mockMatchMedia(false);
    probeMcp.mockResolvedValue(false);
    renderWithMcp(<FooterStatus doc={validDoc} />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('footer-mcp'));
    });
    expect(screen.getByTestId('footer-mcp-sheet')).toBeTruthy();
    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId('footer-mcp-backdrop'));
    });
    expect(screen.queryByTestId('footer-mcp-sheet')).toBeNull();
  });

  it('sheet renders a Retry button when disconnected; clicking it re-probes', async () => {
    mockMatchMedia(false);
    probeMcp.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderWithMcp(<FooterStatus doc={validDoc} />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('footer-mcp'));
    });
    const retry = screen.getByTestId('footer-mcp-retry');
    expect(retry).toBeTruthy();
    await act(async () => {
      fireEvent.click(retry);
      await Promise.resolve();
    });
    expect(probeMcp).toHaveBeenCalledTimes(2);
  });
});
