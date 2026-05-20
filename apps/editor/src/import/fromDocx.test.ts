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
import exhaustiveFixture from '../../../../examples/exhaustive.json';
import nestedCalloutsFixture from '../../../../examples/nested-callouts.json';

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

  it('falls back to docProps/custom.xml when customXml is stripped', async () => {
    // Simulates Google Docs' upload pipeline: it strips customXml/item1.xml
    // but preserves docProps/custom.xml byte-for-byte. The importer should
    // reconstruct the envelope from the chunked base64 properties.
    const original: PortableDoc = {
      version: 1,
      title: 'Fallback round-trip',
      blocks: [
        { id: 'h1', type: 'heading', level: 2, text: 'Header' },
        {
          id: 'p1',
          type: 'paragraph',
          content: [{ type: 'text', value: 'survived google' }],
        },
      ],
    };
    const blob = await toDocxBlob(original);
    // Re-pack with customXml stripped, docProps preserved.
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    zip.remove('customXml/item1.xml');
    // Also strip the customXml relationship so the import path doesn't
    // mis-detect the file as still having one — purely defensive; the
    // missing part itself is what matters.
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const envelope = await extractFromDocx(buf);
    expect(envelope).not.toBeNull();
    expect(envelope!.ast).toEqual(original);
  });

  it('returns null when docProps fallback fails sha256 verification', async () => {
    // The fallback's tamper-detection branch is otherwise untested. Corrupt
    // a single character in the middle of the papir-ast-3 chunk so the
    // recomputed digest mismatches the stored sha. We also strip
    // customXml/item1.xml so the importer is FORCED down the docProps path
    // (otherwise the primary succeeds and the sha branch never runs).
    const original: PortableDoc = {
      version: 1,
      title: 'Tamper-detection probe',
      blocks: [
        { id: 'h1', type: 'heading', level: 2, text: 'Header' },
        {
          id: 'p1',
          type: 'paragraph',
          // Enough text to guarantee at least 3 base64 chunks of 240 chars.
          content: [
            {
              type: 'text',
              value: 'x'.repeat(2000),
            },
          ],
        },
      ],
    };
    const blob = await toDocxBlob(original);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    zip.remove('customXml/item1.xml');
    const customXml = await zip.file('docProps/custom.xml')!.async('string');
    // Locate papir-ast-3's vt:lpwstr value and flip one character in the
    // middle. The regex captures the entire opening tag run + value so we
    // can replace just the value's middle character.
    const re = /(<property[^>]*name="papir-ast-3"[^>]*><vt:lpwstr>)([^<]+)(<\/vt:lpwstr>)/;
    const match = customXml.match(re);
    if (!match) throw new Error('test fixture missing papir-ast-3 chunk');
    const value = match[2]!;
    const mid = Math.floor(value.length / 2);
    // Flip 'A' <-> 'B' (both valid base64 chars) to keep the encoding
    // shape but break the digest. Fall back to a different swap if the
    // middle char happens not to be either.
    const ch = value.charAt(mid);
    const flipped = ch === 'A' ? 'B' : ch === 'B' ? 'A' : ch === '/' ? '+' : 'A';
    const corruptedValue =
      value.slice(0, mid) + flipped + value.slice(mid + 1);
    const corruptedXml = customXml.replace(
      re,
      `$1${corruptedValue}$3`,
    );
    zip.file('docProps/custom.xml', corruptedXml);
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const envelope = await extractFromDocx(buf);
    expect(envelope).toBeNull();
  });

  it('round-trips Unicode (emoji + Arabic + ZWJ family) byte-for-byte', async () => {
    const greeting = 'Hello \u{1F44B} مرحبا بالعالم \u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
    const original: PortableDoc = {
      version: 1,
      title: 'Unicode round-trip',
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          content: [{ type: 'text', value: greeting }],
        },
      ],
    };
    const blob = await toDocxBlob(original);
    const buf = await blob.arrayBuffer();
    const envelope = await extractFromDocx(buf);
    expect(envelope).not.toBeNull();
    // envelope.ast is `unknown` at the schema level — narrow via the
    // PortableDoc shape we authored.
    const ast = envelope!.ast as PortableDoc;
    const firstBlock = ast.blocks[0];
    if (!firstBlock) throw new Error('expected ≥1 block');
    expect(firstBlock.type).toBe('paragraph');
    const firstInline =
      firstBlock.type === 'paragraph' ? firstBlock.content[0] : null;
    expect(firstInline).not.toBeNull();
    if (!firstInline || firstInline.type !== 'text') {
      throw new Error('expected first inline to be a text node');
    }
    // Byte-for-byte equality — emoji, Arabic, and the four-person ZWJ
    // family all survive unchanged.
    expect(firstInline.value).toBe(greeting);
  });

  // Regression: toDocx wraps the envelope JSON in a single CDATA section.
  // When the AST payload contains the literal `]]>` (e.g. a code block whose
  // `value` includes raw XML/CDATA fragments), a naive wrap would let the
  // embedded `]]>` terminate the CDATA early and corrupt the customXml part.
  // toDocx now splits each `]]>` across two CDATA sections via the standard
  // XML idiom (`]]>` → `]]]]><![CDATA[>`), so the parser reconstructs the
  // original bytes after unwrapping both sections.
  it('round-trips a code block whose value contains literal "]]>"', async () => {
    const original: PortableDoc = {
      version: 1,
      title: 'CDATA escape probe',
      blocks: [
        {
          id: 'c1',
          type: 'code',
          lang: 'xml',
          value: '<![CDATA[ raw payload ]]> some xml after',
        },
      ],
    };
    const blob = await toDocxBlob(original);
    const buf = await blob.arrayBuffer();
    const envelope = await extractFromDocx(buf);
    expect(envelope).not.toBeNull();
    expect(envelope!.ast).toEqual(original);
  });

  it('round-trips the exhaustive fixture (21 variants intact)', async () => {
    // The envelope path carries the full AST verbatim regardless of how
    // the rendered DOCX surfaces it — so every callout tone × emphasis,
    // every action priority, every section variant, every code lang, and
    // every table-merge survives a docx → extract round-trip byte-for-byte.
    const original = exhaustiveFixture as PortableDoc;
    const blob = await toDocxBlob(original);
    const buf = await blob.arrayBuffer();
    const envelope = await extractFromDocx(buf);
    expect(envelope).not.toBeNull();
    expect(envelope!.ast).toEqual(original);
  });

  it('round-trips the nested-callouts fixture (section depth 3 intact)', async () => {
    // Companion to the depth-5 procedural case: this one drives the
    // real on-disk fixture used by the structural-check matrix, so a
    // regression there shows up here too.
    const original = nestedCalloutsFixture as PortableDoc;
    const blob = await toDocxBlob(original);
    const buf = await blob.arrayBuffer();
    const envelope = await extractFromDocx(buf);
    expect(envelope).not.toBeNull();
    expect(envelope!.ast).toEqual(original);
  });

  it('round-trips deeply nested sections (depth 5)', async () => {
    // Build a 5-deep section pyramid. Each level contains a heading + a
    // paragraph plus the next-level section. The innermost section's
    // `blocks` array is just heading + paragraph (no further nesting).
    const buildSection = (depth: number): PortableDoc['blocks'][number] => {
      const inner: PortableDoc['blocks'][number][] = [
        { id: `h-${depth}`, type: 'heading', level: 3, text: `Heading at depth ${depth}` },
        {
          id: `p-${depth}`,
          type: 'paragraph',
          content: [{ type: 'text', value: `body text at depth ${depth}` }],
        },
      ];
      if (depth < 5) inner.push(buildSection(depth + 1));
      return {
        id: `s-${depth}`,
        type: 'section',
        title: `Section ${depth}`,
        blocks: inner,
      };
    };
    const original: PortableDoc = {
      version: 1,
      title: 'Deep section nesting',
      blocks: [buildSection(1)],
    };
    const blob = await toDocxBlob(original);
    const buf = await blob.arrayBuffer();
    const envelope = await extractFromDocx(buf);
    expect(envelope).not.toBeNull();
    expect(JSON.stringify(envelope!.ast)).toBe(JSON.stringify(original));
  });
});
