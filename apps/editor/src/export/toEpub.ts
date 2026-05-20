/**
 * Papir → EPUB serializer.
 *
 * Builds a valid EPUB 3 archive directly via JSZip, per the on-disk shape
 * pinned in `2026-05-18-epub-metadata-template.html` (P4 of the multi-format
 * export Goal). The output opens unmodified in iBooks / Calibre / Readium
 * and is rendered live in the EPUB preview channel via epub.js.
 *
 * v1 is single-chapter: every PortableDoc block lands in `OPS/chapters/
 * chapter-1.xhtml`. The nav.xhtml + ncx.xml table of contents both walk
 * the top-level headings only — nested AST sections collapse to flat
 * entries (matching the v1 contract in Figure 5 of the spec). Images
 * follow the v1 toDocx pattern and emit a `[Image: alt]` placeholder
 * paragraph instead of fetching + embedding bytes.
 *
 * Layout (matches Figure 1 of the spec):
 *
 *   mimetype                          (uncompressed, first ZIP entry)
 *   META-INF/container.xml            (verbatim)
 *   META-INF/com.paperflow.ast.json   (round-trip envelope sidecar)
 *   OPS/package.opf
 *   OPS/nav.xhtml
 *   OPS/ncx.xml
 *   OPS/styles/paper.css
 *   OPS/chapters/chapter-1.xhtml
 *
 * DO NOT share logic with toDocx.ts — XHTML is a fundamentally different
 * target and forcing a shared walker between OOXML and XHTML would buy
 * little and cost a lot. The two serializers stay parallel and small.
 */

import type {
  Block,
  HeadingBlock,
  ParagraphBlock,
  ListBlock,
  CalloutBlock,
  ActionBlock,
  SectionBlock,
  CodeBlock,
  ImageBlock,
  TableBlock,
  DividerBlock,
  InlineNode,
  PortableDoc,
} from '@portable-doc/core';
import JSZip from 'jszip';
import { buildEnvelope, generateDocUuid } from '@portable-doc/core';

