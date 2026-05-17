/**
 * @vitest-environment happy-dom
 *
 * TrailingNode — appendTransaction behavior + idempotency.
 *
 *   1. Doc ending in a paragraph: no insertion (notAfter excludes it).
 *   2. Doc ending in a heading: an empty paragraph is appended at the
 *      end after the editor mounts (`init` flips the plugin state to
 *      true, the next appendTransaction inserts).
 *   3. After insertion the doc IS terminated by a paragraph — repeat
 *      transactions don't append more paragraphs (idempotency).
 *   4. Editing the heading text triggers a transaction; the trailing
 *      paragraph remains as the only trailing element.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TrailingNode } from './TrailingNode.js';

const editors: Editor[] = [];
function mk(lastBlock: JSONContent): Editor {
  const e = new Editor({
    extensions: [StarterKit, TrailingNode],
    content: { type: 'doc', content: [lastBlock] },
  });
  editors.push(e);
  return e;
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
});

describe('TrailingNode — extension shape', () => {
  it('exposes name "trailingNode" and the canonical option defaults', () => {
    const cfg = (TrailingNode as unknown as {
      config: { addOptions: () => { node: string; notAfter: readonly string[] } };
    }).config;
    expect(cfg.addOptions.call({} as never).node).toBe('paragraph');
    expect(cfg.addOptions.call({} as never).notAfter).toEqual(['paragraph']);
  });
});

describe('TrailingNode — runtime appendTransaction', () => {
  it('does NOT append when the doc already ends in a paragraph', () => {
    const e = mk({ type: 'paragraph', content: [{ type: 'text', text: 'A' }] });
    const last = e.state.doc.lastChild;
    expect(last?.type.name).toBe('paragraph');
    expect(last?.textContent).toBe('A');
    expect(e.state.doc.childCount).toBe(1);
  });

  it('appends an empty paragraph when the doc ends in a heading', () => {
    const e = mk({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'H' }] });
    // Force a flush in case the onCreate dispatch is queued for the
    // next microtask (TipTap usually fires synchronously; under
    // happy-dom selection-update can be deferred).
    e.commands.focus('end');
    // After init + appendTransaction, the doc has 2 children:
    //   [0] heading
    //   [1] empty paragraph (the trailing node)
    expect(e.state.doc.childCount).toBe(2);
    const last = e.state.doc.lastChild;
    expect(last?.type.name).toBe('paragraph');
    expect(last?.content.size).toBe(0);
  });

  it('is idempotent — no extra appends on a follow-up transaction', () => {
    const e = mk({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'H' }] });
    e.commands.focus('end');
    expect(e.state.doc.childCount).toBe(2);
    // Dispatch a no-op transaction that still flips docChanged → false
    // (touching selection only). The trailing-node plugin must not
    // see a stale `shouldInsert` and append again.
    e.commands.setTextSelection(1);
    expect(e.state.doc.childCount).toBe(2);
    // Now an actual content edit on the heading — last block STAYS
    // the empty trailing paragraph.
    e.chain().setTextSelection(2).insertContent(' edited').run();
    expect(e.state.doc.childCount).toBe(2);
    expect(e.state.doc.lastChild?.type.name).toBe('paragraph');
    expect(e.state.doc.lastChild?.content.size).toBe(0);
  });
});
