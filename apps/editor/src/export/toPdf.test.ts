/**
 * toPdf — unit specs.
 *
 * The PDF wire format is opaque (compressed streams + cross-reference tables),
 * so we assert structural shape rather than byte-for-byte content:
 *   1. Returns a Blob with `application/pdf` MIME, size > 1KB.
 *   2. The first 8 bytes are `%PDF-1.`  (the magic header — PDF 1.x).
 *   3. A doc with one of every major block type produces a valid blob
 *      without throwing during pdfmake's layout pass.
 */
import { describe, expect, it } from 'vitest';
import type { PortableDoc } from '@portable-doc/core';
import { toPdfBlob, PDF_MIME } from './toPdf.js';

const TINY_DOC: PortableDoc = {
  version: 1,
  title: 'Hello',
  blocks: [
    { id: 'h1', type: 'heading', level: 1, text: 'Hi' },
    { id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'world' }] },
    { id: 'c1', type: 'callout', tone: 'info', content: [{ type: 'text', value: 'callout body' }] },
  ],
};

async function readMagic(blob: Blob, n = 8): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  return String.fromCharCode(...buf.slice(0, n));
}

describe('toPdfBlob', () => {
  it('returns a Blob with the PDF MIME (size > 1KB)', async () => {
    const blob = await toPdfBlob(TINY_DOC);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe(PDF_MIME);
    expect(blob.size).toBeGreaterThan(1024);
  });

  it('begins with the PDF-1.x magic header', async () => {
    const blob = await toPdfBlob(TINY_DOC);
    const head = await readMagic(blob, 8);
    // PDF spec: every PDF file starts with `%PDF-1.` followed by the
    // minor version (0..7). pdfmake emits 1.3 in 0.3.x. We assert the
    // prefix to keep the test robust across minor-version bumps.
    expect(head.startsWith('%PDF-1.')).toBe(true);
  });

  it('handles a doc with one of every major block type', async () => {
    const doc: PortableDoc = {
      version: 1,
      title: 'Everything',
      blocks: [
        { id: 'h1', type: 'heading', level: 2, text: 'Section' },
        { id: 'p1', type: 'paragraph', content: [
          { type: 'text', value: 'A ' },
          { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
          { type: 'text', value: ' word and ' },
          { type: 'em', children: [{ type: 'text', value: 'italic' }] },
          { type: 'text', value: ' and ' },
          { type: 'code', value: 'inline' },
          { type: 'text', value: ' and a ' },
          { type: 'link', href: 'https://example.com', children: [{ type: 'text', value: 'link' }] },
        ] },
        { id: 'l1', type: 'list', items: [
          [{ type: 'text', value: 'one' }],
          [{ type: 'text', value: 'two' }],
        ] },
        { id: 'l2', type: 'list', ordered: true, items: [
          [{ type: 'text', value: 'first' }],
        ] },
        { id: 'c1', type: 'callout', tone: 'info', title: 'Heads up', content: [
          { type: 'text', value: 'callout body' },
        ] },
        { id: 'c2', type: 'callout', tone: 'success', variant: { emphasis: 'bold' }, content: [
          { type: 'text', value: 'success' },
        ] },
        { id: 'a1', type: 'action', label: 'Click', href: 'https://example.com', priority: 'primary' },
        { id: 'd1', type: 'divider' },
        { id: 'k1', type: 'code', lang: 'js', value: 'console.log(1)' },
        { id: 'i1', type: 'image', src: 'https://example.com/x.png', alt: 'X', surfaces: ['web', 'native'] },
        { id: 't1', type: 'table', surfaces: ['web', 'native'], rows: [
          [[{ type: 'text', value: 'A' }], [{ type: 'text', value: 'B' }]],
          [[{ type: 'text', value: '1' }], [{ type: 'text', value: '2' }]],
        ] },
        { id: 's1', type: 'section', title: 'Nested', blocks: [
          { id: 'sp1', type: 'paragraph', content: [{ type: 'text', value: 'inside' }] },
        ] },
      ],
    };
    const blob = await toPdfBlob(doc);
    expect(blob.size).toBeGreaterThan(2048);
    const head = await readMagic(blob, 8);
    expect(head.startsWith('%PDF-1.')).toBe(true);
  });
});
