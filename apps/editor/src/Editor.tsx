/**
 * Block list (left) + edit form (center). Click selects; +/↑/↓/× mutate.
 */
import { useState } from 'react';
import type { Block, BlockType, PortableDoc } from '@portable-doc/core';
import type { Action } from './store.js';
import { BlockForm } from './BlockForm.js';

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

function summarize(b: Block): string {
  switch (b.type) {
    case 'heading':
      return `H${b.level} ${b.text}`;
    case 'paragraph':
      return flatten(b.content);
    case 'list':
      return `${b.items.length} items: ${flatten(b.items[0] ?? [])}`;
    case 'callout':
      return `${b.tone}: ${b.title ?? flatten(b.content)}`;
    case 'action':
      return `${b.priority} → ${b.label}`;
    case 'section':
      return `§ ${b.title ?? '(untitled)'} (${b.blocks.length})`;
    case 'divider':
      return '— divider —';
    case 'code':
      return `code (${b.lang ?? 'plain'})`;
    case 'image':
      return `img: ${b.alt}`;
    case 'table':
      return `table ${b.rows.length}×${b.rows[0]?.length ?? 0}`;
  }
}

function flatten(nodes: ReadonlyArray<{ type: string; value?: string; children?: unknown }>): string {
  let out = '';
  for (const n of nodes) {
    if ('value' in n && typeof n.value === 'string') out += n.value;
    else if (Array.isArray(n.children)) out += flatten(n.children as Array<{ type: string; value?: string }>);
  }
  return out.length > 30 ? out.slice(0, 30) + '…' : out;
}

interface Props {
  doc: PortableDoc;
  selectedId: string | null;
  onSelect: (id: string) => void;
  dispatch: (a: Action) => void;
}

export function Editor({ doc, selectedId, onSelect, dispatch }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const selected = doc.blocks.find((b) => b.id === selectedId) ?? null;

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
        <div style={{ marginTop: 8 }}>
          {doc.blocks.map((b) => (
            <div
              key={b.id}
              className={`block-row${selectedId === b.id ? ' selected' : ''}`}
              onClick={() => onSelect(b.id)}
              data-block-id={b.id}
            >
              <span style={{ width: 22, fontFamily: 'monospace', fontSize: 11 }}>
                {TYPE_GLYPH[b.type]}
              </span>
              <span className="summary">{summarize(b)}</span>
              <span className="actions">
                <button
                  aria-label={`Move ${b.id} up`}
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ kind: 'move', blockId: b.id, direction: 'up' });
                  }}
                >
                  ↑
                </button>
                <button
                  aria-label={`Move ${b.id} down`}
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ kind: 'move', blockId: b.id, direction: 'down' });
                  }}
                >
                  ↓
                </button>
                <button
                  aria-label={`Delete ${b.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ kind: 'delete', blockId: b.id });
                  }}
                >
                  ×
                </button>
              </span>
            </div>
          ))}
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
    </>
  );
}
