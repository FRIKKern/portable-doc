/**
 * Block-shaped tile rendered in the left panel of the editor.
 *
 * Per A2 / build-phase grill q2: replaces the text-only block-row with a
 * sortable tile featuring type icon, content preview, tone color stripe
 * (callout/action), and a real drag handle wired through @dnd-kit/sortable.
 *
 * The handle attaches dnd-kit's listeners; clicking the tile body still
 * selects the block (preserves existing selection contract). Up/↓/× action
 * buttons remain as keyboard fallback for non-DnD users.
 */
import { useRef } from 'react';
import type { Block, BlockType, Tone, ValidationIssue } from '@portable-doc/core';
import { tonePalette } from '@portable-doc/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Action } from './store.js';

const TYPE_ICONS: Record<BlockType, string> = {
  heading: 'H',
  paragraph: '¶',
  list: '☰',
  callout: '◉',
  action: '▸',
  section: '§',
  divider: '┄',
  code: '<>',
  image: '⊡',
  table: '▦',
};

interface BlockTileProps {
  block: Block;
  selected: boolean;
  onSelect: () => void;
  dispatch: (a: Action) => void;
  issues?: ValidationIssue[];
}

export function BlockTile({ block, selected, onSelect, dispatch, issues }: BlockTileProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id });
  const tileRef = useRef<HTMLDivElement | null>(null);

  const t = blockTone(block);
  const stripeColor = t ? tonePalette[t].fg : null;
  const hasIssues = issues && issues.length > 0;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    borderLeft: stripeColor ? `4px solid ${stripeColor}` : '4px solid transparent',
    position: 'relative',
  };

  function setRefs(el: HTMLDivElement | null) {
    setNodeRef(el);
    tileRef.current = el;
  }

  return (
    <div
      ref={setRefs}
      className={`block-tile${selected ? ' selected' : ''}`}
      style={style}
      onClick={onSelect}
      data-block-id={block.id}
      data-testid={`tile-${block.id}`}
      data-tone={t ?? ''}
    >
      <span className="block-tile-icon" aria-hidden>
        {TYPE_ICONS[block.type]}
      </span>
      <div className="block-tile-content">
        <div className="block-tile-type">{block.type}</div>
        <div className="block-tile-preview summary">{previewText(block)}</div>
      </div>
      <button
        className="block-tile-handle"
        aria-label={`Drag ${block.id}`}
        data-testid={`drag-${block.id}`}
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
      >
        ⋮⋮
      </button>
      <span className="actions">
        <button
          aria-label={`Move ${block.id} up`}
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ kind: 'move', blockId: block.id, direction: 'up' });
          }}
        >
          ↑
        </button>
        <button
          aria-label={`Move ${block.id} down`}
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ kind: 'move', blockId: block.id, direction: 'down' });
          }}
        >
          ↓
        </button>
        <button
          aria-label={`Delete ${block.id}`}
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ kind: 'delete', blockId: block.id });
          }}
        >
          ×
        </button>
      </span>
      {hasIssues && (
        <button
          type="button"
          className="block-tile-diagnostics-dot"
          aria-label={`${issues!.length} validation issue${issues!.length === 1 ? '' : 's'}`}
          data-testid={`diagnostics-dot-${block.id}`}
          data-count={issues!.length}
          title={issues!.map((i) => `${i.rule}: ${i.message}`).join('\n')}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
            tileRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }}
        >
          {issues!.length > 1 ? issues!.length : ''}
        </button>
      )}
    </div>
  );
}

export function blockTone(block: Block): Tone | undefined {
  if (block.type === 'callout') return block.tone;
  return undefined;
}

const PREVIEW_LIMIT = 30;

export function previewText(block: Block): string {
  const raw = rawPreview(block);
  return raw.length > PREVIEW_LIMIT ? raw.slice(0, PREVIEW_LIMIT) + '…' : raw;
}

function rawPreview(block: Block): string {
  switch (block.type) {
    case 'heading':
      return `H${block.level} ${block.text}`;
    case 'paragraph':
      return flatten(block.content);
    case 'list': {
      const first = block.items[0];
      const head = first ? flatten(first) : '';
      return `${block.items.length} items: ${head}`;
    }
    case 'callout':
      return `${block.tone}: ${block.title ?? flatten(block.content)}`;
    case 'action':
      return `${block.priority} → ${block.label}`;
    case 'section':
      return `§ ${block.title ?? '(untitled)'} (${block.blocks.length})`;
    case 'divider':
      return '— divider —';
    case 'code':
      return `code (${block.lang ?? 'plain'})`;
    case 'image':
      return `img: ${block.alt}`;
    case 'table':
      return `table ${block.rows.length}×${block.rows[0]?.length ?? 0}`;
  }
}

function flatten(nodes: ReadonlyArray<{ type: string; value?: string; children?: unknown }>): string {
  let out = '';
  for (const n of nodes) {
    if ('value' in n && typeof n.value === 'string') out += n.value;
    else if (Array.isArray(n.children))
      out += flatten(n.children as Array<{ type: string; value?: string }>);
  }
  return out;
}
