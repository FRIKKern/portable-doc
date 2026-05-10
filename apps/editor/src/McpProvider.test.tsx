/**
 * @vitest-environment jsdom
 *
 * Banner UX per grill q8:
 *   - probe success → no banner; previews render via MCP.
 *   - probe failure → banner with retry button; direct backends used.
 *   - retry click   → re-probes; on success the banner clears.
 *   - mid-session render error → silent fallback for that one call.
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
  const { reachable } = useMcp();
  const text = useRenderedContent(minimalDoc, 'tui', () => 'DIRECT-OUTPUT');
  return (
    <div>
      <span data-testid="harness-reachable">{String(reachable)}</span>
      <pre data-testid="harness-text">{text}</pre>
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

describe('McpProvider banner + render routing', () => {
  it('probe success → renders via MCP, no banner shown', async () => {
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
    expect(screen.queryByTestId('mcp-banner')).toBeNull();
    expect(probeMcp).toHaveBeenCalledTimes(1);
  });

  it('probe failure → banner shown with retry; direct backend used for render', async () => {
    probeMcp.mockResolvedValue(false);

    render(
      <McpProvider>
        <Harness />
      </McpProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('mcp-banner')).toBeTruthy());
    expect(screen.getByTestId('mcp-banner').textContent).toMatch(
      /MCP server not running/,
    );
    expect(screen.getByTestId('mcp-banner').textContent).toMatch(/pnpm dev:full/);
    expect(screen.getByTestId('mcp-retry')).toBeTruthy();
    // Direct backend was used → renderViaMcp never called.
    expect(renderViaMcp).not.toHaveBeenCalled();
    expect(screen.getByTestId('harness-text').textContent).toBe('DIRECT-OUTPUT');
  });

  it('Retry click re-probes; on success the banner hides and MCP routes', async () => {
    probeMcp.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderViaMcp.mockResolvedValue('MCP-AFTER-RETRY');

    render(
      <McpProvider>
        <Harness />
      </McpProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('mcp-banner')).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-retry'));
    });

    await waitFor(() => expect(screen.queryByTestId('mcp-banner')).toBeNull());
    await waitFor(() =>
      expect(screen.getByTestId('harness-text').textContent).toBe('MCP-AFTER-RETRY'),
    );
    expect(probeMcp).toHaveBeenCalledTimes(2);
  });

  it('mid-session render error falls back silently and does NOT toggle the banner', async () => {
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
    // Banner never appears — probe was never re-run from a single failure.
    expect(screen.queryByTestId('mcp-banner')).toBeNull();
    expect(probeMcp).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
