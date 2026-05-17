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
import type { BlockType } from '@portable-doc/core';
import { COMMANDS, filterCommands, type SlashCommand } from './lib/slash-filter.js';

/**
 * Inline lucide-style icon — 16×16, stroke="currentColor", stroke-width="1.5".
 * Hand-rolled paths (no `lucide-react` dep). Each `type` maps to a simple
 * pictogram tuned to read at this size; the row's `color` (CSS, A-active
 * row resolves to warm-rust) flows through `currentColor`.
 */
function Icon({ type }: { type: BlockType }): JSX.Element {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };
  switch (type) {
    case 'heading':
      // "type" — capital T with serifs
      return (
        <svg {...common}>
          <path d="M5 6h14" />
          <path d="M12 6v13" />
        </svg>
      );
    case 'paragraph':
      // "pilcrow" — paragraph mark
      return (
        <svg {...common}>
          <path d="M13 4v16" />
          <path d="M17 4v16" />
          <path d="M17 4h-7a4 4 0 0 0 0 8h3" />
        </svg>
      );
    case 'list':
      // "list" — three lines with leading dots
      return (
        <svg {...common}>
          <path d="M9 6h11" />
          <path d="M9 12h11" />
          <path d="M9 18h11" />
          <circle cx="4.5" cy="6" r="1" />
          <circle cx="4.5" cy="12" r="1" />
          <circle cx="4.5" cy="18" r="1" />
        </svg>
      );
    case 'callout':
      // "message-square" — quiet card hint
      return (
        <svg {...common}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'action':
      // "arrow-right-circle" — CTA
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12h8" />
          <path d="M13 8l4 4-4 4" />
        </svg>
      );
    case 'section':
      // "rows-3" — grouped blocks
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="5" rx="1" />
          <rect x="3" y="11" width="18" height="2" rx="1" />
          <rect x="3" y="15" width="18" height="5" rx="1" />
        </svg>
      );
    case 'divider':
      // "minus" — horizontal rule
      return (
        <svg {...common}>
          <path d="M4 12h16" />
        </svg>
      );
    case 'code':
      // "code" — angle brackets
      return (
        <svg {...common}>
          <path d="M8 8l-4 4 4 4" />
          <path d="M16 8l4 4-4 4" />
          <path d="M14 5l-4 14" />
        </svg>
      );
    case 'image':
      // "image" — frame + sun + hill
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="1.5" />
          <path d="M21 16l-5-5-9 9" />
        </svg>
      );
    case 'table':
      // "table-2" — grid
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="1" />
          <path d="M3 10h18" />
          <path d="M3 16h18" />
          <path d="M9 4v16" />
          <path d="M15 4v16" />
        </svg>
      );
    default:
      // Defensive fallback — empty span keeps grid columns intact.
      return <svg {...common} />;
  }
}

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
              <span className="paper-slash-popover__icon" aria-hidden="true">
                <Icon type={cmd.type} />
              </span>
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
