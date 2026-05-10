/**
 * Slash-command popover — opens on "/" press, lists 10 PortableDoc block
 * types with substring + Levenshtein-fallback filtering, navigable with
 * arrow keys, Enter/Tab/click inserts, Esc closes.
 *
 * Per A3 / build-phase grill q3: hand-rolled fuzzy match (substring first,
 * Levenshtein dist ≤ 2 fallback). No fuse.js. ~80 LOC.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { filterCommands, type SlashCommand } from './lib/slash-filter.js';

interface SlashPopoverProps {
  open: boolean;
  onSelect: (cmd: SlashCommand) => void;
  onClose: () => void;
  anchor?: { x: number; y: number };
}

export function SlashPopover({ open, onSelect, onClose, anchor }: SlashPopoverProps) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const filtered = useMemo(() => filterCommands(query), [query]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      // Defer focus to next tick so the element is in the DOM.
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  // Clamp active index when filter shrinks below current selection.
  useEffect(() => {
    if (activeIdx > 0 && activeIdx >= filtered.length) {
      setActiveIdx(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, activeIdx]);

  if (!open) return null;

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      setActiveIdx((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setActiveIdx((i) => Math.max(i - 1, 0));
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const pick = filtered[activeIdx];
      if (pick) onSelect(pick);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      onClose();
      e.preventDefault();
    }
  }

  const style: React.CSSProperties = {
    position: 'absolute',
    left: anchor?.x ?? 16,
    top: anchor?.y ?? 60,
    background: '#fff',
    border: '1px solid #ccc',
    borderRadius: 6,
    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
    padding: 6,
    minWidth: 220,
    zIndex: 1000,
  };

  return (
    <div role="listbox" style={style} data-testid="slash-popover">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIdx(0);
        }}
        onKeyDown={onKey}
        placeholder="Filter…"
        aria-label="Filter block types"
        data-testid="slash-input"
        style={{ width: '100%', boxSizing: 'border-box', marginBottom: 4 }}
      />
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 240, overflowY: 'auto' }}>
        {filtered.map((cmd, i) => (
          <li
            key={cmd.type}
            role="option"
            aria-selected={i === activeIdx}
            onClick={() => onSelect(cmd)}
            data-testid={`slash-item-${cmd.type}`}
            style={{
              padding: '4px 8px',
              cursor: 'pointer',
              borderRadius: 4,
              background: i === activeIdx ? '#eef' : 'transparent',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span style={{ fontWeight: 500 }}>{cmd.label}</span>
            <span style={{ color: '#888', fontSize: '0.85em' }}>{cmd.hint}</span>
          </li>
        ))}
        {filtered.length === 0 && (
          <li style={{ padding: '4px 8px', color: '#888' }} data-testid="slash-empty">
            No matches
          </li>
        )}
      </ul>
    </div>
  );
}
