/**
 * Block list (left) + edit form (center).
 *
 * After A2: the left panel renders block-shaped tiles with type icons,
 * content previews, and tone color stripes. Tiles are draggable via
 * @dnd-kit/sortable; up/↓/× action buttons remain as keyboard fallback.
 */
import { useState } from 'react';
import type { Block, BlockType, PortableDoc } from '@portable-doc/core';
import type { Action } from './store.js';
import { BlockForm } from './BlockForm.js';
import { BlockList } from './BlockList.js';

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
          <BlockList
            blocks={doc.blocks as Block[]}
            selectedId={selectedId}
            onSelect={onSelect}
            onReorder={(next) => dispatch({ kind: 'reorder', blocks: next })}
            dispatch={dispatch}
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
    </>
  );
}
