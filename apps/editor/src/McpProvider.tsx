/**
 * McpProvider — pure state provider for MCP reachability.
 *
 * Probes the MCP HTTP server on mount and re-probes on `retry()`. Children
 * read `{ reachable, retry }` via `useMcp()` and decide their own UI:
 *
 *   - v0.4 FooterStatus consumes `reachable` for the footer dot color and
 *     calls `retry` from the inline popover / bottom sheet's Retry button.
 *   - Preview surfaces (`useRenderedContent`) read `reachable` to decide
 *     whether to route through the MCP server or fall back to direct
 *     backend imports.
 *
 * Per grill q8: graceful degradation. `reachable === null` (probing) or
 * `false` (probe failed) both surface the direct-backend path — MCP nudges,
 * never blocks. The v0.3 inline yellow banner was lifted into the
 * FooterStatus dot in A8; the provider itself returns NO UI.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { probeMcp } from './lib/mcp-client.js';

export interface McpContextValue {
  /** null = probing, true = reachable (route via MCP), false = fall back. */
  reachable: boolean | null;
  /** Re-run the probe; reachable flips back to null while in-flight. */
  retry: () => Promise<void>;
}

const McpContext = createContext<McpContextValue>({
  reachable: null,
  retry: async () => {
    /* default no-op outside provider; previews keep using direct backends */
  },
});

export function McpProvider({ children }: { children: ReactNode }) {
  const [reachable, setReachable] = useState<boolean | null>(null);

  const retry = useCallback(async () => {
    setReachable(null);
    const ok = await probeMcp();
    setReachable(ok);
  }, []);

  useEffect(() => {
    void retry();
  }, [retry]);

  return (
    <McpContext.Provider value={{ reachable, retry }}>
      {children}
    </McpContext.Provider>
  );
}

export function useMcp(): McpContextValue {
  return useContext(McpContext);
}
