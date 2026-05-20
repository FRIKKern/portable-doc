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
import { describe, expect, it, vi } from 'vitest';
import type { PortableDoc } from '@portable-doc/core';
import pdfMake from 'pdfmake/build/pdfmake.js';
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

  it('passes a structurally sound docDefinition to pdfmake.createPdf', async () => {
    // Capture the docDefinition that toPdfBlob hands to pdfmake. We don't
    // assert on output bytes here — just on the shape of the argument,
    // since pdfmake's downstream layout is opaque. This guards against
    // an accidental refactor flipping pageSize to 'LETTER' or zeroing out
    // margins / dropping info.title — the existing magic-header tests
    // would happily pass with broken-but-structured output.
    type CapturedDef = {
      pageSize?: string;
      pageOrientation?: string;
      pageMargins?: unknown;
      info?: { title?: string; language?: string };
      defaultStyle?: { font?: string; fontSize?: number };
      content?: unknown;
    };
    let captured: CapturedDef | undefined;
    const original = (pdfMake as unknown as { createPdf: (d: unknown) => unknown }).createPdf;
    const spy = vi
      .spyOn(pdfMake as unknown as { createPdf: (d: unknown) => unknown }, 'createPdf')
      .mockImplementation((def: unknown) => {
        captured = def as CapturedDef;
        return {
          getBlob: async () => new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: PDF_MIME }),
          getBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        };
      });

    try {
      await toPdfBlob(TINY_DOC);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(captured).toBeDefined();
      const def = captured!;

      // Page geometry: A4 portrait. These are load-bearing for reMarkable
      // rendering — letter-size would crop or letterbox on the 10.3" e-ink.
      expect(def.pageSize).toBe('A4');
      expect(def.pageOrientation).toBe('portrait');

      // pageMargins should be a 4-tuple of equal numbers (uniform inset).
      // We don't pin the exact value (22mm ≈ 62pt today, but a designer
      // may dial it). Tolerance: each side within ±20pt of the first.
      expect(Array.isArray(def.pageMargins)).toBe(true);
      const margins = def.pageMargins as number[];
      expect(margins).toHaveLength(4);
      for (const m of margins) {
        expect(typeof m).toBe('number');
        expect(m).toBeGreaterThan(0);
        expect(Math.abs(m - margins[0]!)).toBeLessThanOrEqual(20);
      }

      // info block — title must mirror the doc; language must be a string
      // (default 'en-US', but a caller may pass nb-NO etc).
      expect(def.info).toBeDefined();
      expect(def.info!.title).toBe(TINY_DOC.title ?? 'Untitled');
      expect(typeof def.info!.language).toBe('string');
      expect(def.info!.language!.length).toBeGreaterThan(0);

      // defaultStyle — font name not pinned (a sister subagent may swap
      // Roboto → a serif). Just verify the shape: non-empty string font,
      // positive fontSize.
      expect(def.defaultStyle).toBeDefined();
      expect(typeof def.defaultStyle!.font).toBe('string');
      expect(def.defaultStyle!.font!.length).toBeGreaterThan(0);
      expect(typeof def.defaultStyle!.fontSize).toBe('number');
      expect(def.defaultStyle!.fontSize!).toBeGreaterThan(0);

      // content is an array (pdfmake's content node list).
      expect(Array.isArray(def.content)).toBe(true);
    } finally {
      spy.mockRestore();
      // Defensive: ensure original is back even if mockRestore misbehaves
      // under happy-dom's module-resolution edge cases.
      (pdfMake as unknown as { createPdf: unknown }).createPdf = original;
    }
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
