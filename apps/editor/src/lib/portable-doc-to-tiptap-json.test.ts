/**
 * Forward-pipeline tests: PortableDoc → TipTap JSON.
 *
 * Shape-level coverage of every block kind plus a round-trip check
 * against `tiptapToPortableDoc` to prove the JSON forward + JSON
 * reverse paths compose cleanly.
 */
import { describe, expect, it } from 'vitest';
import type { PortableDoc } from '@portable-doc/core';
import {
  inlineNodes,
  portableDocToTipTapJson,
} from './portable-doc-to-tiptap-json.js';
import { tiptapToPortableDoc } from './tiptap-to-portable-doc.js';

const wrap = (blocks: PortableDoc['blocks']): PortableDoc => ({ version: 1, blocks });

describe('portableDocToTipTapJson — block shapes', () => {
  it('empty doc produces a single empty paragraph inside the doc node', () => {
    const out = portableDocToTipTapJson(wrap([]));
    expect(out.type).toBe('doc');
    expect(out.content).toEqual([{ type: 'paragraph' }]);
  });

  it('heading emits {type:heading, attrs:{level}} and clamps out-of-range levels', () => {
    const out = portableDocToTipTapJson(
      wrap([{ id: 'h', type: 'heading', level: 2, text: 'Hello' }]),
    );
    expect(out.content?.[0]).toEqual({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Hello' }],
    });

    // out-of-range (intentionally typed past the schema for the clamp branch)
    const high = portableDocToTipTapJson(
      wrap([{ id: 'h', type: 'heading', level: 9 as 1, text: 'X' }]),
    );
    const headingNode = high.content?.[0];
    expect(headingNode?.attrs?.level).toBe(6);
  });

  it('paragraph composes inline marks (strong > em → bold + italic order)', () => {
    const out = portableDocToTipTapJson(
      wrap([
        {
          id: 'p',
          type: 'paragraph',
          content: [
            { type: 'text', value: 'plain ' },
            {
              type: 'strong',
              children: [
                { type: 'em', children: [{ type: 'text', value: 'bi' }] },
              ],
            },
            {
              type: 'link',
              href: 'https://example.com',
              children: [{ type: 'text', value: 'l' }],
            },
            { type: 'code', value: 'k' },
          ],
        },
      ]),
    );
    const para = out.content?.[0];
    expect(para?.type).toBe('paragraph');
    const runs = para?.content;
    expect(runs?.[0]).toEqual({ type: 'text', text: 'plain ' });
    expect(runs?.[1]).toEqual({
      type: 'text',
      text: 'bi',
      marks: [{ type: 'bold' }, { type: 'italic' }],
    });
    expect(runs?.[2]).toEqual({
      type: 'text',
      text: 'l',
      marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
    });
    expect(runs?.[3]).toEqual({
      type: 'text',
      text: 'k',
      marks: [{ type: 'code' }],
    });
  });

  it('bullet list emits bulletList > listItem > paragraph', () => {
    const out = portableDocToTipTapJson(
      wrap([
        {
          id: 'l',
          type: 'list',
          items: [
            [{ type: 'text', value: 'one' }],
            [{ type: 'text', value: 'two' }],
          ],
        },
      ]),
    );
    const list = out.content?.[0];
    expect(list?.type).toBe('bulletList');
    expect(list?.content).toHaveLength(2);
    expect(list?.content?.[0]).toEqual({
      type: 'listItem',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'one' }],
      }],
    });
  });

  it('ordered list switches the wrapper type', () => {
    const out = portableDocToTipTapJson(
      wrap([
        {
          id: 'l',
          type: 'list',
          ordered: true,
          items: [[{ type: 'text', value: 'a' }]],
        },
      ]),
    );
    expect(out.content?.[0]?.type).toBe('orderedList');
  });

  it('callout emits blockquote, prepends bold title + hardBreak, preserves variant attr', () => {
    const out = portableDocToTipTapJson(
      wrap([
        {
          id: 'c',
          type: 'callout',
          tone: 'warning',
          title: 'Heads up',
          variant: { tone: 'warning', emphasis: 'bold' },
          content: [{ type: 'text', value: 'body' }],
        },
      ]),
    );
    const bq = out.content?.[0];
    expect(bq?.type).toBe('blockquote');
    expect(bq?.attrs).toEqual({ variant: { tone: 'warning', emphasis: 'bold' } });
    const para = bq?.content?.[0];
    expect(para?.type).toBe('paragraph');
    expect(para?.content?.[0]).toEqual({
      type: 'text',
      text: 'Heads up',
      marks: [{ type: 'bold' }],
    });
    expect(para?.content?.[1]).toEqual({ type: 'hardBreak' });
    expect(para?.content?.[2]).toEqual({ type: 'text', text: 'body' });
  });

  it('callout without title or variant omits the prefix and attrs', () => {
    const out = portableDocToTipTapJson(
      wrap([
        {
          id: 'c',
          type: 'callout',
          tone: 'info',
          content: [{ type: 'text', value: 'plain' }],
        },
      ]),
    );
    const bq = out.content?.[0];
    expect(bq?.attrs).toBeUndefined();
    expect(bq?.content?.[0]?.content).toEqual([{ type: 'text', text: 'plain' }]);
  });

  it('action emits a paragraph holding a link-marked text run', () => {
    const out = portableDocToTipTapJson(
      wrap([
        {
          id: 'a',
          type: 'action',
          label: 'Go',
          href: 'https://example.com',
          priority: 'primary',
        },
      ]),
    );
    expect(out.content?.[0]).toEqual({
      type: 'paragraph',
      content: [{
        type: 'text',
        text: 'Go',
        marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
      }],
    });
  });

  it('section flattens to <h2 title> + nested block emissions', () => {
    const out = portableDocToTipTapJson(
      wrap([
        {
          id: 's',
          type: 'section',
          title: 'Inside',
          blocks: [
            { id: 'h', type: 'heading', level: 3, text: 'Deep' },
            { id: 'p', type: 'paragraph', content: [{ type: 'text', value: 'body' }] },
          ],
        },
      ]),
    );
    expect(out.content).toHaveLength(3);
    expect(out.content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(out.content?.[1]).toMatchObject({ type: 'heading', attrs: { level: 3 } });
    expect(out.content?.[2]?.type).toBe('paragraph');
  });

  it('divider emits horizontalRule', () => {
    const out = portableDocToTipTapJson(wrap([{ id: 'd', type: 'divider' }]));
    expect(out.content?.[0]).toEqual({ type: 'horizontalRule' });
  });

  it('code emits codeBlock with language attr and a single text child', () => {
    const out = portableDocToTipTapJson(
      wrap([{ id: 'c', type: 'code', lang: 'ts', value: 'const x = 1;' }]),
    );
    expect(out.content?.[0]).toEqual({
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const x = 1;' }],
    });
  });

  it('image emits {src, alt, ...optional width/height}', () => {
    const out = portableDocToTipTapJson(
      wrap([
        {
          id: 'i',
          type: 'image',
          src: 'https://x.test/a.jpg',
          alt: 'a',
          width: 640,
          height: 360,
          surfaces: ['web', 'native'],
        },
      ]),
    );
    expect(out.content?.[0]).toEqual({
      type: 'image',
      attrs: { src: 'https://x.test/a.jpg', alt: 'a', width: 640, height: 360 },
    });
  });

  it('table emits tableRow > [tableHeader, tableCell...]', () => {
    const out = portableDocToTipTapJson(
      wrap([
        {
          id: 't',
          type: 'table',
          rows: [
            [
              [{ type: 'text', value: 'A' }],
              [{ type: 'text', value: 'B' }],
            ],
            [
              [{ type: 'text', value: 'C' }],
              [{ type: 'text', value: 'D' }],
            ],
          ],
          surfaces: ['web', 'native'],
        },
      ]),
    );
    const table = out.content?.[0];
    expect(table?.type).toBe('table');
    expect(table?.content?.[0]?.type).toBe('tableRow');
    const row0 = table?.content?.[0]?.content;
    expect(row0?.[0]?.type).toBe('tableHeader');
    expect(row0?.[1]?.type).toBe('tableCell');
    const row1 = table?.content?.[1]?.content;
    expect(row1?.[0]?.type).toBe('tableHeader');
    expect(row1?.[1]?.type).toBe('tableCell');
    expect(row0?.[0]?.content?.[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'A' }],
    });
  });

  it('inlineNodes is exported for downstream composition', () => {
    expect(inlineNodes([{ type: 'text', value: 'x' }])).toEqual([
      { type: 'text', text: 'x' },
    ]);
  });

  it('round-trip: heading + paragraph (marks) + callout (variant) survive forward → reverse', () => {
    const original: PortableDoc = wrap([
      { id: 'h', type: 'heading', level: 2, text: 'Title' },
      {
        id: 'p',
        type: 'paragraph',
        content: [
          { type: 'text', value: 'a ' },
          {
            type: 'strong',
            children: [
              { type: 'em', children: [{ type: 'text', value: 'bi' }] },
            ],
          },
          { type: 'text', value: ' c' },
        ],
      },
      {
        id: 'c',
        type: 'callout',
        tone: 'warning',
        variant: { tone: 'warning', emphasis: 'bold' },
        content: [{ type: 'text', value: 'careful' }],
      },
    ]);

    const tt = portableDocToTipTapJson(original);
    const back = tiptapToPortableDoc(
      tt as Parameters<typeof tiptapToPortableDoc>[0],
    );

    expect(back.blocks).toHaveLength(3);
    expect(back.blocks[0]?.type).toBe('heading');
    if (back.blocks[0]?.type === 'heading') {
      expect(back.blocks[0].level).toBe(2);
      expect(back.blocks[0].text).toBe('Title');
    }

    expect(back.blocks[1]?.type).toBe('paragraph');
    if (back.blocks[1]?.type === 'paragraph') {
      // strong wraps em wraps text — outer mark first means strong is outer.
      expect(back.blocks[1].content[1]).toEqual({
        type: 'strong',
        children: [{
          type: 'em',
          children: [{ type: 'text', value: 'bi' }],
        }],
      });
    }

    expect(back.blocks[2]?.type).toBe('callout');
    if (back.blocks[2]?.type === 'callout') {
      expect(back.blocks[2].tone).toBe('warning');
      expect(back.blocks[2].variant).toEqual({ tone: 'warning', emphasis: 'bold' });
    }
  });
});
