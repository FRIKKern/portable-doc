/**
 * A3 — Slash-command popover (paperflow-owned UI).
 *
 * Mounted two ways:
 *   1. Standalone (tests + ad-hoc): pass `open`, `items`, `onSelect`, `onClose`.
 *      The popover renders into the React tree and styles itself absolutely.
 *   2. From the SlashCommand TipTap extension via `@tiptap/react`
 *      `ReactRenderer`: the Suggestion plugin calls `onStart` / `onUpdate` /
 *      `onKeyDown` on the rendered instance. We forward those into a small
 *      `forwardRef` imperative handle so the plugin owns open/close/filter
 *      state and we own the DOM + keyboard.
 *
 * Filtering still goes through `lib/slash-filter.ts` — substring first,
 * Levenshtein ≤ 2 fallback. Grill Q3: no fuse.js for a 10-item menu.
 *
 * Anchor / positioning: when the consumer passes `anchor: {x, y}` we render
 * absolutely at that point (cursor caret rect, computed by the Suggestion
 * plugin's `clientRect()` callback). No tippy.js — that's a transitive dep
 * we'd rather not bind into. Standalone usage falls back to a default anchor.
 *
 * A11y (grill Q12): `role="listbox"` on the outer container, `role="option"`
 * + `aria-selected` on each row, `aria-label="Filter blocks"` on the input.
 * The motion CSS at `.paper-slash-popover` uses `--motion-slash-menu-open`,
 * which `prefers-reduced-motion: reduce` collapses to 0ms.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { COMMANDS, filterCommands, type SlashCommand } from './lib/slash-filter.js';

export interface SlashPopoverProps {
  /** Standalone: whether the popover is visible. Ignored in controlled mode. */
  open?: boolean;
  /**
   * Override the candidate list (Suggestion plugin path). When omitted, the
   * popover filters the full 10-command catalog by its own `query` state.
   */
  items?: readonly SlashCommand[];
  /** Anchor coordinates in viewport space (caret rect). */
  anchor?: { x: number; y: number };
  /** Fires when the user picks an item (Enter, Tab, or click). */
  onSelect: (cmd: SlashCommand) => void;
  /** Fires when the user presses Escape (or the plugin requests dismissal). */
  onClose: () => void;
  /**
   * Controlled mode: the parent supplies the query string + selection index
   * and the popover reflects them. Used by the Suggestion plugin so its
   * `onKeyDown` arrow-nav is the source of truth. Defaults to internal
   * uncontrolled state for the standalone test harness.
   */
  query?: string;
  activeIdx?: number;
  onActiveIdxChange?: (idx: number) => void;
  onQueryChange?: (q: string) => void;
}

/**
 * Imperative handle the SlashCommand extension drives.
 */
export interface SlashPopoverHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const SlashPopover = forwardRef<SlashPopoverHandle, SlashPopoverProps>(
  function SlashPopover(props, ref) {
    const {
      open = true,
      items,
      anchor,
      onSelect,
      onClose,
      query: queryProp,
      activeIdx: activeIdxProp,
      onActiveIdxChange,
      onQueryChange,
    } = props;

    const [queryState, setQueryState] = useState('');
    const [activeIdxState, setActiveIdxState] = useState(0);

    const query = queryProp ?? queryState;
    const activeIdx = activeIdxProp ?? activeIdxState;

    const filtered = useMemo<readonly SlashCommand[]>(() => {
      if (items) return items;
      return filterCommands(query);
    }, [items, query]);

    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (open && !items) {
        queueMicrotask(() => inputRef.current?.focus());
      }
    }, [open, items]);

    useEffect(() => {
      if (activeIdx > 0 && activeIdx >= filtered.length) {
        const next = Math.max(0, filtered.length - 1);
        if (activeIdxProp == null) setActiveIdxState(next);
        else onActiveIdxChange?.(next);
      }
    }, [filtered.length, activeIdx, activeIdxProp, onActiveIdxChange]);

    function setActiveIdx(next: number): void {
      if (activeIdxProp == null) setActiveIdxState(next);
      onActiveIdxChange?.(next);
    }

    function setQuery(next: string): void {
      if (queryProp == null) setQueryState(next);
      onQueryChange?.(next);
      if (activeIdxProp == null) setActiveIdxState(0);
    }

    function commitActive(): void {
      const pick = filtered[activeIdx];
      if (pick) onSelect(pick);
    }

    function handleKey(event: { key: string; preventDefault?: () => void }): boolean {
      if (event.key === 'ArrowDown') {
        setActiveIdx(Math.min(activeIdx + 1, Math.max(0, filtered.length - 1)));
        event.preventDefault?.();
        return true;
      }
      if (event.key === 'ArrowUp') {
        setActiveIdx(Math.max(activeIdx - 1, 0));
        event.preventDefault?.();
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        commitActive();
        event.preventDefault?.();
        return true;
      }
      if (event.key === 'Escape') {
        onClose();
        event.preventDefault?.();
        return true;
      }
      return false;
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => handleKey(event),
    }));

    if (!open) return null;

    const style: React.CSSProperties = {
      position: 'absolute',
      left: anchor?.x ?? 16,
      top: anchor?.y ?? 60,
    };

    return (
      <div
        className="paper-slash-popover"
        role="listbox"
        aria-label="Insert block"
        style={style}
        data-testid="slash-popover"
      >
        <div className="paper-slash-popover__head">Insert block</div>

        {!items && (
          <div className="paper-slash-popover__search">
            <span aria-hidden="true" className="paper-slash-popover__q">⌕</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => handleKey(e)}
              placeholder="Filter blocks"
              aria-label="Filter blocks"
              data-testid="slash-input"
            />
          </div>
        )}

        <ul className="paper-slash-popover__list">
          {filtered.map((cmd, i) => (
            <li
              key={cmd.type}
              role="option"
              aria-selected={i === activeIdx}
              className={
                'paper-slash-popover__row' +
                (i === activeIdx ? ' is-active' : '')
              }
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(cmd);
              }}
              data-testid={
                // Headings ship one entry per level (H1..H6) — append the
                // level so each row has a unique testid for assertions.
                cmd.type === 'heading' && cmd.level
                  ? `slash-item-heading-${cmd.level}`
                  : `slash-item-${cmd.type}`
              }
            >
              <span className="paper-slash-popover__name">{cmd.label}</span>
              <span className="paper-slash-popover__hint">{cmd.hint}</span>
            </li>
          ))}
          {filtered.length === 0 && (
            <li
              className="paper-slash-popover__empty"
              data-testid="slash-empty"
              role="presentation"
            >
              No matches
            </li>
          )}
        </ul>

        <div className="paper-slash-popover__foot" aria-hidden="true">
          <kbd>↵</kbd> insert · <kbd>↑↓</kbd> navigate · <kbd>esc</kbd> dismiss
        </div>
      </div>
    );
  },
);

export { COMMANDS };
export type { SlashCommand };
