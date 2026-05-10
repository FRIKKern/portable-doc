/**
 * McpProvider — owns MCP reachability state for the editor.
 *
 * On mount, probes the MCP HTTP server (`probeMcp`). Surfaces a banner with
 * a "Retry" button when unreachable. Children read state via `useMcp()`.
 *
 * Per grill q8: graceful degradation. When `reachable === null` (initial)
 * or `false` (probe failed), preview surfaces fall back to direct backend
 * imports — the banner only nudges, never blocks.
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
  /** Re-run the probe; banner clears on success. */
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
      {reachable === false && (
        <div
          role="alert"
          data-testid="mcp-banner"
          style={{
            padding: '8px 12px',
            background: '#fef3c7',
            color: '#78350f',
            borderBottom: '1px solid #f59e0b',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span>
            MCP server not running — start with <code>pnpm dev:full</code>, then click
            retry. Editor running on direct backends until then.
          </span>
          <button
            type="button"
            onClick={() => {
              void retry();
            }}
            data-testid="mcp-retry"
          >
            Retry
          </button>
        </div>
      )}
      {children}
    </McpContext.Provider>
  );
}

export function useMcp(): McpContextValue {
  return useContext(McpContext);
}
