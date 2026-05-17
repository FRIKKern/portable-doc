/**
 * Table BubbleMenu — surfaces row / column / table actions when the
 * caret is inside a table cell.
 *
 * Companion to FormatBubble.tsx: both render as children of
 * `@tiptap/react`'s `<BubbleMenu>` substrate. The substrate owns the
 * floating-element positioning; each component owns the toolbar shape.
 * They never co-mount — FormatBubble's `shouldShow` returns false when
 * `isActive('tableCell' | 'tableHeader')`, and this menu's `shouldShow`
 * returns true exactly when that's the case.
 *
 * Actions surfaced (canonical prosemirror-tables commands, all
 * already exposed by `@tiptap/extension-table`):
 *   - addRowBefore   (+ row above)
 *   - addRowAfter    (+ row below)
 *   - addColumnBefore (+ column left)
 *   - addColumnAfter  (+ column right)
 *   - toggleHeaderRow (toggle first row as <th>)
 *   - deleteRow
 *   - deleteColumn
 *   - deleteTable
 *
 * A11y: each button has an aria-label; the toolbar itself carries
 * `role="toolbar" aria-label="Table"`. The icons are inline SVG so
 * they tint with `currentColor` and inherit hover/active states from
 * the shared `.paper-format-bubble__btn` rules.
 */
import type { Editor } from '@tiptap/core';

export interface TableMenuProps {
  editor: Editor;
}

interface IconProps {
  /** Path data composed inside a 24×24 viewBox, stroke 1.5, fill none. */
  children: JSX.Element | JSX.Element[];
}

function Icon({ children }: IconProps): JSX.Element {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable={false}
    >
      {children}
    </svg>
  );
}

export function TableMenu({ editor }: TableMenuProps): JSX.Element {
  // Each button forwards to a single prosemirror-tables command. We
  // route through the chain so focus follows the action — without
  // `.focus()` the caret would stay on the now-deleted row/cell and
  // the editor would lose the active selection on a delete.
  const can = editor.can();

  function fire(cmd: 'addRowBefore' | 'addRowAfter' | 'addColumnBefore' | 'addColumnAfter' | 'deleteRow' | 'deleteColumn' | 'deleteTable' | 'toggleHeaderRow'): void {
    const chain = editor.chain().focus();
    // Each method exists on the chain at runtime once the Table
    // extension is registered. Cast to a dynamic record so the union
    // dispatch stays concise; the runtime methods are guaranteed by
    // @tiptap/extension-table's command registration.
    const dyn = chain as unknown as Record<string, (() => typeof chain) | undefined>;
    const fn = dyn[cmd];
    if (fn) fn().run();
  }

  return (
    <div
      className="paper-format-bubble paper-table-menu"
      role="toolbar"
      aria-label="Table"
      data-testid="table-menu"
    >
      <button
        type="button"
        className="paper-format-bubble__btn"
        aria-label="Add row above"
        title="Add row above"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => fire('addRowBefore')}
        disabled={!can.addRowBefore?.()}
      >
        <Icon>
          <rect x="3" y="3" width="18" height="6" />
          <line x1="9" y1="14" x2="15" y2="14" />
          <line x1="12" y1="11" x2="12" y2="17" />
        </Icon>
      </button>
      <button
        type="button"
        className="paper-format-bubble__btn"
        aria-label="Add row below"
        title="Add row below"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => fire('addRowAfter')}
        disabled={!can.addRowAfter?.()}
      >
        <Icon>
          <rect x="3" y="15" width="18" height="6" />
          <line x1="9" y1="10" x2="15" y2="10" />
          <line x1="12" y1="7" x2="12" y2="13" />
        </Icon>
      </button>
      <span className="paper-format-bubble__sep" aria-hidden="true" />
      <button
        type="button"
        className="paper-format-bubble__btn"
        aria-label="Add column left"
        title="Add column left"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => fire('addColumnBefore')}
        disabled={!can.addColumnBefore?.()}
      >
        <Icon>
          <rect x="3" y="3" width="6" height="18" />
          <line x1="14" y1="9" x2="14" y2="15" />
          <line x1="11" y1="12" x2="17" y2="12" />
        </Icon>
      </button>
      <button
        type="button"
        className="paper-format-bubble__btn"
        aria-label="Add column right"
        title="Add column right"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => fire('addColumnAfter')}
        disabled={!can.addColumnAfter?.()}
      >
        <Icon>
          <rect x="15" y="3" width="6" height="18" />
          <line x1="10" y1="9" x2="10" y2="15" />
          <line x1="7" y1="12" x2="13" y2="12" />
        </Icon>
      </button>
      <span className="paper-format-bubble__sep" aria-hidden="true" />
      <button
        type="button"
        className={
          'paper-format-bubble__btn' +
          (editor.isActive('tableHeader') ? ' paper-format-bubble__btn--active' : '')
        }
        aria-label="Toggle header row"
        title="Toggle header row"
        aria-pressed={editor.isActive('tableHeader')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => fire('toggleHeaderRow')}
        disabled={!can.toggleHeaderRow?.()}
      >
        <Icon>
          <rect x="3" y="3" width="18" height="18" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="12" y1="9" x2="12" y2="21" />
        </Icon>
      </button>
      <span className="paper-format-bubble__sep" aria-hidden="true" />
      <button
        type="button"
        className="paper-format-bubble__btn paper-table-menu__danger"
        aria-label="Delete row"
        title="Delete row"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => fire('deleteRow')}
        disabled={!can.deleteRow?.()}
      >
        <Icon>
          <rect x="3" y="9" width="18" height="6" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </Icon>
      </button>
      <button
        type="button"
        className="paper-format-bubble__btn paper-table-menu__danger"
        aria-label="Delete column"
        title="Delete column"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => fire('deleteColumn')}
        disabled={!can.deleteColumn?.()}
      >
        <Icon>
          <rect x="9" y="3" width="6" height="18" />
          <line x1="12" y1="8" x2="12" y2="16" />
        </Icon>
      </button>
      <button
        type="button"
        className="paper-format-bubble__btn paper-table-menu__danger"
        aria-label="Delete table"
        title="Delete table"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => fire('deleteTable')}
        disabled={!can.deleteTable?.()}
      >
        <Icon>
          <path d="M4 7h16" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M5 7l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13" />
          <path d="M9 7V4h6v3" />
        </Icon>
      </button>
    </div>
  );
}
