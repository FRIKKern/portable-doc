/**
 * Tiny doc-state hook backed by `useReducer`.
 *
 * Five actions: load (replace), add (append or insert-after), update (patch
 * matching block), delete, move (swap with neighbor; no-op at edges). New
 * blocks ship with sensible defaults per the AST so the validator stays
 * green on insertion.
 */
import { useReducer } from 'react';
import { nanoid } from 'nanoid';
import type { Block, BlockType, PortableDoc } from '@portable-doc/core';

export type Action =
  | { kind: 'load'; doc: PortableDoc }
  | { kind: 'add'; blockType: BlockType; afterId?: string }
  | { kind: 'update'; blockId: string; patch: Partial<Block> }
  | { kind: 'delete'; blockId: string }
  | { kind: 'move'; blockId: string; direction: 'up' | 'down' }
  | { kind: 'reorder'; blocks: Block[] };

export function defaultBlock(type: BlockType): Block {
  const id = `b-${nanoid(8)}`;
  switch (type) {
    case 'heading':
      return { id, type, level: 2, text: 'New heading' };
    case 'paragraph':
      return { id, type, content: [{ type: 'text', value: 'New paragraph.' }] };
    case 'list':
      return {
        id,
        type,
        ordered: false,
        items: [[{ type: 'text', value: 'Item one' }]],
      };
    case 'callout':
      return {
        id,
        type,
        tone: 'info',
        title: 'Note',
        content: [{ type: 'text', value: 'Callout body.' }],
      };
    case 'action':
      return { id, type, label: 'Open', href: 'https://example.com', priority: 'primary' };
    case 'section':
      return { id, type, title: 'Section', blocks: [] };
    case 'divider':
      return { id, type };
    case 'code':
      return { id, type, lang: 'ts', value: "console.log('hi');" };
    case 'image':
      return {
        id,
        type,
        src: 'https://example.com/cover.png',
        alt: 'cover',
        surfaces: ['web', 'native'],
      };
    case 'table':
      return {
        id,
        type,
        rows: [[[{ type: 'text', value: 'cell' }]]],
        surfaces: ['web', 'native'],
      };
  }
}

function swap<T>(arr: T[], i: number, j: number): T[] {
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length || i === j) return arr;
  const next = arr.slice();
  const a = next[i] as T;
  const b = next[j] as T;
  next[i] = b;
  next[j] = a;
  return next;
}

export function reducer(state: PortableDoc, action: Action): PortableDoc {
  switch (action.kind) {
    case 'load':
      return action.doc;
    case 'add': {
      const fresh = defaultBlock(action.blockType);
      if (!action.afterId) return { ...state, blocks: [...state.blocks, fresh] };
      const idx = state.blocks.findIndex((b) => b.id === action.afterId);
      if (idx < 0) return { ...state, blocks: [...state.blocks, fresh] };
      const next = state.blocks.slice();
      next.splice(idx + 1, 0, fresh);
      return { ...state, blocks: next };
    }
    case 'update': {
      const blocks = state.blocks.map((b) =>
        b.id === action.blockId ? ({ ...b, ...action.patch } as Block) : b,
      );
      return { ...state, blocks };
    }
    case 'delete':
      return { ...state, blocks: state.blocks.filter((b) => b.id !== action.blockId) };
    case 'move': {
      const idx = state.blocks.findIndex((b) => b.id === action.blockId);
      if (idx < 0) return state;
      const target = action.direction === 'up' ? idx - 1 : idx + 1;
      const next = swap(state.blocks, idx, target);
      if (next === state.blocks) return state;
      return { ...state, blocks: next };
    }
    case 'reorder':
      return { ...state, blocks: action.blocks };
  }
}

export function useDoc(initial: PortableDoc) {
  return useReducer(reducer, initial);
}
