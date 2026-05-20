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
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('toDocxBlob — heading + body vertical rhythm', () => {
  it('emits H1 with before=480 after=120 in styles.xml (spec §"Heading spacing")', async () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [{ id: 'h1', type: 'heading', level: 1, text: 'X' }],
    };
    const blob = await toDocxBlob(doc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const styles = await zip.file('word/styles.xml')!.async('string');
    // The OOXML spacing attributes for the heading 1 style sit on one
    // <w:spacing/> element. Order isn't guaranteed by the serializer,
    // so we check each attribute separately within a permissive window.
    const heading1Block = styles.match(
      /styleId="Heading1"[\s\S]*?<w:spacing[^/]*\/>/,
    );
    expect(heading1Block).not.toBeNull();
    const spacing = heading1Block![0];
    expect(spacing).toContain('w:before="480"');
    expect(spacing).toContain('w:after="120"');
  });

  it('emits Normal default with spacing.before=240 / after=0 / line=372 (spec body row)', async () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [{ id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'x' }] }],
    };
    const blob = await toDocxBlob(doc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const styles = await zip.file('word/styles.xml')!.async('string');
    expect(styles).toContain('w:before="240"');
    expect(styles).toContain('w:after="0"');
    expect(styles).toContain('w:line="372"');
  });
});

describe('toDocxBlob — code block as table', () => {
  it('emits code block as a <w:tbl>, not per-line paragraphs', async () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [
        { id: 'k1', type: 'code', lang: 'ts', value: 'a\nb\nc' },
      ],
    };
    const blob = await toDocxBlob(doc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const documentXml = await zip.file('word/document.xml')!.async('string');
    expect(documentXml).toContain('<w:tbl>');
    // Every line of the code source should appear inside the table cell.
    expect(documentXml).toMatch(/<w:t[^>]*>a<\/w:t>/);
    expect(documentXml).toMatch(/<w:t[^>]*>b<\/w:t>/);
    expect(documentXml).toMatch(/<w:t[^>]*>c<\/w:t>/);
  });

  it('handles empty lines by emitting a single space (Word rejects empty)', async () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [
        { id: 'k1', type: 'code', value: 'first\n\nthird' },
      ],
    };
    const blob = await toDocxBlob(doc);
    expect(blob.size).toBeGreaterThan(1000);
  });
});

describe('toDocxBlob — styles pane UX', () => {
  it('styles.xml contains uiPriority + display name fields per spec', async () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [{ id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'x' }] }],
    };
    const blob = await toDocxBlob(doc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const styles = await zip.file('word/styles.xml')!.async('string');
    expect(styles).toContain('w:uiPriority');
    expect(styles).toContain('Callout · Info');
    expect(styles).toContain('Section · Comfortable');
    expect(styles).toContain('Code · Light');
    expect(styles).toContain('Block Quote');
    // Hyperlink character style — semiHidden + uiPriority=99
    expect(styles).toMatch(/styleId="Hyperlink"[\s\S]*?w:semiHidden/);
  });
});

describe('toDocxBlob — language + noProof', () => {
  it('docDefaults emit a language tag (defaulting to en-US)', async () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [{ id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'x' }] }],
    };
    const blob = await toDocxBlob(doc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const styles = await zip.file('word/styles.xml')!.async('string');
    expect(styles).toContain('w:val="en-US"');
  });

  it('honours a custom language option', async () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [{ id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'x' }] }],
    };
    const blob = await toDocxBlob(doc, { language: 'nb-NO' });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const styles = await zip.file('word/styles.xml')!.async('string');
    expect(styles).toContain('w:val="nb-NO"');
  });
});

describe('toDocxBlob — dual-embed (customXml + docProps fallback)', () => {
  const doc: PortableDoc = {
    version: 1,
    title: 'Dual',
    blocks: [{ id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'hi' }] }],
  };

  it('emits docProps/custom.xml with papir-ast-* properties', async () => {
    const blob = await toDocxBlob(doc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const customProps = zip.file('docProps/custom.xml');
    expect(customProps).not.toBeNull();
    const xml = await customProps!.async('string');
    expect(xml).toContain('papir-ast-count');
    expect(xml).toContain('papir-ast-sha256');
    expect(xml).toContain('papir-ast-1');
  });

  it('registers docProps/custom.xml in [Content_Types].xml', async () => {
    const blob = await toDocxBlob(doc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const ct = await zip.file('[Content_Types].xml')!.async('string');
    expect(ct).toContain('PartName="/docProps/custom.xml"');
    expect(ct).toContain(
      'application/vnd.openxmlformats-officedocument.custom-properties+xml',
    );
  });

  it('registers the custom-properties relationship in the package root _rels/.rels', async () => {
    const blob = await toDocxBlob(doc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const rels = await zip.file('_rels/.rels')!.async('string');
    expect(rels).toContain(
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties"',
    );
    expect(rels).toContain('Target="docProps/custom.xml"');
  });
});

describe('toDocxBlob — divider styling', () => {
  it('divider uses warm-stone color D8D1BF + 0.75pt border (size=6 eighths)', async () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [{ id: 'd1', type: 'divider' }],
    };
    const blob = await toDocxBlob(doc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const documentXml = await zip.file('word/document.xml')!.async('string');
    expect(documentXml).toContain('D8D1BF');
    // Spec §"Divider": 0.75pt = 6 eighths of a point in OOXML border.
    expect(documentXml).toMatch(/w:sz="6"/);
    // Vertical rhythm matches body-paragraph "before" (240 twips = 12pt).
    expect(documentXml).toContain('w:before="240"');
  });
});