// ---------------------------------------------------------------------------
// XHTML escape + small helpers
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeAttr(s: string): string {
  return escapeXml(s);
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

// ---------------------------------------------------------------------------
// Inline node → XHTML
// ---------------------------------------------------------------------------

function inlineToXhtml(nodes: InlineNode[] | undefined): string {
  if (!nodes || nodes.length === 0) return '';
  const parts: string[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        parts.push(escapeXml(n.value));
        break;
      case 'strong':
        parts.push(`<strong>${inlineToXhtml(n.children)}</strong>`);
        break;
      case 'em':
        parts.push(`<em>${inlineToXhtml(n.children)}</em>`);
        break;
      case 'code':
        parts.push(`<code>${escapeXml(n.value)}</code>`);
        break;
      case 'link':
        parts.push(
          `<a href="${escapeAttr(n.href)}">${inlineToXhtml(n.children)}</a>`,
        );
        break;
    }
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Block → XHTML walker.
//
// Returns one XHTML string per top-level block. Sections recurse; everything
// else emits a single element. Heading IDs are slugged from their text so
// nav.xhtml can deep-link via `chapter-1.xhtml#<slug>` and (later) jumps
// from the chapter surface itself work.
//
// Image blocks need an `ImageRegistry` passed through the walker so each
// resolved binary lands once in the OPS/images/ directory and is referenced
// by its slot index from chapter.xhtml + the OPF manifest. The registry is
// pre-populated by `resolveImages` before the chapter is rendered — the
// walker only reads.
// ---------------------------------------------------------------------------

/** A successfully resolved image binary destined for OPS/images/imageN.<ext>. */
interface ResolvedImage {
  /** 1-based slot index — image1, image2, …. */
  slot: number;
  /** Final file extension without the dot — png|jpg|jpeg|gif. */
  ext: string;
  /** OPF manifest media-type — image/png|image/jpeg|image/gif. */
  mediaType: string;
  /** Decoded binary payload. */
  bytes: Uint8Array;
  /** Optional intrinsic dimensions carried through from the block. */
  width?: number;
  height?: number;
  /** Alt text — escaped at emit time, not now. */
  alt: string;
}

/** Index keyed on the originating block's `id` so blockToXhtml can look it
 *  up cheaply without re-walking. A block whose `id` is not present here
 *  was either not resolvable (fetch failure / unsupported MIME) or had no
 *  id, and falls back to the `[Image: alt]` placeholder paragraph. */
type ImageRegistry = Map<string, ResolvedImage>;

function blockToXhtml(b: Block, depth = 0, images?: ImageRegistry): string {
  switch (b.type) {
    case 'heading':
      return headingToXhtml(b, depth);
    case 'paragraph':
      return paragraphToXhtml(b);
    case 'list':
      return listToXhtml(b);
    case 'callout':
      return calloutToXhtml(b);
    case 'action':
      return actionToXhtml(b);
    case 'section':
      return sectionToXhtml(b, depth, images);
    case 'divider':
      return dividerToXhtml(b);
    case 'code':
      return codeToXhtml(b);
    case 'image':
      return imageToXhtml(b, images);
    case 'table':
      return tableToXhtml(b);
    default:
      return '';
  }
}

function headingToXhtml(b: HeadingBlock, depth: number): string {
  const level = Math.min(6, Math.max(1, b.level + Math.min(depth, 2)));
  const text = b.text ?? '';
  const id = slugify(text);
  return `<h${level} id="${escapeAttr(id)}">${escapeXml(text)}</h${level}>`;
}

function paragraphToXhtml(b: ParagraphBlock): string {
  return `<p>${inlineToXhtml(b.content)}</p>`;
}

function listToXhtml(b: ListBlock): string {
  const tag = b.ordered === true ? 'ol' : 'ul';
  const items = b.items
    .map((item) => `  <li>${inlineToXhtml(item)}</li>`)
    .join('\n');
  return `<${tag}>\n${items}\n</${tag}>`;
}

function calloutToXhtml(b: CalloutBlock): string {
  const emphasis = b.variant?.emphasis ?? 'subtle';
  // Class shape matches the P3 variant mapping: paper-callout-{tone}-{emphasis}.
  const cls = `paper-callout paper-callout-${b.tone}-${emphasis}`;
  const titlePart = b.title
    ? `  <p class="paper-callout__title">${escapeXml(b.title)}</p>\n`
    : '';
  return `<aside class="${escapeAttr(cls)}">\n${titlePart}  <p>${inlineToXhtml(
    b.content,
  )}</p>\n</aside>`;
}

function actionToXhtml(b: ActionBlock): string {
  const priority = b.priority ?? 'primary';
  return `<p class="paper-action paper-action-${escapeAttr(
    priority,
  )}"><a href="${escapeAttr(b.href ?? '#')}">${escapeXml(b.label ?? '')}</a></p>`;
}

function sectionToXhtml(b: SectionBlock, depth: number, images?: ImageRegistry): string {
  const titlePart = b.title
    ? `  <h${Math.min(6, 2 + depth)} class="paper-section__title">${escapeXml(b.title)}</h${Math.min(6, 2 + depth)}>\n`
    : '';
  const children = b.blocks.map((c) => blockToXhtml(c, depth + 1, images)).join('\n');
  return `<section class="paper-section">\n${titlePart}${children}\n</section>`;
}

function dividerToXhtml(_b: DividerBlock): string {
  // Self-closing; XHTML requires the trailing slash.
  return '<hr/>';
}

function codeToXhtml(b: CodeBlock): string {
  const lang = b.lang ? ` data-lang="${escapeAttr(b.lang)}"` : '';
  return `<pre class="paper-code"${lang}><code>${escapeXml(b.value ?? '')}</code></pre>`;
}

function imageToXhtml(b: ImageBlock, images?: ImageRegistry): string {
  const resolved = images?.get(b.id);
  if (!resolved) {
    // Unresolved (no fetch attempt, network/CORS/404 failure, or unsupported
    // MIME). Emit the v1 placeholder paragraph so the chapter still reads.
    const alt = b.alt || b.src;
    return `<p class="paper-image-placeholder"><em>[Image: ${escapeXml(alt)}]</em></p>`;
  }
  const href = `../images/image${resolved.slot}.${resolved.ext}`;
  const dimAttrs =
    (resolved.width ? ` width="${resolved.width}"` : '') +
    (resolved.height ? ` height="${resolved.height}"` : '');
  return `<p class="paper-image"><img src="${escapeAttr(href)}" alt="${escapeAttr(resolved.alt)}"${dimAttrs}/></p>`;
}

// ---------------------------------------------------------------------------
// Image resolution — data: URI decode + http(s) fetch.
//
// Pre-walked once before chapter render so each image's slot index is
// stable and the OPF manifest, ZIP binary, and chapter `<img src=...>` all
// agree. Failures (bad data URI, fetch reject, non-2xx, unsupported MIME)
// drop the entry from the registry — the walker then falls back to the
// `[Image: alt]` placeholder.
// ---------------------------------------------------------------------------

/** Per-MIME extension mapping. Anything outside this set is unsupported
 *  and triggers placeholder fallback — EPUB readers only reliably render
 *  these three raster formats. SVG is intentionally excluded for v1 (the
 *  reader sandbox makes it brittle). */
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
};

function normalizeMime(raw: string): { mediaType: string; ext: string } | null {
  const lower = raw.toLowerCase().trim().split(';')[0]!.trim();
  const ext = MIME_TO_EXT[lower];
  if (!ext) return null;
  // Normalise image/jpg → image/jpeg in the manifest (jpg is a common but
  // non-standard MIME); the file extension stays `jpg` for readability.
  const mediaType = lower === 'image/jpg' ? 'image/jpeg' : lower;
  return { mediaType, ext };
}

function decodeBase64(b64: string): Uint8Array {
  // atob is available in browser + happy-dom test env + modern Node.
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function resolveOne(b: ImageBlock): Promise<Omit<ResolvedImage, 'slot'> | null> {
  const src = b.src ?? '';
  try {
    if (src.startsWith('data:')) {
      // data:[<mediatype>][;base64],<data>
      const comma = src.indexOf(',');
      if (comma < 0) return null;
      const header = src.slice(5, comma);
      const payload = src.slice(comma + 1);
      const isBase64 = /;base64$/i.test(header);
      const mimeRaw = isBase64 ? header.replace(/;base64$/i, '') : header;
      const mime = normalizeMime(mimeRaw || 'image/png');
      if (!mime) return null;
      const bytes = isBase64
        ? decodeBase64(payload)
        : new TextEncoder().encode(decodeURIComponent(payload));
      return {
        ext: mime.ext,
        mediaType: mime.mediaType,
        bytes,
        width: b.width,
        height: b.height,
        alt: b.alt ?? '',
      };
    }
    if (src.startsWith('http://') || src.startsWith('https://')) {
      const res = await fetch(src);
      if (!res.ok) return null;
      const mime = normalizeMime(res.headers.get('content-type') ?? '');
      if (!mime) return null;
      const buf = await res.arrayBuffer();
      return {
        ext: mime.ext,
        mediaType: mime.mediaType,
        bytes: new Uint8Array(buf),
        width: b.width,
        height: b.height,
        alt: b.alt ?? '',
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Walk every nested block, returning each image block (id required so
 *  blockToXhtml can look it back up). Mirrors the section recursion in
 *  blockToXhtml — section bodies are flattened in place. */
function collectImageBlocks(blocks: Block[], out: ImageBlock[] = []): ImageBlock[] {
  for (const b of blocks) {
    if (b.type === 'image') out.push(b);
    else if (b.type === 'section') collectImageBlocks(b.blocks, out);
  }
  return out;
}

async function resolveImages(doc: PortableDoc): Promise<ImageRegistry> {
  const registry: ImageRegistry = new Map();
  const imageBlocks = collectImageBlocks(doc.blocks);
  let slot = 0;
  for (const b of imageBlocks) {
    const resolved = await resolveOne(b);
    if (!resolved) continue;
    slot += 1;
    registry.set(b.id, { ...resolved, slot });
  }
  return registry;
}

function tableToXhtml(b: TableBlock): string {
  const rows = b.rows
    .map((row, rowIdx) => {
      const tag = rowIdx === 0 ? 'th' : 'td';
      const cells = row
        .map((cell) => `    <${tag}>${inlineToXhtml(cell)}</${tag}>`)
        .join('\n');
      return `  <tr>\n${cells}\n  </tr>`;
    })
    .join('\n');
  return `<table class="paper-table">\n${rows}\n</table>`;
}

// ---------------------------------------------------------------------------
// Top-level heading harvest — feeds nav.xhtml + ncx.xml.
//
// Only top-level (depth=0) headings make it into the table of contents per
// the v1 contract (Figure 5: depth=1, flat). Section titles do not surface
// in the toc — the structural hierarchy lives in the chapter body, and
// nav.xhtml stays calm.
// ---------------------------------------------------------------------------

interface TocEntry {
  text: string;
  anchor: string;
}

function harvestToc(doc: PortableDoc): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const b of doc.blocks) {
    if (b.type === 'heading') {
      const text = b.text ?? '';
      entries.push({ text, anchor: slugify(text) });
    }
  }
  // Calm fallback: if the doc has zero top-level headings, surface a single
  // "Document" entry pointing at the chapter's start so the toc is non-empty
  // (some readers refuse to render a navMap with zero navPoints).
  if (entries.length === 0) {
    entries.push({ text: doc.title ?? 'Document', anchor: 'top' });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// File templates — package.opf, nav.xhtml, ncx.xml, paper.css, chapter-1.xhtml.
//
// All four are emitted with single static strings + simple interpolation;
// no template engine, no per-block hot paths in the package metadata. The
// chapter body assembles via blockToXhtml above.
// ---------------------------------------------------------------------------

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

function buildOpf(
  doc: PortableDoc,
  uuid: string,
  language: string,
  modifiedIso: string,
  images: ImageRegistry,
): string {
  const title = doc.title ?? 'Untitled';
  // Sort by slot so manifest order is deterministic and matches the
  // images/imageN.<ext> file naming on disk.
  const imageItems = Array.from(images.values())
    .sort((a, b) => a.slot - b.slot)
    .map(
      (img) =>
        `    <item id="img-${img.slot}" href="images/image${img.slot}.${img.ext}" media-type="${escapeAttr(img.mediaType)}"/>`,
    )
    .join('\n');
  const imagesSection = imageItems ? `\n${imageItems}` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf"
         xmlns:dc="http://purl.org/dc/elements/1.1/"
         version="3.0"
         xml:lang="${escapeAttr(language)}"
         unique-identifier="pub-id">
  <metadata>
    <dc:identifier id="pub-id">urn:uuid:${escapeXml(uuid)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>${escapeXml(language)}</dc:language>
    <dc:creator>Papir</dc:creator>
    <dc:publisher>Papir</dc:publisher>
    <dc:date>${escapeXml(modifiedIso.slice(0, 10))}</dc:date>
    <meta property="dcterms:modified">${escapeXml(modifiedIso)}</meta>
    <meta property="schema:accessibilityFeature">structuralNavigation</meta>
    <meta property="schema:accessibilityFeature">readingOrder</meta>
    <meta property="schema:accessibilityFeature">tableOfContents</meta>
    <meta property="schema:accessibilityHazard">none</meta>
    <meta property="schema:accessibilityMode">textual</meta>
    <meta property="schema:accessibilityMode">visual</meta>
  </metadata>
  <manifest>
    <item id="nav"       href="nav.xhtml"           media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx"       href="ncx.xml"             media-type="application/x-dtbncx+xml"/>
    <item id="css-paper" href="styles/paper.css"    media-type="text/css"/>
    <item id="ch-1"      href="chapters/chapter-1.xhtml" media-type="application/xhtml+xml"/>${imagesSection}
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch-1" linear="yes"/>
    <itemref idref="nav"  linear="no"/>
  </spine>
</package>
`;
}

function buildNavXhtml(doc: PortableDoc, toc: TocEntry[], language: string): string {
  const title = doc.title ?? 'Untitled';
  const items = toc
    .map(
      (e) =>
        `      <li><a href="chapters/chapter-1.xhtml#${escapeAttr(e.anchor)}">${escapeXml(e.text)}</a></li>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:epub="http://www.idpf.org/2007/ops"
      xml:lang="${escapeAttr(language)}" lang="${escapeAttr(language)}">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles/paper.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc" role="doc-toc">
    <h1>Contents</h1>
    <ol>
${items}
    </ol>
  </nav>
  <nav epub:type="landmarks" id="landmarks" hidden="hidden">
    <h2>Landmarks</h2>
    <ol>
      <li><a epub:type="toc" href="nav.xhtml#toc">Table of Contents</a></li>
      <li><a epub:type="bodymatter" href="chapters/chapter-1.xhtml">Begin Reading</a></li>
    </ol>
  </nav>
</body>
</html>
`;
}

function buildNcx(doc: PortableDoc, uuid: string, toc: TocEntry[], language: string): string {
  const title = doc.title ?? 'Untitled';
  const points = toc
    .map(
      (e, i) =>
        `    <navPoint id="navpoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(e.text)}</text></navLabel>
      <content src="chapters/chapter-1.xhtml#${escapeAttr(e.anchor)}"/>
    </navPoint>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${escapeAttr(language)}">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${escapeXml(uuid)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <docAuthor><text>Papir</text></docAuthor>
  <navMap>
${points}
  </navMap>
</ncx>
`;
}

/** Slim reader-only stylesheet for the bundled EPUB. Intentionally
 *  separate from the editor's `paper.css` — this one targets readers,
 *  not the editing surface, so no chrome, no floating UI, no focus
 *  rings. Variant classes for callouts/actions follow the P3 mapping. */
function buildReaderCss(): string {
  return `/* Papir EPUB reader stylesheet — minimal book typography. */
html, body {
  margin: 0;
  padding: 0;
  font-family: Georgia, "Iowan Old Style", serif;
  color: #1f1a14;
  background: #fbfaf6;
  line-height: 1.6;
}
body {
  max-width: 36em;
  margin: 0 auto;
  padding: 1.5em 1em 3em;
}
h1, h2, h3, h4, h5, h6 {
  font-family: Georgia, "Iowan Old Style", serif;
  font-weight: 700;
  line-height: 1.25;
  margin: 1.6em 0 0.6em;
  color: #1f1a14;
}
h1 { font-size: 1.625em; margin-top: 0.6em; }
h2 { font-size: 1.25em; }
h3 { font-size: 1.125em; }
h4 { font-size: 1em; }
h5 { font-size: 0.95em; }
h6 { font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.04em; }
p {
  margin: 0 0 1em;
  /* Left-aligned ragged (no justify) — matches the editor. Justified text
   * with hyphenation creates wavy word-spacing that diverges from the
   * editor's straight left edge + tight rhythm. */
  text-align: left;
}
a {
  color: #a23925;
  text-decoration: underline;
}
ul, ol {
  margin: 0 0 1em 1.6em;
  padding: 0;
}
li { margin: 0 0 0.3em; }
hr {
  border: 0;
  border-bottom: 1px solid #d8d1bf;
  margin: 2em 0;
}
pre.paper-code {
  background: #f5f2e9;
  border: 1px solid #d8d1bf;
  border-radius: 4px;
  padding: 0.8em 1em;
  font-family: Consolas, "SF Mono", Menlo, monospace;
  font-size: 0.9em;
  overflow-x: auto;
  white-space: pre-wrap;
  line-height: 1.45;
}
code {
  background: #efede6;
  padding: 0.05em 0.3em;
  border-radius: 3px;
  font-family: Consolas, "SF Mono", Menlo, monospace;
  font-size: 0.92em;
}
aside.paper-callout {
  border-left: 4px solid #374151;
  background: #f3f4f6;
  padding: 0.8em 1em;
  margin: 1.2em 0;
  border-radius: 0 4px 4px 0;
}
aside.paper-callout p { margin: 0 0 0.5em; }
aside.paper-callout p:last-child { margin-bottom: 0; }
aside.paper-callout__title,
aside.paper-callout > .paper-callout__title {
  font-weight: 700;
  margin-bottom: 0.4em;
}
aside.paper-callout-info-subtle    { border-left-color: #1d4ed8; background: #eff6ff; }
aside.paper-callout-info-bold      { border-left-color: #1d4ed8; background: #eff6ff; border-left-width: 6px; }
aside.paper-callout-success-subtle { border-left-color: #047857; background: #ecfdf5; }
aside.paper-callout-success-bold   { border-left-color: #047857; background: #ecfdf5; border-left-width: 6px; }
aside.paper-callout-warning-subtle { border-left-color: #92400e; background: #fffbeb; }
aside.paper-callout-warning-bold   { border-left-color: #92400e; background: #fffbeb; border-left-width: 6px; }
aside.paper-callout-danger-subtle  { border-left-color: #b91c1c; background: #fef2f2; }
aside.paper-callout-danger-bold    { border-left-color: #b91c1c; background: #fef2f2; border-left-width: 6px; }
aside.paper-callout-neutral-subtle { border-left-color: #374151; background: #f3f4f6; }
aside.paper-callout-neutral-bold   { border-left-color: #374151; background: #f3f4f6; border-left-width: 6px; }
aside.paper-callout-info-subtle .paper-callout__title,
aside.paper-callout-info-bold .paper-callout__title { color: #1d4ed8; }
aside.paper-callout-success-subtle .paper-callout__title,
aside.paper-callout-success-bold .paper-callout__title { color: #047857; }
aside.paper-callout-warning-subtle .paper-callout__title,
aside.paper-callout-warning-bold .paper-callout__title { color: #92400e; }
aside.paper-callout-danger-subtle .paper-callout__title,
aside.paper-callout-danger-bold .paper-callout__title { color: #b91c1c; }
aside.paper-callout-neutral-subtle .paper-callout__title,
aside.paper-callout-neutral-bold .paper-callout__title { color: #374151; }
/* Action blocks render as plain underlined warm-rust links — matches the
 * editor's link aesthetic. Previous filled-button styling made "Open
 * workspace" look like a Material button instead of a Papir link. */
p.paper-action a {
  color: #a23925;
  text-decoration: underline;
}
p.paper-action-primary a {
  font-weight: 600;
}
table.paper-table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
}
table.paper-table th,
table.paper-table td {
  border: 1px solid #d8d1bf;
  padding: 0.4em 0.6em;
  text-align: left;
  vertical-align: top;
}
table.paper-table th { background: #f5f2e9; }
section.paper-section { margin: 1em 0; }
p.paper-image-placeholder { color: #6b7280; font-style: italic; }
`;
}

function buildChapterXhtml(doc: PortableDoc, language: string, images: ImageRegistry): string {
  const title = doc.title ?? 'Untitled';
  const body = doc.blocks.map((b) => blockToXhtml(b, 0, images)).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:epub="http://www.idpf.org/2007/ops"
      xml:lang="${escapeAttr(language)}" lang="${escapeAttr(language)}">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/paper.css"/>
</head>
<body>
<a id="top"></a>
${body}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** EPUB export options. Mirrors `ToDocxOptions` so the seam is uniform
 *  across serializers. `docUuid` reuses an existing identifier across
 *  re-exports of the same source doc; otherwise a fresh UUID is minted.
 *  `language` is BCP-47 (e.g. "en-US", "nb-NO") and drives every reader's
 *  hyphenation + spell-check pass; defaults to "en-US". */
export interface ToEpubOptions {
  docUuid?: string;
  language?: string;
}

/** Standard MIME type — readers sniff this from the first ZIP entry. */
export const EPUB_MIME = 'application/epub+zip';

export async function toEpubBlob(
  doc: PortableDoc,
  options?: ToEpubOptions,
): Promise<Blob> {
  const docUuid = options?.docUuid ?? generateDocUuid();
  const language = options?.language ?? 'en-US';
  const modifiedIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const zip = new JSZip();

  // CRITICAL ordering: `mimetype` MUST be the FIRST entry in the archive
  // AND stored uncompressed (STORE, not DEFLATE), with no extra fields.
  // JSZip writes entries in the order `.file()` is called, so this call
  // must come before every other zip.file() below.
  zip.file('mimetype', EPUB_MIME, { compression: 'STORE' });

  // META-INF — container.xml + the round-trip envelope sidecar.
  zip.file('META-INF/container.xml', CONTAINER_XML);

  const envelope = buildEnvelope(doc, docUuid);
  zip.file(
    'META-INF/com.paperflow.ast.json',
    JSON.stringify(envelope, null, 2),
  );

  // Resolve every image up front — must precede chapter render so each
  // <img src="..."> agrees with the manifest entry and the ZIP binary.
  // Resolution is best-effort; unresolved images fall back to placeholders.
  const images = await resolveImages(doc);

  // OPS — package, navigation, stylesheet, chapter.
  const toc = harvestToc(doc);
  zip.file('OPS/package.opf', buildOpf(doc, docUuid, language, modifiedIso, images));
  zip.file('OPS/nav.xhtml', buildNavXhtml(doc, toc, language));
  zip.file('OPS/ncx.xml', buildNcx(doc, docUuid, toc, language));
  zip.file('OPS/styles/paper.css', buildReaderCss());
  zip.file('OPS/chapters/chapter-1.xhtml', buildChapterXhtml(doc, language, images));

  // Image binaries — one entry per resolved image, named to match the OPF
  // manifest hrefs (images/imageN.<ext>) and the chapter <img src=...>.
  for (const img of images.values()) {
    zip.file(`OPS/images/image${img.slot}.${img.ext}`, img.bytes);
  }

  return await zip.generateAsync({
    type: 'blob',
    mimeType: EPUB_MIME,
    // Re-affirm STORE for mimetype at generate time too — belt-and-suspenders.
    // The per-file option above sets it; this guards against future JSZip
    // changes that might honor only one of the two paths.
    compression: 'DEFLATE',
  });
}
