/**
 * fromDocx — unit specs for the round-trip extractor (Goal B P1).
 *
 * Coverage:
 *   1. Round-trip — export → extract recovers the original AST verbatim.
 *   2. A .docx without `customXml/item1.xml` returns null (pre-feature
 *      export, or any non-Papir .docx).
 *   3. A .docx with the part present but with a malformed envelope
 *      payload (fails schema) returns null.
 *   4. A non-ZIP buffer returns null (defensive against picker mishaps).
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { PortableDoc } from '@portable-doc/core';
import { toDocxBlob } from '../export/toDocx.js';
import { extractFromDocx } from './fromDocx.js';

describe('extractFromDocx', () => {
  it('round-trips: export → extract recovers the AST verbatim', async () => {
    const original: PortableDoc = {
      version: 1,
      title: 'Round-trip demo',
      blocks: [
        { id: 'h1', type: 'heading', level: 2, text: 'Section' },
        {
          id: 'p1',
          type: 'paragraph',
          content: [
            { type: 'text', value: 'plain ' },
            { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
            { type: 'text', value: ' and ' },
            { type: 'em', children: [{ type: 'text', value: 'italic' }] },
          ],
        },
        {
          id: 'c1',
          type: 'callout',
          tone: 'info',
          title: 'Note',
          variant: { emphasis: 'subtle' },
          content: [{ type: 'text', value: 'a calm callout' }],
        },
      ],
    };
    const blob = await toDocxBlob(original);
    const buf = await blob.arrayBuffer();
    const envelope = await extractFromDocx(buf);
    expect(envelope).not.toBeNull();
    expect(envelope!.ast).toEqual(original);
    expect(envelope!.version).toBe('1.0.0');
    expect(envelope!.exporter).toContain('papir');
  });

  it('returns null when no customXml/item1.xml is present', async () => {
    // Build a minimal .docx-shaped zip WITHOUT the envelope part.
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    );
    zip.file(
      'word/document.xml',
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    );
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const envelope = await extractFromDocx(buf);
    expect(envelope).toBeNull();
  });

  it('returns null when the envelope payload fails schema validation', async () => {
    const zip = new JSZip();
    zip.file(
      'customXml/item1.xml',
      `<?xml version="1.0"?><papir-envelope><payload><![CDATA[
${JSON.stringify({ version: 'not-semver', exporter: 'x' })}
      ]]></payload></papir-envelope>`,
    );
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const envelope = await extractFromDocx(buf);
    expect(envelope).toBeNull();
  });

  it('returns null when the buffer is not a ZIP at all', async () => {
    const bytes = new TextEncoder().encode('definitely not a zip');
    const envelope = await extractFromDocx(bytes.buffer);
    expect(envelope).toBeNull();
  });
});
