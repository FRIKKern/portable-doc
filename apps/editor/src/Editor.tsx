/**
 * Block list (left) + edit form (center).
 *
 * After A2: the left panel renders block-shaped tiles with type icons,
 * content previews, and tone color stripes. Tiles are draggable via
 * @dnd-kit/sortable; up/↓/× action buttons remain as keyboard fallback.
 *
 * After A3: pressing "/" anywhere (including inside the TipTap editor)
 * opens the SlashPopover for fast keyboard-driven block insertion. When
 * a block is selected, insertion lands AFTER that block; otherwise the
 * new block is appended to the end (existing reducer semantics).
 */
import { useEffect, useMemo, useState } from 'react';
import type { Block, BlockType, PortableDoc, ValidationIssue } from '@portable-doc/core';
import { validateDoc } from '@portable-doc/core';
import type { Action } from './store.js';
import { BlockForm } from './BlockForm.js';
import { BlockList } from './BlockList.js';
import { DocLevelDiagnostics } from './DocLevelDiagnostics.js';
import { SlashPopover } from './SlashPopover.js';
import type { SlashCommand } from './lib/slash-filter.js';

const ALL_TYPES: BlockType[] = [
  'heading',
  'paragraph',
  'list',
  'callout',
  'action',
  'section',
  'divider',
  'code',
  'image',
  'table',
];

const TYPE_GLYPH: Record<BlockType, string> = {
  heading: 'H',
  paragraph: 'P',
  list: '•',
  callout: '!',
  action: '▶',
  section: '§',
  divider: '—',
  code: '<>',
  image: 'img',
  table: '⊞',
};

interface Props {
  doc: PortableDoc;
  selectedId: string | null;
  onSelect: (id: string) => void;
  dispatch: (a: Action) => void;
}

export function Editor({ doc, selectedId, onSelect, dispatch }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashAnchor, setSlashAnchor] = useState<{ x: number; y: number } | undefined>(undefined);
  const selected = doc.blocks.find((b) => b.id === selectedId) ?? null;

  // Inline diagnostics (A5): re-validate the doc on every change and split
  // issues into per-block + doc-level buckets. Block-level only per grill q5.
  const { byBlock, docLevel } = useMemo(() => {
    const issues: ValidationIssue[] = validateDoc(doc);
    const map = new Map<string, ValidationIssue[]>();
    const dl: ValidationIssue[] = [];
    for (const issue of issues) {
      if (issue.blockId) {
        const arr = map.get(issue.blockId) ?? [];
        arr.push(issue);
        map.set(issue.blockId, arr);
      } else {
        dl.push(issue);
      }
    }
    return { byBlock: map, docLevel: dl };
  }, [doc]);

  // Listen for "/" press anywhere in the editor surface (including inside
  // TipTap fields). Per the acceptance gate, both in-editor "/" and
  // out-of-editor "/" must open the popover.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/') return;
      // Skip if a modifier is held (real find-shortcuts etc.).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Skip if the slash popover input itself has focus (typing inside it).
      const target = e.target as HTMLElement | null;
      if (target?.dataset?.testid === 'slash-input') return;
      e.preventDefault();
      // Anchor: caret position (rough) or a sensible fixed location.
      const anchor = computeAnchor(target);
      setSlashAnchor(anchor);
      setSlashOpen(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function handleSlashSelect(cmd: SlashCommand) {
    dispatch({ kind: 'add', blockType: cmd.type, afterId: selectedId ?? undefined });
    setSlashOpen(false);
  }

  return (
    <>
      <div className="col" data-testid="block-list">
        <h2>Blocks ({doc.blocks.length})</h2>
        <div className="add-popover">
          <button onClick={() => setShowAdd((s) => !s)} aria-label="Add block">+ Add block</button>
          {showAdd && (
            <div className="add-popover-menu" role="menu">
              {ALL_TYPES.map((t) => (
                <button
                  key={t}
                  role="menuitem"
                  onClick={() => {
                    dispatch({ kind: 'add', blockType: t });
                    setShowAdd(false);
                  }}
                >
                  {TYPE_GLYPH[t]} {t}
                </button>
              ))}
            </div>
          )}
        </div>
        <DocLevelDiagnostics issues={docLevel} />
        <div style={{ marginTop: 8 }}>
          <BlockList
            blocks={doc.blocks as Block[]}
            selectedId={selectedId}
            onSelect={onSelect}
            onReorder={(next) => dispatch({ kind: 'reorder', blocks: next })}
            dispatch={dispatch}
            issuesByBlock={byBlock}
          />
        </div>
      </div>
      <div className="col" data-testid="block-form">
        <h2>Edit</h2>
        {selected ? (
          <BlockForm block={selected} dispatch={dispatch} />
        ) : (
          <p style={{ color: '#888' }}>Select a block to edit.</p>
        )}
      </div>
      <SlashPopover
        open={slashOpen}
        onSelect={handleSlashSelect}
        onClose={() => setSlashOpen(false)}
        anchor={slashAnchor}
      />
    </>
  );
}

/**
 * Best-effort anchor for the popover. When the "/" was pressed inside an
 * input/contenteditable, we anchor near that element's bounding rect; when
 * pressed on a non-text target (e.g. a tile), we fall back to a fixed
 * top-left location. Real-world precision is bounded by jsdom test
 * environments — this just needs to land "near enough".
 */
function computeAnchor(target: HTMLElement | null): { x: number; y: number } {
  if (target && typeof target.getBoundingClientRect === 'function') {
    const r = target.getBoundingClientRect();
    if (r.left || r.top || r.width || r.height) {
      return { x: Math.round(r.left + 8), y: Math.round(r.top + r.height + 4) };
    }
  }
  return { x: 80, y: 100 };
}
