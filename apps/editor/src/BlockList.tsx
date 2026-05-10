/**
 * Drag-and-drop sortable list of block tiles.
 *
 * Per A2 / build-phase grill q2: ships real DnD via @dnd-kit/sortable with
 * both PointerSensor and KeyboardSensor (mouse + keyboard), plus the existing
 * up/down action buttons on each tile as fallback. The DragEnd handler
 * dispatches a `reorder` action through the editor's existing reducer.
 */
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { Block, ValidationIssue } from '@portable-doc/core';
import { BlockTile } from './BlockTile.js';
import type { Action } from './store.js';

interface BlockListProps {
  blocks: Block[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (next: Block[]) => void;
  dispatch: (a: Action) => void;
  issuesByBlock?: Map<string, ValidationIssue[]>;
}

/** Pure drag-end handler — exposed for tests so the reorder math can be
 *  validated without a jsdom drag simulation (which is brittle). */
export function applyDragEnd(
  blocks: Block[],
  event: Pick<DragEndEvent, 'active' | 'over'>,
): Block[] | null {
  const { active, over } = event;
  if (!over || active.id === over.id) return null;
  const oldIndex = blocks.findIndex((b) => b.id === active.id);
  const newIndex = blocks.findIndex((b) => b.id === over.id);
  if (oldIndex < 0 || newIndex < 0) return null;
  return arrayMove(blocks, oldIndex, newIndex);
}

export function BlockList({
  blocks,
  selectedId,
  onSelect,
  onReorder,
  dispatch,
  issuesByBlock,
}: BlockListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const next = applyDragEnd(blocks, event);
    if (next) onReorder(next);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        <div data-testid="sortable-block-list">
          {blocks.map((b) => (
            <BlockTile
              key={b.id}
              block={b}
              selected={selectedId === b.id}
              onSelect={() => onSelect(b.id)}
              dispatch={dispatch}
              issues={issuesByBlock?.get(b.id)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
