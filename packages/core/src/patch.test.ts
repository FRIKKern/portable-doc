/**
 * Coverage for `applyDocPatch` — the pure, recursive, type-safe patch core.
 *
 * Asserts the three properties the editor reducer lacks:
 *   - purity/immutability (input doc untouched; untouched subtrees shared),
 *   - recursion into `section.blocks` at depth,
 *   - no cross-type field bleed on `patch-block`.
 *
 * Plus a round-trip of all five ops and every structured-error guard path.
 */

import { describe, expect, it } from 'vitest';
import { applyDocPatch, type DocPatchOp } from './patch.js';
import type { Block, HeadingBlock, ParagraphBlock, PortableDoc } from './ast.js';

const heading = (id: string, text = 'Title'): HeadingBlock => ({
  id,
  type: 'heading',
  level: 2,
  text,
});

const paragraph = (id: string, value = 'Body.'): ParagraphBlock => ({
  id,
  type: 'paragraph',
  content: [{ type: 'text', value }],
});

function baseDoc(): PortableDoc {
  return {
    version: 1,
    title: 'Doc',
    blocks: [
      heading('h1', 'Top'),
      {
        id: 'sec1',
        type: 'section',
        title: 'Section',
        blocks: [
          paragraph('p-nested', 'Nested body.'),
          {
            id: 'sec-inner',
            type: 'section',
            blocks: [heading('h-deep', 'Deep')],
          },
        ],
      },
      paragraph('p-top', 'Top body.'),
    ],
  };
}

