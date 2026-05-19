/**
 * toDocx — unit specs.
 *
 * DOCX is a ZIP-of-XML, so deep validation is brittle. We assert:
 *   1. Returned value is a Blob with the OOXML MIME type.
 *   2. Size > 1000 bytes (a real DOCX has at least the OPC parts).
 *   3. A heading-only doc succeeds.
 *   4. A doc containing one of every major block type succeeds.
 *   5. Inline marks (strong, em, code, link) round-trip without throwing.
 *   6. Unsupported variant tones do not throw — the placeholder paragraph
 *      keeps the document well-formed.
 *   7. A doc with nested sections + lists succeeds.
 *   8. slug() helper handles edge cases.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { PortableDoc } from '@portable-doc/core';
import { toDocxBlob, slug } from './toDocx.js';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('toDocxBlob', () => {
  it('returns a Blob (size > 1000 bytes) for a tiny doc', async () => {
    const doc: PortableDoc = {
      version: 1,
      title: 'Hello',
      blocks: [
        { id: 'h1', type: 'heading', level: 1, text: 'Hi' },
        {
          id: 'p1',
          type: 'paragraph',
          content: [{ type: 'text', value: 'world' }],
        },
      ],
    };
    const blob = await toDocxBlob(doc);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('blob.type is the OOXML wordprocessing MIME', async () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [
        { id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'hi' }] },
      ],
    };
    const blob = await toDocxBlob(doc);
    // docx's Packer.toBlob sets the OOXML MIME type. If a future bump drops
    // that we'd want to wrap and assert ourselves — for now, just check.
    expect(blob.type).toBe(DOCX_MIME);
  });

  it('handles a doc with one of every major block type', async () => {
    const doc: PortableDoc = {
      version: 1,
      title: 'Everything',
      blocks: [
        { id: 'h1', type: 'heading', level: 2, text: 'Section' },
        {
          id: 'p1',
          type: 'paragraph',
          content: [{ type: 'text', value: 'a paragraph' }],
        },
        {
          id: 'l1',
          type: 'list',
          items: [
            [{ type: 'text', value: 'one' }],
            [{ type: 'text', value: 'two' }],
          ],
        },
        {
          id: 'l2',
          type: 'list',
          ordered: true,
          items: [
            [{ type: 'text', value: 'first' }],
            [{ type: 'text', value: 'second' }],
          ],
        },
        {
          id: 'c1',
          type: 'callout',
          tone: 'info',
          title: 'Heads up',
          content: [{ type: 'text', value: 'a callout' }],
        },
        {
          id: 'a1',
          type: 'action',
          label: 'Click me',
          href: 'https://example.com',
          priority: 'primary',
        },
        { id: 'd1', type: 'divider' },
        {
          id: 'k1',
          type: 'code',
          lang: 'ts',
          value: 'const x = 1;\nconst y = 2;',
        },
        {
          id: 'i1',
          type: 'image',
          src: 'https://example.com/x.png',
          alt: 'logo',
          surfaces: ['web', 'native'],
        },
        {
          id: 't1',
          type: 'table',
          rows: [
            [
              [{ type: 'text', value: 'A' }],
              [{ type: 'text', value: 'B' }],
            ],
            [
              [{ type: 'text', value: '1' }],
              [{ type: 'text', value: '2' }],
            ],
          ],
          surfaces: ['web', 'native'],
        },
      ],
    };
    const blob = await toDocxBlob(doc);
    expect(blob.size).toBeGreaterThan(1500);
  });

  it('serializes inline marks (strong + em + code + link)', async () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          content: [
            { type: 'text', value: 'plain ' },
            { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
            { type: 'text', value: ' ' },
            { type: 'em', children: [{ type: 'text', value: 'italics' }] },
            { type: 'text', value: ' ' },
            { type: 'code', value: 'codeRun' },
            { type: 'text', value: ' ' },
            {
              type: 'link',
              href: 'https://example.com',
              children: [{ type: 'text', value: 'home' }],
            },
          ],
        },
      ],
    };
    const blob = await toDocxBlob(doc);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('renders a placeholder for unsupported variant tones without throwing', async () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [
        {
          id: 'c1',
          type: 'callout',
          tone: 'info',
          // emphasis="loud" is not in the catalog → placeholder paragraph.
          variant: { emphasis: 'loud' },
          content: [{ type: 'text', value: 'should still serialize' }],
        },
      ],
    };
    const blob = await toDocxBlob(doc);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('handles nested sections', async () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [
        {
          id: 's1',
          type: 'section',
          title: 'Outer',
          blocks: [
            { id: 'h1', type: 'heading', level: 3, text: 'Inner heading' },
            {
              id: 'p1',
              type: 'paragraph',
              content: [{ type: 'text', value: 'inner body' }],
            },
          ],
        },
      ],
    };
    const blob = await toDocxBlob(doc);
    expect(blob.size).toBeGreaterThan(1000);
  });
});

describe('toDocxBlob — embedded envelope (Goal B P1)', () => {
  const baseDoc: PortableDoc = {
    version: 1,
    title: 'Round-trip',
    blocks: [
      { id: 'h1', type: 'heading', level: 1, text: 'Hello' },
      { id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'world' }] },
    ],
  };

  it('embeds customXml/item1.xml in the OPC zip', async () => {
    const blob = await toDocxBlob(baseDoc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const part = zip.file('customXml/item1.xml');
    expect(part).not.toBeNull();
    const xml = await part!.async('string');
    expect(xml).toContain('<papir-envelope');
    expect(xml).toContain('<![CDATA[');
  });

  it('registers the customXml part as an Override in [Content_Types].xml', async () => {
    const blob = await toDocxBlob(baseDoc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const ct = await zip.file('[Content_Types].xml')!.async('string');
    expect(ct).toContain('PartName="/customXml/item1.xml"');
    expect(ct).toContain('ContentType="application/xml"');
  });

  it('adds a customXml relationship in word/_rels/document.xml.rels', async () => {
    const blob = await toDocxBlob(baseDoc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const rels = await zip
      .file('word/_rels/document.xml.rels')!
      .async('string');
    expect(rels).toContain(
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml"',
    );
    expect(rels).toContain('Target="../customXml/item1.xml"');
  });
});

describe('slug', () => {
  it('lowercases and replaces non-alphanum with -', () => {
    expect(slug('Hello World!')).toBe('hello-world');
    expect(slug('  multi   space  ')).toBe('multi-space');
  });
  it('falls back to "untitled" for empty input', () => {
    expect(slug('')).toBe('untitled');
    expect(slug('!!!')).toBe('untitled');
  });
});
