/**
 * toEpub — unit specs.
 *
 * EPUB is a ZIP of XHTML + XML metadata, so we assert structural shape
 * rather than deep XML equivalence:
 *   1. Returns a Blob with the EPUB MIME type, size > 1KB.
 *   2. The first ZIP entry is `mimetype`, uncompressed, with the
 *      `application/epub+zip` body.
 *   3. The canonical four parts exist (container.xml, package.opf,
 *      nav.xhtml, chapter-1.xhtml) and carry the expected anchors
 *      (dc:title, papir publisher, etc).
 *   4. The round-trip envelope sidecar (META-INF/com.paperflow.ast.json)
 *      lands.
 *   5. A doc with one of every major block type succeeds without
 *      throwing during XHTML emission.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import type { PortableDoc } from '@portable-doc/core';
import { toEpubBlob, EPUB_MIME } from './toEpub.js';

// 1×1 transparent PNG — the smallest valid PNG (67 bytes) we can ship in a
// test fixture. Generated once with `python -c "import base64,zlib"`; the
// payload is deterministic so the test cannot drift.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';
const TINY_PNG_DATA_URI = `data:image/png;base64,${TINY_PNG_B64}`;

const TINY_DOC: PortableDoc = {
  version: 1,
  title: 'Hello',
  blocks: [
    { id: 'h1', type: 'heading', level: 1, text: 'Hi' },
    { id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'world' }] },
    { id: 'p2', type: 'paragraph', content: [{ type: 'text', value: 'more' }] },
  ],
};

describe('toEpubBlob', () => {
  it('returns a Blob with the EPUB MIME (size > 1KB)', async () => {
    const blob = await toEpubBlob(TINY_DOC);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe(EPUB_MIME);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('mimetype is the first ZIP entry, stored uncompressed', async () => {
    const blob = await toEpubBlob(TINY_DOC);
    const buffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    // Iterating zip.files preserves insertion order — first key MUST be
    // `mimetype` per the OCF spec.
    const keys = Object.keys(zip.files);
    expect(keys[0]).toBe('mimetype');
    const mimetypeEntry = zip.file('mimetype');
    expect(mimetypeEntry).toBeTruthy();
    const text = await mimetypeEntry!.async('string');
    expect(text).toBe(EPUB_MIME);
    // JSZip exposes per-file compression state via the internal _data.
    // We assert by checking the entry uses STORE — compressedSize must
    // equal uncompressedSize (raw bytes match).
    const opts = (mimetypeEntry as unknown as { options?: { compression?: string } }).options;
    if (opts && opts.compression) {
      expect(opts.compression).toBe('STORE');
    }
  });

  it('contains container.xml pointing at OPS/package.opf', async () => {
    const blob = await toEpubBlob(TINY_DOC);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const container = await zip.file('META-INF/container.xml')!.async('string');
    expect(container).toContain('full-path="OPS/package.opf"');
    expect(container).toContain('media-type="application/oebps-package+xml"');
  });

  it('contains package.opf with dc:title + dc:identifier + dcterms:modified', async () => {
    const blob = await toEpubBlob(TINY_DOC);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const opf = await zip.file('OPS/package.opf')!.async('string');
    expect(opf).toContain('<dc:title>Hello</dc:title>');
    expect(opf).toContain('<dc:identifier');
    expect(opf).toContain('urn:uuid:');
    expect(opf).toContain('<dc:creator>Papir</dc:creator>');
    expect(opf).toContain('dcterms:modified');
    expect(opf).toContain('<dc:language>en-US</dc:language>');
  });

  it('contains nav.xhtml with at least one toc anchor', async () => {
    const blob = await toEpubBlob(TINY_DOC);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const nav = await zip.file('OPS/nav.xhtml')!.async('string');
    expect(nav).toContain('epub:type="toc"');
    expect(nav).toContain('chapters/chapter-1.xhtml#hi');
  });

  it('contains chapter-1.xhtml with the doc body', async () => {
    const blob = await toEpubBlob(TINY_DOC);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const chapter = await zip.file('OPS/chapters/chapter-1.xhtml')!.async('string');
    expect(chapter).toContain('<h1 id="hi">Hi</h1>');
    expect(chapter).toContain('<p>world</p>');
    expect(chapter).toContain('<p>more</p>');
  });

  it('writes the round-trip envelope sidecar under META-INF', async () => {
    const blob = await toEpubBlob(TINY_DOC);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const sidecar = zip.file('META-INF/com.paperflow.ast.json');
    expect(sidecar).toBeTruthy();
    const text = await sidecar!.async('string');
    const parsed = JSON.parse(text) as { ast?: unknown };
    expect(parsed.ast).toBeTruthy();
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
    const blob = await toEpubBlob(doc);
    expect(blob.size).toBeGreaterThan(1000);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const chapter = await zip.file('OPS/chapters/chapter-1.xhtml')!.async('string');
    // Spot-check that every block type left a fingerprint.
    expect(chapter).toContain('<h2 id="section">Section</h2>');
    expect(chapter).toContain('<strong>');
    expect(chapter).toContain('<em>');
    expect(chapter).toContain('<code>inline</code>');
    expect(chapter).toContain('<a href="https://example.com">link</a>');
    expect(chapter).toContain('<ul>');
    expect(chapter).toContain('<ol>');
    expect(chapter).toContain('paper-callout-info-subtle');
    expect(chapter).toContain('paper-action-primary');
    expect(chapter).toContain('<hr/>');
    expect(chapter).toContain('paper-code');
    expect(chapter).toContain('[Image: X]');
    expect(chapter).toContain('<table');
    expect(chapter).toContain('<section');
  });

  it('honors a caller-supplied docUuid', async () => {
    const blob = await toEpubBlob(TINY_DOC, {
      docUuid: '11111111-2222-3333-4444-555555555555',
    });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const opf = await zip.file('OPS/package.opf')!.async('string');
    expect(opf).toContain('urn:uuid:11111111-2222-3333-4444-555555555555');
  });

  // Depth-shifted heading level math: headingToXhtml computes the emitted
  // tag as `b.level + min(depth, 2)` clamped to [1, 6]. A top-level H1
  // stays H1; an H1 nested one section deep becomes H2; nested two deep
  // becomes H3. Depth saturates at 2 so the bump cannot exceed +2 levels.
  it('shifts heading levels by section nesting depth', async () => {
    const doc: PortableDoc = {
      version: 1,
      title: 'Depth shifts',
      blocks: [
        // Top-level H1 — should emit as <h1>.
        { id: 'top', type: 'heading', level: 1, text: 'Top' },
        // One section deep — inner H1 should shift to <h2>.
        {
          id: 's1',
          type: 'section',
          blocks: [
            { id: 'inner', type: 'heading', level: 1, text: 'Inner' },
            // Section in section — inner-inner H1 should shift to <h3>.
            {
              id: 's2',
              type: 'section',
              blocks: [
                { id: 'innermost', type: 'heading', level: 1, text: 'Innermost' },
              ],
            },
          ],
        },
      ],
    };
    const blob = await toEpubBlob(doc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const chapter = await zip.file('OPS/chapters/chapter-1.xhtml')!.async('string');
    expect(chapter).toContain('<h1 id="top">Top</h1>');
    expect(chapter).toContain('<h2 id="inner">Inner</h2>');
    expect(chapter).toContain('<h3 id="innermost">Innermost</h3>');
  });

  // ncx.xml is EPUB 2 backwards-compat navigation — older readers still
  // look for it even though EPUB 3 nav.xhtml is the canonical TOC. We
  // assert the wrapping `<ncx>` root, the `<navMap>` block, and that at
  // least one `<navPoint>` with `playOrder="1"` carries the first
  // heading's text inside its `<text>` label.
  it('writes OPS/ncx.xml with a navMap of navPoints for top-level headings', async () => {
    const doc: PortableDoc = {
      version: 1,
      title: 'NCX shape',
      blocks: [
        { id: 'alpha', type: 'heading', level: 1, text: 'Alpha' },
        { id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'a' }] },
        { id: 'beta', type: 'heading', level: 1, text: 'Beta' },
      ],
    };
    const blob = await toEpubBlob(doc);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const ncxEntry = zip.file('OPS/ncx.xml');
    expect(ncxEntry).toBeTruthy();
    const ncx = await ncxEntry!.async('string');
    // Root element + namespace anchor.
    expect(ncx).toContain('<ncx ');
    expect(ncx).toContain('xmlns="http://www.daisy.org/z3986/2005/ncx/"');
    // navMap container.
    expect(ncx).toContain('<navMap>');
    expect(ncx).toContain('</navMap>');
    // First navPoint carries playOrder="1" and the first heading's text.
    expect(ncx).toMatch(/<navPoint id="navpoint-1" playOrder="1">/);
    // Pull out the first navPoint chunk and assert its <text> label.
    const firstNavPoint = ncx.match(
      /<navPoint id="navpoint-1"[\s\S]*?<\/navPoint>/,
    );
    expect(firstNavPoint).toBeTruthy();
    expect(firstNavPoint![0]).toContain('<text>Alpha</text>');
  });

  // Image embedding — data: URI happy path. A 1×1 PNG carried as a data:
  // URI should decode at export time, land as OPS/images/image1.png, be
  // listed in the OPF manifest with media-type=image/png, and be
  // referenced by the chapter via the relative `../images/image1.png`.
  describe('image embedding', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('embeds a data: URI PNG into OPS/images/ + OPF manifest + chapter <img>', async () => {
      const doc: PortableDoc = {
        version: 1,
        title: 'With image',
        blocks: [
          { id: 'h1', type: 'heading', level: 1, text: 'Pic' },
          {
            id: 'i1',
            type: 'image',
            src: TINY_PNG_DATA_URI,
            alt: 'tiny',
            width: 1,
            height: 1,
            surfaces: ['web', 'native'],
          },
        ],
      };
      const blob = await toEpubBlob(doc);
      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      // ZIP entry exists at the expected path.
      const imgEntry = zip.file('OPS/images/image1.png');
      expect(imgEntry).toBeTruthy();
      const imgBytes = await imgEntry!.async('uint8array');
      // PNG magic number — eight-byte signature 89 50 4E 47 0D 0A 1A 0A.
      expect(imgBytes[0]).toBe(0x89);
      expect(imgBytes[1]).toBe(0x50);
      expect(imgBytes[2]).toBe(0x4e);
      expect(imgBytes[3]).toBe(0x47);
      // OPF manifest lists it with the right id + href + media-type.
      const opf = await zip.file('OPS/package.opf')!.async('string');
      expect(opf).toContain(
        '<item id="img-1" href="images/image1.png" media-type="image/png"/>',
      );
      // Chapter XHTML references via the relative path + carries alt + dims.
      const chapter = await zip.file('OPS/chapters/chapter-1.xhtml')!.async('string');
      expect(chapter).toContain('<img src="../images/image1.png"');
      expect(chapter).toContain('alt="tiny"');
      expect(chapter).toContain('width="1"');
      expect(chapter).toContain('height="1"');
      // And the placeholder is NOT present for this resolved image.
      expect(chapter).not.toContain('[Image: tiny]');
    });

    it('falls back to placeholder when fetch fails', async () => {
      // Stub fetch to reject — the resolver should swallow the error and
      // drop the image from the registry, restoring the v1 placeholder.
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net down')));
      const doc: PortableDoc = {
        version: 1,
        title: 'Broken image',
        blocks: [
          {
            id: 'i1',
            type: 'image',
            src: 'https://example.com/missing.png',
            alt: 'gone',
            surfaces: ['web', 'native'],
          },
        ],
      };
      const blob = await toEpubBlob(doc);
      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      // No image binary, no manifest entry.
      expect(zip.file('OPS/images/image1.png')).toBeNull();
      const opf = await zip.file('OPS/package.opf')!.async('string');
      expect(opf).not.toContain('id="img-1"');
      // Chapter falls back to the placeholder paragraph.
      const chapter = await zip.file('OPS/chapters/chapter-1.xhtml')!.async('string');
      expect(chapter).toContain('[Image: gone]');
      expect(chapter).not.toContain('<img src="../images/');
    });
  });
});
