/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import type { Block, Tone } from '@portable-doc/core';
import { tonePalette } from '@portable-doc/core';
import { BlockTile, blockTone, previewText } from './BlockTile.js';

function wrap(children: React.ReactNode, ids: string[]) {
  return (
    <DndContext>
      <SortableContext items={ids}>{children}</SortableContext>
    </DndContext>
  );
}

const headingBlock: Block = { id: 'h1', type: 'heading', level: 1, text: 'Hello world' };
const paragraphBlock: Block = {
  id: 'p1',
  type: 'paragraph',
  content: [{ type: 'text', value: 'A short paragraph.' }],
};
const calloutBlock = (tone: Tone): Block => ({
  id: `c-${tone}`,
  type: 'callout',
  tone,
  title: 'Note',
  content: [{ type: 'text', value: 'body' }],
});
const actionBlock: Block = {
  id: 'a1',
  type: 'action',
  label: 'Continue',
  href: '#',
  priority: 'primary',
};
const dividerBlock: Block = { id: 'd1', type: 'divider' };

describe('BlockTile', () => {
  it('renders five tiles, each with type label, preview, and drag handle', () => {
    const blocks: Block[] = [
      headingBlock,
      paragraphBlock,
      calloutBlock('info'),
      actionBlock,
      dividerBlock,
    ];
    render(
      wrap(
        <>
          {blocks.map((b) => (
            <BlockTile key={b.id} block={b} selected={false} onSelect={() => {}} dispatch={() => {}} />
          ))}
        </>,
        blocks.map((b) => b.id),
      ),
    );
    for (const b of blocks) {
      const tile = screen.getByTestId(`tile-${b.id}`);
      expect(tile.textContent).toContain(b.type);
      expect(screen.getByTestId(`drag-${b.id}`)).toBeTruthy();
    }
    // heading preview includes 'H1 Hello world'
    expect(screen.getByTestId('tile-h1').textContent).toMatch(/H1 Hello world/);
    // divider preview prints divider sentinel
    expect(screen.getByTestId('tile-d1').textContent).toMatch(/divider/);
  });

  it.each<[Tone]>([['success'], ['warning'], ['danger'], ['info'], ['neutral']])(
    'tone stripe color matches tonePalette[%s].fg for callout',
    (tone) => {
      const block = calloutBlock(tone);
      render(
        wrap(<BlockTile block={block} selected={false} onSelect={() => {}} dispatch={() => {}} />, [
          block.id,
        ]),
      );
      const tile = screen.getByTestId(`tile-${block.id}`) as HTMLElement;
      expect(tile.getAttribute('data-tone')).toBe(tone);
      // borderLeft inline style carries the tone fg color. jsdom serializes
      // hex to rgb(); compare via CSSStyleDeclaration which round-trips both.
      const probe = document.createElement('div');
      probe.style.color = tonePalette[tone].fg;
      const expectedRgb = probe.style.color;
      expect(tile.style.borderLeftColor).toBe(expectedRgb);
      expect(tile.style.borderLeftWidth).toBe('4px');
      expect(tile.style.borderLeftStyle).toBe('solid');
    },
  );

  it('non-tonable blocks (heading, divider, action, paragraph) leave data-tone empty', () => {
    const blocks: Block[] = [headingBlock, dividerBlock, actionBlock, paragraphBlock];
    render(
      wrap(
        <>
          {blocks.map((b) => (
            <BlockTile key={b.id} block={b} selected={false} onSelect={() => {}} dispatch={() => {}} />
          ))}
        </>,
        blocks.map((b) => b.id),
      ),
    );
    for (const b of blocks) {
      const tile = screen.getByTestId(`tile-${b.id}`);
      expect(tile.getAttribute('data-tone')).toBe('');
    }
  });

  it('clicking the tile body fires onSelect', () => {
    const onSelect = vi.fn();
    render(
      wrap(<BlockTile block={headingBlock} selected={false} onSelect={onSelect} dispatch={() => {}} />, [
        headingBlock.id,
      ]),
    );
    fireEvent.click(screen.getByTestId(`tile-${headingBlock.id}`));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('drag handle is a button with an aria-label and does not bubble click to onSelect', () => {
    const onSelect = vi.fn();
    render(
      wrap(<BlockTile block={headingBlock} selected={false} onSelect={onSelect} dispatch={() => {}} />, [
        headingBlock.id,
      ]),
    );
    const handle = screen.getByTestId(`drag-${headingBlock.id}`);
    expect(handle.tagName).toBe('BUTTON');
    expect(handle.getAttribute('aria-label')).toMatch(/Drag/);
    fireEvent.click(handle);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selected tile gets the selected class', () => {
    render(
      wrap(<BlockTile block={headingBlock} selected={true} onSelect={() => {}} dispatch={() => {}} />, [
        headingBlock.id,
      ]),
    );
    const tile = screen.getByTestId(`tile-${headingBlock.id}`);
    expect(tile.className).toMatch(/\bselected\b/);
  });

  it('keyboard fallback up/down/delete buttons dispatch the right actions', () => {
    const dispatch = vi.fn();
    render(
      wrap(
        <BlockTile
          block={headingBlock}
          selected={false}
          onSelect={() => {}}
          dispatch={dispatch}
        />,
        [headingBlock.id],
      ),
    );
    fireEvent.click(screen.getByLabelText(`Move ${headingBlock.id} up`));
    fireEvent.click(screen.getByLabelText(`Move ${headingBlock.id} down`));
    fireEvent.click(screen.getByLabelText(`Delete ${headingBlock.id}`));
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(dispatch).toHaveBeenNthCalledWith(1, { kind: 'move', blockId: 'h1', direction: 'up' });
    expect(dispatch).toHaveBeenNthCalledWith(2, { kind: 'move', blockId: 'h1', direction: 'down' });
    expect(dispatch).toHaveBeenNthCalledWith(3, { kind: 'delete', blockId: 'h1' });
  });
});

describe('previewText', () => {
  it('truncates to 30 chars + ellipsis', () => {
    const long: Block = {
      id: 'long',
      type: 'paragraph',
      content: [{ type: 'text', value: 'x'.repeat(80) }],
    };
    const out = previewText(long);
    expect(out.endsWith('…')).toBe(true);
    // 30 chars + the ellipsis
    expect(out.length).toBe(31);
  });

  it('leaves short content alone', () => {
    expect(previewText({ id: 'd', type: 'divider' })).toBe('— divider —');
  });

  it('formats heading as H{level} {text}', () => {
    expect(previewText(headingBlock)).toBe('H1 Hello world');
  });
});

describe('blockTone', () => {
  it('returns tone for callout', () => {
    expect(blockTone(calloutBlock('warning'))).toBe('warning');
  });

  it('returns undefined for non-tonable block types', () => {
    expect(blockTone(headingBlock)).toBeUndefined();
    expect(blockTone(dividerBlock)).toBeUndefined();
    expect(blockTone(actionBlock)).toBeUndefined();
  });
});
