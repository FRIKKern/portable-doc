/**
 * @vitest-environment jsdom
 *
 * McpProvider — v0.4 (post-A8). The provider is now a pure state source;
 * the v0.3 inline yellow banner moved to FooterStatus.tsx as a footer dot.
 * The provider contract is unchanged:
 *
 *   - probe success → `reachable === true`; previews route via MCP.
 *   - probe failure → `reachable === false`; previews fall back to direct
 *     backends. NO banner DOM emitted by the provider.
 *   - retry()      → re-runs the probe; reachable flips to `null` while
 *     in-flight, then to the new boolean.
 *   - mid-session render error → renderViaMcp throws once, the hook falls
 *     back silently to the direct backend; reachable does NOT toggle.
 *
 * v0.4 disposition (docs/v0.4-test-triage.csv): keep — banner UI dissolves
 * into A8 footer dot, provider contract identical. Banner-DOM assertions
 * carried over from v0.3 are removed; their UX counterpart lives in
 * FooterStatus.test.tsx (footer-mcp-dot, footer-mcp-retry, sheet, popover).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PortableDoc } from '@portable-doc/core';

const probeMcp = vi.fn();
const renderViaMcp = vi.fn();

vi.mock('./lib/mcp-client.js', () => ({
  probeMcp: (...args: unknown[]) => probeMcp(...args),
  renderViaMcp: (...args: unknown[]) => renderViaMcp(...args),
  __resetMcpForTests: vi.fn(),
  isReachable: vi.fn(),
  DEFAULT_MCP_URL: 'http://127.0.0.1:6123/mcp',
}));

import { McpProvider, useMcp } from './McpProvider.js';
import { useRenderedContent } from './lib/use-rendered-content.js';

const minimalDoc: PortableDoc = {
  version: 1,
  title: 'X',
  blocks: [{ id: 'h1', type: 'heading', level: 1, text: 'Hello' }],
};

function Harness() {
  const { reachable, retry } = useMcp();
  const text = useRenderedContent(minimalDoc, 'tui', () => 'DIRECT-OUTPUT');
  return (
    <div>
      <span data-testid="harness-reachable">{String(reachable)}</span>
      <pre data-testid="harness-text">{text}</pre>
      <button
        type="button"
        data-testid="harness-retry"
        onClick={() => {
          void retry();
        }}
      >
        retry
      </button>
    </div>
  );
}

beforeEach(() => {
  probeMcp.mockReset();
  renderViaMcp.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('McpProvider — state contract (post-A8, banner UI now in FooterStatus)', () => {
  it('probe success → reachable=true, renders via MCP, provider emits no banner DOM', async () => {
    probeMcp.mockResolvedValue(true);
    renderViaMcp.mockResolvedValue('MCP-OUTPUT');

    render(
      <McpProvider>
        <Harness />
      </McpProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('harness-reachable').textContent).toBe('true'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('harness-text').textContent).toBe('MCP-OUTPUT'),
    );
    // No banner DOM is emitted by the provider in v0.4 — UX moved to FooterStatus.
    expect(screen.queryByTestId('mcp-banner')).toBeNull();
    expect(probeMcp).toHaveBeenCalledTimes(1);
  });

  it('probe failure → reachable=false; direct backend used; no banner DOM', async () => {
    probeMcp.mockResolvedValue(false);

    render(
      <McpProvider>
        <Harness />
      </McpProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('harness-reachable').textContent).toBe('false'),
    );
    // Direct backend was used → renderViaMcp never called.
    expect(renderViaMcp).not.toHaveBeenCalled();
    expect(screen.getByTestId('harness-text').textContent).toBe('DIRECT-OUTPUT');
    // Banner UI no longer lives in the provider.
    expect(screen.queryByTestId('mcp-banner')).toBeNull();
    expect(screen.queryByTestId('mcp-retry')).toBeNull();
  });

  it('retry() re-probes; reachable flips false→true on second probe and MCP routes', async () => {
    probeMcp.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderViaMcp.mockResolvedValue('MCP-AFTER-RETRY');

    render(
      <McpProvider>
        <Harness />
      </McpProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('harness-reachable').textContent).toBe('false'),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('harness-retry'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('harness-reachable').textContent).toBe('true'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('harness-text').textContent).toBe('MCP-AFTER-RETRY'),
    );
    expect(probeMcp).toHaveBeenCalledTimes(2);
  });

  it('mid-session render error falls back silently and does NOT toggle reachable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    probeMcp.mockResolvedValue(true);
    renderViaMcp.mockRejectedValue(new Error('boom'));

    render(
      <McpProvider>
        <Harness />
      </McpProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('harness-reachable').textContent).toBe('true'),
    );
    // renderViaMcp threw → the hook fell back to directRender for THIS call.
    await waitFor(() =>
      expect(screen.getByTestId('harness-text').textContent).toBe('DIRECT-OUTPUT'),
    );
    // Provider stays at reachable=true; one render failure doesn't re-probe.
    expect(screen.getByTestId('harness-reachable').textContent).toBe('true');
    expect(probeMcp).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