/** Pull the block with `id` out of a doc, recursing sections. */
function find(doc: PortableDoc, id: string): Block | undefined {
  const walk = (blocks: Block[]): Block | undefined => {
    for (const b of blocks) {
      if (b.id === id) return b;
      if (b.type === 'section') {
        const hit = walk(b.blocks);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  return walk(doc.blocks);
}

describe('applyDocPatch — round-trip of all five ops', () => {
  it('append-block adds at top level', () => {
    const doc = baseDoc();
    const res = applyDocPatch(doc, { op: 'append-block', block: heading('h-new', 'New') });
    expect(res.applied).toBe(true);
    expect(res.error).toBeUndefined();
    expect(res.doc.blocks).toHaveLength(4);
    expect(res.doc.blocks[3]).toEqual(heading('h-new', 'New'));
  });

  it('insert-after places the block immediately after the anchor', () => {
    const doc = baseDoc();
    const res = applyDocPatch(doc, {
      op: 'insert-after',
      afterId: 'h1',
      block: paragraph('p-ins', 'Inserted.'),
    });
    expect(res.applied).toBe(true);
    expect(res.doc.blocks.map((b) => b.id)).toEqual(['h1', 'p-ins', 'sec1', 'p-top']);
  });

  it('patch-block merges fields on the matched block', () => {
    const doc = baseDoc();
    const res = applyDocPatch(doc, {
      op: 'patch-block',
      id: 'h1',
      patch: { text: 'Updated', level: 3 } as Partial<Block>,
    });
    expect(res.applied).toBe(true);
    expect(find(res.doc, 'h1')).toEqual({ id: 'h1', type: 'heading', level: 3, text: 'Updated' });
  });

  it('replace-block swaps the whole block', () => {
    const doc = baseDoc();
    const replacement = paragraph('p-top', 'Replaced.');
    const res = applyDocPatch(doc, { op: 'replace-block', id: 'p-top', block: replacement });
    expect(res.applied).toBe(true);
    expect(find(res.doc, 'p-top')).toEqual(replacement);
  });

  it('remove-block drops the block', () => {
    const doc = baseDoc();
    const res = applyDocPatch(doc, { op: 'remove-block', id: 'h1' });
    expect(res.applied).toBe(true);
    expect(find(res.doc, 'h1')).toBeUndefined();
    expect(res.doc.blocks.map((b) => b.id)).toEqual(['sec1', 'p-top']);
  });
});

describe('applyDocPatch — recursion into nested sections', () => {
  it('patch-block reaches a block nested two sections deep', () => {
    const doc = baseDoc();
    const res = applyDocPatch(doc, {
      op: 'patch-block',
      id: 'h-deep',
      patch: { text: 'Deeper' } as Partial<Block>,
    });
    expect(res.applied).toBe(true);
    expect(find(res.doc, 'h-deep')).toEqual({
      id: 'h-deep',
      type: 'heading',
      level: 2,
      text: 'Deeper',
    });
  });

  it('insert-after places a sibling inside a nested section', () => {
    const doc = baseDoc();
    const res = applyDocPatch(doc, {
      op: 'insert-after',
      afterId: 'p-nested',
      block: heading('h-sib', 'Sibling'),
    });
    expect(res.applied).toBe(true);
    const sec = find(res.doc, 'sec1');
    expect(sec?.type).toBe('section');
    if (sec?.type === 'section') {
      expect(sec.blocks.map((b) => b.id)).toEqual(['p-nested', 'h-sib', 'sec-inner']);
    }
  });

  it('remove-block removes a deeply nested block', () => {
    const doc = baseDoc();
    const res = applyDocPatch(doc, { op: 'remove-block', id: 'h-deep' });
    expect(res.applied).toBe(true);
    expect(find(res.doc, 'h-deep')).toBeUndefined();
    const inner = find(res.doc, 'sec-inner');
    if (inner?.type === 'section') expect(inner.blocks).toEqual([]);
  });
});

describe('applyDocPatch — purity & structural sharing', () => {
  it('never mutates the input doc', () => {
    const doc = baseDoc();
    const snapshot = structuredClone(doc);
    applyDocPatch(doc, { op: 'remove-block', id: 'h-deep' });
    applyDocPatch(doc, { op: 'append-block', block: heading('x') });
    applyDocPatch(doc, { op: 'patch-block', id: 'h1', patch: { text: 'no' } as Partial<Block> });
    expect(doc).toEqual(snapshot);
  });

  it('shares untouched subtrees by identity (copies only the target path)', () => {
    const doc = baseDoc();
    const res = applyDocPatch(doc, {
      op: 'patch-block',
      id: 'h-deep',
      patch: { text: 'changed' } as Partial<Block>,
    });
    // p-top is on a different branch — same object reference.
    expect(res.doc.blocks[2]).toBe(doc.blocks[2]);
    // The path to the target is rebuilt — new references all the way down.
    expect(res.doc.blocks[1]).not.toBe(doc.blocks[1]);
  });
});

describe('applyDocPatch — no cross-type field bleed', () => {
  it('patch-block keeps id + type even if the patch tries to change them', () => {
    const doc = baseDoc();
    const res = applyDocPatch(doc, {
      op: 'patch-block',
      id: 'h1',
      patch: { id: 'hacked', text: 'Kept' } as Partial<Block>,
    });
    expect(res.applied).toBe(true);
    const block = find(res.doc, 'h1') as HeadingBlock;
    expect(block.id).toBe('h1');
    expect(block.type).toBe('heading');
    expect(block.text).toBe('Kept');
    expect(find(res.doc, 'hacked')).toBeUndefined();
  });

  it('rejects a patch whose type mismatches the target', () => {
    const doc = baseDoc();
    const res = applyDocPatch(doc, {
      op: 'patch-block',
      id: 'h1',
      patch: { type: 'paragraph', content: [] } as Partial<Block>,
    });
    expect(res.applied).toBe(false);
    expect(res.error).toBe('type-mismatch');
    // Doc returned unchanged.
    expect(res.doc).toBe(doc);
    expect(find(res.doc, 'h1')).toEqual(heading('h1', 'Top'));
  });
});

describe('applyDocPatch — guard paths', () => {
  it('append-block rejects a duplicate id (at top level)', () => {
    const doc = baseDoc();
    const res = applyDocPatch(doc, { op: 'append-block', block: paragraph('h1') });
    expect(res.applied).toBe(false);
    expect(res.error).toBe('duplicate-id');
    expect(res.doc).toBe(doc);
  });

  it('append-block rejects a duplicate id that lives nested in a section', () => {
    const doc = baseDoc();
    const res = applyDocPatch(doc, { op: 'append-block', block: paragraph('h-deep') });
    expect(res.applied).toBe(false);
    expect(res.error).toBe('duplicate-id');
  });

  it('insert-after rejects a duplicate id', () => {
    const doc = baseDoc();
    const res = applyDocPatch(doc, {
      op: 'insert-after',
      afterId: 'h1',
      block: paragraph('p-top'),
    });
    expect(res.applied).toBe(false);
    expect(res.error).toBe('duplicate-id');
  });

  it('insert-after on a missing anchor → block-not-found', () => {
    const doc = baseDoc();
    const res = applyDocPatch(doc, {
      op: 'insert-after',
      afterId: 'nope',
      block: paragraph('p-ins'),
    });
    expect(res.applied).toBe(false);
    expect(res.error).toBe('block-not-found');
    expect(res.doc).toBe(doc);
  });

  it('patch-block on a missing id → block-not-found', () => {
    const doc = baseDoc();
    const res = applyDocPatch(doc, {
      op: 'patch-block',
      id: 'nope',
      patch: { text: 'x' } as Partial<Block>,
    });
    expect(res.applied).toBe(false);
    expect(res.error).toBe('block-not-found');
  });

  it('replace-block on a missing id → block-not-found', () => {
    const doc = baseDoc();
    const res = applyDocPatch(doc, { op: 'replace-block', id: 'nope', block: heading('z') });
    expect(res.applied).toBe(false);
    expect(res.error).toBe('block-not-found');
  });

  it('remove-block on a missing id → block-not-found', () => {
    const doc = baseDoc();
    const res = applyDocPatch(doc, { op: 'remove-block', id: 'nope' });
    expect(res.applied).toBe(false);
    expect(res.error).toBe('block-not-found');
    expect(res.doc).toBe(doc);
  });

  it('exhaustively narrows DocPatchOp (compile-time guard)', () => {
    const ops: DocPatchOp[] = [
      { op: 'append-block', block: heading('a') },
      { op: 'insert-after', afterId: 'h1', block: heading('b') },
      { op: 'patch-block', id: 'h1', patch: { text: 'c' } as Partial<Block> },
      { op: 'replace-block', id: 'h1', block: heading('d') },
      { op: 'remove-block', id: 'h1' },
    ];
    expect(ops).toHaveLength(5);
  });
});
