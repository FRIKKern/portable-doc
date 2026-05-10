/**
 * Sandbox / disposable spec — proves TipTap v3 + StarterKit can round-trip
 * our `InlineNode[]` shape across all four text-bearing block contexts
 * (paragraph body, callout body, list-item, action label) without losing
 * the four mark types we care about (bold, em, code, link with href).
 *
 * Round-trip is asserted on a normalized form on both sides. The normalization
 * (see `inline-node-tiptap.ts`) flattens nested-children into runs, merges
 * adjacent identical-mark runs, drops empties, then re-wraps with deterministic
 * outermost-to-innermost ordering: strong > em > link > code/text. This is
 * what TipTap itself does internally (its schema stores marks on flat text
 * nodes), so the comparison is meaningful: we round-trip through TipTap's
 * editor state and assert nothing was lost relative to the same normalization.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import type { InlineNode } from '@portable-doc/core';
import {
  inlineNodesToTiptap,
  normalizeInline,
  tiptapToInlineNodes,
} from './inline-node-tiptap';
import { type BlockContext, getEditorInline, mountEditor } from './mount-editor';

interface Case {
  context: BlockContext;
  label: string;
  input: InlineNode[];
}

const CASES: Case[] = [
  {
    context: 'paragraph',
    label: 'paragraph body — mixed bold/em/code/link with surrounding text',
    input: [
      { type: 'text', value: 'Hello ' },
      { type: 'strong', children: [{ type: 'text', value: 'world' }] },
      { type: 'text', value: ' with ' },
      { type: 'em', children: [{ type: 'text', value: 'italic' }] },
      { type: 'text', value: ' and ' },
      { type: 'code', value: 'inline code' },
      { type: 'text', value: ' and a ' },
      { type: 'link', href: 'https://example.com', children: [{ type: 'text', value: 'link' }] },
      { type: 'text', value: '.' },
    ],
  },
  {
    context: 'callout',
    label: 'callout body — bold leading + plain trailing',
    input: [
      { type: 'strong', children: [{ type: 'text', value: 'Important:' }] },
      { type: 'text', value: ' please review.' },
    ],
  },
  {
    context: 'list-item',
    label: 'list-item — code + link mixed with plain text',
    input: [
      { type: 'text', value: 'Run ' },
      { type: 'code', value: 'pnpm install' },
      { type: 'text', value: ' or see ' },
      { type: 'link', href: 'https://docs.example.com', children: [{ type: 'text', value: 'the docs' }] },
      { type: 'text', value: '.' },
    ],
  },
  {
    context: 'action-label',
    label: 'action label — strong-wrapped text only',
    input: [{ type: 'strong', children: [{ type: 'text', value: 'Open workspace' }] }],
  },
];

describe('TipTap round-trip — InlineNode[] across four block contexts', () => {
  let editor: Editor | undefined;
  afterEach(() => {
    editor?.destroy();
    editor = undefined;
  });

  for (const c of CASES) {
    it(`${c.context}: ${c.label}`, () => {
      const tiptapContent = inlineNodesToTiptap(c.input);
      editor = mountEditor(c.context, tiptapContent);
      const after = tiptapToInlineNodes(getEditorInline(editor, c.context));
      // Compare on the normalized form — TipTap merges adjacent same-mark
      // text runs, our normalize() does the same, so this is a real
      // round-trip equivalence check.
      expect(after).toEqual(normalizeInline(c.input));
    });
  }

  it('preserves all four mark types end-to-end (bold, em, code, link)', () => {
    const input: InlineNode[] = [
      { type: 'strong', children: [{ type: 'text', value: 'b' }] },
      { type: 'em', children: [{ type: 'text', value: 'i' }] },
      { type: 'code', value: 'c' },
      { type: 'link', href: 'https://x.test', children: [{ type: 'text', value: 'l' }] },
    ];
    editor = mountEditor('paragraph', inlineNodesToTiptap(input));
    const after = tiptapToInlineNodes(getEditorInline(editor, 'paragraph'));

    // All four mark types should be present somewhere in the output.
    const flat = JSON.stringify(after);
    expect(flat).toContain('"strong"');
    expect(flat).toContain('"em"');
    expect(flat).toContain('"code"');
    expect(flat).toContain('"link"');
    expect(flat).toContain('https://x.test');
    expect(after).toEqual(normalizeInline(input));
  });

  it('preserves composed marks (bold link) across the round-trip', () => {
    // A bold link composes both marks on the same TipTap text node.
    // Our re-wrap produces strong > link > text deterministically.
    const input: InlineNode[] = [
      {
        type: 'strong',
        children: [
          {
            type: 'link',
            href: 'https://example.com',
            children: [{ type: 'text', value: 'bold link' }],
          },
        ],
      },
    ];
    editor = mountEditor('paragraph', inlineNodesToTiptap(input));
    const after = tiptapToInlineNodes(getEditorInline(editor, 'paragraph'));
    expect(after).toEqual(normalizeInline(input));
    // Sanity — the deterministic re-wrap is strong-outside, link-inside.
    expect(after[0]?.type).toBe('strong');
  });
});
