/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { arrayMove } from '@dnd-kit/sortable';
import type { Block } from '@portable-doc/core';
import { BlockList, applyDragEnd } from './BlockList.js';

const blocks: Block[] = [
  { id: 'a', type: 'heading', level: 1, text: 'Alpha' },
  { id: 'b', type: 'paragraph', content: [{ type: 'text', value: 'Beta' }] },
  { id: 'c', type: 'divider' },
];

describe('BlockList', () => {
  it('renders one tile per block in order', () => {
    render(
      <BlockList
        blocks={blocks}
        selectedId={null}
        onSelect={() => {}}
        onReorder={() => {}}
        dispatch={() => {}}
      />,
    );
    const tiles = screen.getAllByTestId(/^tile-/);
    expect(tiles.length).toBe(3);
    expect(tiles[0]?.getAttribute('data-block-id')).toBe('a');
    expect(tiles[1]?.getAttribute('data-block-id')).toBe('b');
    expect(tiles[2]?.getAttribute('data-block-id')).toBe('c');
  });

  it('clicking a tile fires onSelect with the right id (selection contract preserved)', () => {
    const onSelect = vi.fn();
    render(
      <BlockList
        blocks={blocks}
        selectedId={null}
        onSelect={onSelect}
        onReorder={() => {}}
        dispatch={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('tile-b'));
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('keyboard fallback: clicking up button dispatches move-up', () => {
    const dispatch = vi.fn();
    render(
      <BlockList
        blocks={blocks}
        selectedId={null}
        onSelect={() => {}}
        onReorder={() => {}}
        dispatch={dispatch}
      />,
    );
    fireEvent.click(screen.getByLabelText('Move b up'));
    expect(dispatch).toHaveBeenCalledWith({ kind: 'move', blockId: 'b', direction: 'up' });
  });

  it('arrayMove: drag-end reorder logic produces the expected array', () => {
    // Validate the same arrayMove integration that BlockList relies on.
    const moved = arrayMove(blocks, 0, 2);
    expect(moved.map((b) => b.id)).toEqual(['b', 'c', 'a']);
  });

  it('applyDragEnd: drop A onto C reorders [a,b,c] -> [b,c,a]', () => {
    const next = applyDragEnd(blocks, {
      active: { id: 'a' } as never,
      over: { id: 'c' } as never,
    });
    expect(next?.map((b) => b.id)).toEqual(['b', 'c', 'a']);
  });

  it('applyDragEnd: drop on self is a no-op (returns null)', () => {
    const next = applyDragEnd(blocks, {
      active: { id: 'b' } as never,
      over: { id: 'b' } as never,
    });
    expect(next).toBeNull();
  });

  it('applyDragEnd: missing over (drop outside any tile) returns null', () => {
    const next = applyDragEnd(blocks, {
      active: { id: 'a' } as never,
      over: null,
    });
    expect(next).toBeNull();
  });

  it('keyboard sensor activator is wired on each drag handle (aria-roledescription)', () => {
    render(
      <BlockList
        blocks={blocks}
        selectedId={null}
        onSelect={() => {}}
        onReorder={() => {}}
        dispatch={() => {}}
      />,
    );
    // dnd-kit attaches role="button" + aria-roledescription="sortable" to
    // each sortable activator. Both PointerSensor and KeyboardSensor share
    // the same listeners — so the presence of the attributes confirms the
    // keyboard activation path is wired.
    const handle = screen.getByTestId('drag-a');
    expect(handle.getAttribute('aria-roledescription')).toBe('sortable');
  });

  it('applyDragEnd matches arrayMove(blocks, oldIndex, newIndex)', () => {
    const expected = arrayMove(blocks, 0, 2);
    const next = applyDragEnd(blocks, {
      active: { id: 'a' } as never,
      over: { id: 'c' } as never,
    });
    expect(next).toEqual(expected);
  });
});
