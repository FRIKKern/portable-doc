/**
 * Reverse-pipeline tests: TipTap JSON → PortableDoc.
 *
 * We don't try to exhaustively snapshot every block — `composeDocument`
 * + the backend snapshot suites already cover the forward render path.
 * Here we focus on the SHAPE: that each TipTap node maps to the
 * expected PortableDoc block kind, with attrs preserved.
 */
import { describe, expect, it } from 'vitest';
import { tiptapToPortableDoc } from './tiptap-to-portable-doc.js';

describe('tiptapToPortableDoc — block shapes', () => {
  it('maps heading + level attr', () => {
    const out = tiptapToPortableDoc({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hello' }] },
      ],
    });
    expect(out.blocks).toHaveLength(1);
    const b = out.blocks[0];
    expect(b?.type).toBe('heading');
    if (b?.type === 'heading') {
      expect(b.level).toBe(2);
      expect(b.text).toBe('Hello');
    }
  });

  it('clamps heading level out of 1..6 range', () => {
    const out = tiptapToPortableDoc({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 99 }, content: [{ type: 'text', text: 'X' }] },
      ],
    });
    if (out.blocks[0]?.type === 'heading') {
      expect(out.blocks[0].level).toBe(6);
    } else {
      throw new Error('expected heading');
    }
  });

  it('maps paragraph with inline marks (bold + italic + code + link)', () => {
    const out = tiptapToPortableDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'plain ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' italic', marks: [{ type: 'italic' }] },
            { type: 'text', text: ' code', marks: [{ type: 'code' }] },
            {
              type: 'text',
              text: ' link',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            },
          ],
        },
      ],
    });
    const b = out.blocks[0];
    expect(b?.type).toBe('paragraph');
    if (b?.type !== 'paragraph') return;
    expect(b.content).toHaveLength(5);
    expect(b.content[0]).toEqual({ type: 'text', value: 'plain ' });
    expect(b.content[1]).toEqual({
      type: 'strong',
      children: [{ type: 'text', value: 'bold' }],
    });
    expect(b.content[2]).toEqual({
      type: 'em',
      children: [{ type: 'text', value: ' italic' }],
    });
    expect(b.content[3]).toEqual({ type: 'code', value: ' code' });
    expect(b.content[4]).toEqual({
      type: 'link',
      href: 'https://example.com',
      children: [{ type: 'text', value: ' link' }],
    });
  });

  it('maps bullet list to list block with items[][]', () => {
    const out = tiptapToPortableDoc({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }],
            },
          ],
        },
      ],
    });
    const b = out.blocks[0];
    expect(b?.type).toBe('list');
    if (b?.type !== 'list') return;
    expect(b.ordered).toBeUndefined();
    expect(b.items).toHaveLength(2);
    expect(b.items[0]).toEqual([{ type: 'text', value: 'first' }]);
    expect(b.items[1]).toEqual([{ type: 'text', value: 'second' }]);
  });

  it('marks orderedList with ordered: true', () => {
    const out = tiptapToPortableDoc({
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
            },
          ],
        },
      ],
    });
    const b = out.blocks[0];
    expect(b?.type).toBe('list');
    if (b?.type !== 'list') return;
    expect(b.ordered).toBe(true);
  });

  it('maps blockquote → callout, reads tone + emphasis from variant attr', () => {
    const out = tiptapToPortableDoc({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          attrs: { variant: { tone: 'warning', emphasis: 'bold' } },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'careful' }] }],
        },
      ],
    });
    const b = out.blocks[0];
    expect(b?.type).toBe('callout');
    if (b?.type !== 'callout') return;
    expect(b.tone).toBe('warning');
    expect(b.variant).toEqual({ tone: 'warning', emphasis: 'bold' });
    expect(b.content).toEqual([{ type: 'text', value: 'careful' }]);
  });

  it('defaults callout tone to "info" when no variant is set', () => {
    const out = tiptapToPortableDoc({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain' }] }],
        },
      ],
    });
    const b = out.blocks[0];
    if (b?.type !== 'callout') throw new Error('expected callout');
    expect(b.tone).toBe('info');
    expect(b.variant).toBeUndefined();
  });

  it('maps codeBlock with language attr', () => {
    const out = tiptapToPortableDoc({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'typescript' },
          content: [{ type: 'text', text: 'const x = 1;' }],
        },
      ],
    });
    const b = out.blocks[0];
    if (b?.type !== 'code') throw new Error('expected code');
    expect(b.lang).toBe('typescript');
    expect(b.value).toBe('const x = 1;');
  });

  it('maps horizontalRule → divider', () => {
    const out = tiptapToPortableDoc({
      type: 'doc',
      content: [{ type: 'horizontalRule' }],
    });
    expect(out.blocks[0]?.type).toBe('divider');
  });

  it('maps image with src + alt', () => {
    const out = tiptapToPortableDoc({
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'https://x.test/a.jpg', alt: 'a' } },
      ],
    });
    const b = out.blocks[0];
    if (b?.type !== 'image') throw new Error('expected image');
    expect(b.src).toBe('https://x.test/a.jpg');
    expect(b.alt).toBe('a');
    expect(b.surfaces).toEqual(['web', 'native']);
  });

  it('maps table → table with rows of cells', () => {
    const out = tiptapToPortableDoc({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Name' }] }],
                },
                {
                  type: 'tableHeader',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Age' }] }],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ada' }] }],
                },
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '36' }] }],
                },
              ],
            },
          ],
        },
      ],
    });
    const b = out.blocks[0];
    if (b?.type !== 'table') throw new Error('expected table');
    expect(b.rows).toHaveLength(2);
    expect(b.rows[0]?.[0]).toEqual([{ type: 'text', value: 'Name' }]);
    expect(b.rows[1]?.[1]).toEqual([{ type: 'text', value: '36' }]);
  });

  it('preserves title + preview from prev when threading through', () => {
    const prev = {
      version: 1 as const,
      title: 'Doc',
      preview: 'lead',
      blocks: [],
    };
    const out = tiptapToPortableDoc({ type: 'doc', content: [] }, prev);
    expect(out.title).toBe('Doc');
    expect(out.preview).toBe('lead');
  });

  it('mints content-hashed block IDs that are stable across identical inputs', () => {
    const a = tiptapToPortableDoc({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'X' }] },
      ],
    });
    const b = tiptapToPortableDoc({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'X' }] },
      ],
    });
    expect(a.blocks[0]?.id).toBe(b.blocks[0]?.id);
  });

  it('drops unknown node types without crashing', () => {
    const out = tiptapToPortableDoc({
      type: 'doc',
      content: [
        { type: 'unknown-future-node' },
        { type: 'paragraph', content: [{ type: 'text', text: 'kept' }] },
      ],
    });
    expect(out.blocks).toHaveLength(1);
    expect(out.blocks[0]?.type).toBe('paragraph');
  });
});
