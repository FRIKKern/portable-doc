import { describe, expect, it } from 'vitest';
import type { Block, PortableDoc } from '@portable-doc/core';
import welcomeJson from '../../../examples/welcome.json';
import incidentJson from '../../../examples/incident.json';
import { defaultBlock, reducer } from './store.js';

const welcome = welcomeJson as PortableDoc;
const incident = incidentJson as PortableDoc;

const tinyDoc: PortableDoc = {
  version: 1,
  blocks: [
    { id: 'a', type: 'heading', level: 1, text: 'A' },
    { id: 'b', type: 'paragraph', content: [{ type: 'text', value: 'B' }] },
    { id: 'c', type: 'divider' },
  ],
};

describe('store reducer', () => {
  it('load: replaces the doc', () => {
    const next = reducer(welcome, { kind: 'load', doc: incident });
    expect(next).toBe(incident);
  });

  it('add: appends a block of the requested type with a unique id', () => {
    const before = tinyDoc.blocks.length;
    const next = reducer(tinyDoc, { kind: 'add', blockType: 'callout' });
    expect(next.blocks.length).toBe(before + 1);
    const added = next.blocks[next.blocks.length - 1] as Block;
    expect(added.type).toBe('callout');
    expect(added.id).not.toBe('');
    expect(next.blocks.map((b) => b.id).filter((id) => id === added.id).length).toBe(1);
  });

  it('add: insert-after splices in place', () => {
    const next = reducer(tinyDoc, { kind: 'add', blockType: 'divider', afterId: 'a' });
    expect(next.blocks[0]?.id).toBe('a');
    expect(next.blocks[1]?.type).toBe('divider');
    expect(next.blocks[2]?.id).toBe('b');
  });

  it('update: patches the matching block only', () => {
    const next = reducer(tinyDoc, {
      kind: 'update',
      blockId: 'a',
      patch: { text: 'A!' } as Partial<Block>,
    });
    const head = next.blocks[0] as Block;
    expect(head.type).toBe('heading');
    if (head.type === 'heading') expect(head.text).toBe('A!');
    expect(next.blocks[1]?.id).toBe('b');
  });

  it('delete: removes the block', () => {
    const next = reducer(tinyDoc, { kind: 'delete', blockId: 'b' });
    expect(next.blocks.length).toBe(2);
    expect(next.blocks.map((b) => b.id)).toEqual(['a', 'c']);
  });

  it('move up: swaps with previous neighbor', () => {
    const next = reducer(tinyDoc, { kind: 'move', blockId: 'b', direction: 'up' });
    expect(next.blocks.map((b) => b.id)).toEqual(['b', 'a', 'c']);
  });

  it('move down: swaps with next neighbor', () => {
    const next = reducer(tinyDoc, { kind: 'move', blockId: 'a', direction: 'down' });
    expect(next.blocks.map((b) => b.id)).toEqual(['b', 'a', 'c']);
  });

  it('move: no-op at top edge', () => {
    const next = reducer(tinyDoc, { kind: 'move', blockId: 'a', direction: 'up' });
    expect(next).toBe(tinyDoc);
  });

  it('move: no-op at bottom edge', () => {
    const next = reducer(tinyDoc, { kind: 'move', blockId: 'c', direction: 'down' });
    expect(next).toBe(tinyDoc);
  });

  it('defaultBlock: every block type has a sensible default', () => {
    const types: Block['type'][] = [
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
    for (const t of types) {
      const b = defaultBlock(t);
      expect(b.type).toBe(t);
      expect(b.id).toMatch(/^b-/);
    }
  });
});