describe('toDocxBlob — table header row + empty-cell guard', () => {
  it('marks the first row with tableHeader and wraps header runs in bold', async () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [
        {
          id: 't1',
          type: 'table', surfaces: ['web','native'] as const,
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
        },
      ],
    };
    const blob = await toDocxBlob(doc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const documentXml = await zip.file('word/document.xml')!.async('string');

    // Find every <w:tr>…</w:tr> in document order.
    const rows = documentXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g);
    expect(rows).not.toBeNull();
    expect(rows!.length).toBeGreaterThanOrEqual(2);

    // First row carries an active <w:tblHeader/> (typically nested under
    // <w:trPr>). The docx serializer emits a self-closing tag with no val,
    // or w:val="true"/"1" — never w:val="false" on the header row.
    const firstHeader = rows![0].match(/<w:tblHeader\b[^/>]*\/?>/);
    expect(firstHeader).not.toBeNull();
    expect(firstHeader![0]).not.toMatch(/w:val="(false|0)"/);
    // First row's runs include bold.
    const firstRow = rows![0];
    const secondRow = rows![1];
    if (!firstRow || !secondRow) throw new Error('expected ≥2 rows');
    expect(firstRow).toMatch(/<w:b\b/);
    const secondHeader = secondRow.match(/<w:tblHeader\b[^/>]*\/?>/);
    if (secondHeader) {
      expect(secondHeader[0]).toMatch(/w:val="(false|0)"/);
    }
  });

  it('emits at least one <w:p> in every <w:tc>, even for empty cells', async () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [
        {
          id: 't1',
          type: 'table', surfaces: ['web','native'] as const,
          rows: [
            [
              [],
              [{ type: 'text', value: 'filled' }],
            ],
          ],
        },
      ],
    };
    const blob = await toDocxBlob(doc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const documentXml = await zip.file('word/document.xml')!.async('string');

    const cells = documentXml.match(/<w:tc\b[\s\S]*?<\/w:tc>/g);
    expect(cells).not.toBeNull();
    expect(cells!.length).toBeGreaterThanOrEqual(2);
    for (const cell of cells!) {
      // Every table cell must contain at least one paragraph element —
      // an empty <w:tc> is invalid OOXML and Word refuses to open it.
      expect(cell).toMatch(/<w:p\b/);
    }
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

// 1×1 fully-transparent PNG. The canonical "smallest valid PNG" — 67 bytes,
// every test framework + image lib accepts it. Used as the data: URI payload
// for the inline-embed test below.
const ONE_PX_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

describe('toDocxBlob — image embedding', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('embeds an inline data: URI PNG as word/media/image1.png', async () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [
        {
          id: 'i1',
          type: 'image',
          src: `data:image/png;base64,${ONE_PX_PNG_B64}`,
          alt: 'pixel',
          surfaces: ['web', 'native'],
        },
      ],
    };
    const blob = await toDocxBlob(doc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    // The docx serializer files embedded media under word/media/imageN.<ext>.
    // We don't care which N — just that at least one PNG landed.
    const mediaNames = Object.keys(zip.files).filter((p) =>
      p.startsWith('word/media/'),
    );
    expect(mediaNames.length).toBeGreaterThan(0);
    expect(mediaNames.some((p) => /\.png$/i.test(p))).toBe(true);
    // No placeholder text should remain when embedding succeeded.
    const documentXml = await zip.file('word/document.xml')!.async('string');
    expect(documentXml).not.toContain('[Image:');
  });

  it('fetches an http(s) URL and embeds the result', async () => {
    const pngBytes = decodeBase64(ONE_PX_PNG_B64);
    // Copy into a fresh ArrayBuffer-backed Uint8Array so TS's narrow
    // `BodyInit` / `BlobPart` unions accept it (they don't admit
    // `Uint8Array<ArrayBufferLike>` from `atob`-derived bytes).
    const body = new Uint8Array(pngBytes.length);
    body.set(pngBytes);
    const fetchMock = vi.fn(async () =>
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const doc: PortableDoc = {
      version: 1,
      blocks: [
        {
          id: 'i1',
          type: 'image',
          src: 'https://example.com/pixel.png',
          alt: 'remote pixel',
          surfaces: ['web', 'native'],
        },
      ],
    };
    const blob = await toDocxBlob(doc);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/pixel.png');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const mediaNames = Object.keys(zip.files).filter((p) =>
      p.startsWith('word/media/'),
    );
    expect(mediaNames.length).toBeGreaterThan(0);
  });

  it('falls back to placeholder when fetch fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);

    const doc: PortableDoc = {
      version: 1,
      blocks: [
        {
          id: 'i1',
          type: 'image',
          src: 'https://broken.example.com/x.png',
          alt: 'oops',
          surfaces: ['web', 'native'],
        },
      ],
    };
    // No throw — fallback path kicks in.
    const blob = await toDocxBlob(doc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const documentXml = await zip.file('word/document.xml')!.async('string');
    // Placeholder run survives; no media part written.
    expect(documentXml).toContain('[Image: oops]');
    const mediaNames = Object.keys(zip.files).filter((p) =>
      p.startsWith('word/media/'),
    );
    expect(mediaNames.length).toBe(0);
  });
});
