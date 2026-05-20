/**
 * Papir → DOCX serializer.
 *
 * Pure-JS DOCX emission using `docx` (dolanmiu). Pragmatic v1 replacement for
 * the pandoc-wasm path named in the bound-decision spec
 * `2026-05-18-multi-format-export-contract.html` — same output mechanism
 * (a .docx file Word / Pages / Google Docs all open natively), without the
 * wasm bootstrap. The spec stays valid for a future swap; the ExportMenu UI
 * does not change.
 *
 * Variant → ParagraphStyle names track the 21-row catalog in
 * `2026-05-18-variant-style-mapping.html` (PascalCase: CalloutSuccessSubtle,
 * ActionPrimaryMedium, SectionComfortable, CodeDarkNormal, etc). Variant tones
 * not in the catalog emit a `[Unsupported variant: <name>]` callout per
 * bound decision #8.
 *
 * Images are embedded as real `ImageRun`s — `data:` URIs are base64-decoded
 * inline, `http(s)` URLs are fetched and their bytes packed into the OPC
 * zip under `word/media/imageN.<ext>`. Width is clamped to 720px so a giant
 * source doesn't blow past the A4 text column; explicit `b.width`/`b.height`
 * win when present, still clamped. On resolve failure (CORS, 404, malformed
 * data URI) the renderer falls back to the structural placeholder paragraph
 * `[Image: <alt>]` so the surrounding document still reads in order.
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
  Tone,
} from '@portable-doc/core';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LineRuleType,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
  type IParagraphStyleOptions,
  type ParagraphChild,
} from 'docx';
import JSZip from 'jszip';
import { buildEnvelope, generateDocUuid } from '@portable-doc/core';

// ---------------------------------------------------------------------------
// Source Serif 4 — embedded font bytes
// ---------------------------------------------------------------------------
//
// Per spec `2026-05-20-channel-embed.html` §2 ("DOCX — word/fontTable.xml +
// word/fonts/*.ttf"), the .docx ships with the four SourceSerif4 weights
// embedded so it opens with the same prose face every reader sees in the
// editor — no font-substitution lottery in Word / Pages / Google Docs.
//
// `new URL(..., import.meta.url)` is Vite's documented pattern for static
// asset references in source — at build time the loader rewrites the URL
// to the bundled-asset path; at dev time it resolves to the public/fonts
// path via the public-dir middleware. The fetched ArrayBuffers feed
// `Document({ fonts: [...] })` which writes both `word/fonts/*.ttf` and
// `word/fontTable.xml` for us. (Alternatively a `?arraybuffer` Vite suffix
// would skip the runtime fetch, but that requires `vite-plugin-arraybuffer`
// — the fetch path is plugin-free and runs in both dev + prod browser
// bundles. Vitest/happy-dom doesn't reach the URL; the font block is
// silently skipped when fetch throws, see loadEmbeddedFonts.)
const FONT_URLS = {
  regular: new URL('../../public/fonts/SourceSerif4-Regular.ttf', import.meta.url),
  italic: new URL('../../public/fonts/SourceSerif4-Italic.ttf', import.meta.url),
  bold: new URL('../../public/fonts/SourceSerif4-Bold.ttf', import.meta.url),
  boldItalic: new URL('../../public/fonts/SourceSerif4-BoldItalic.ttf', import.meta.url),
} as const;

// docx 9.6.1's FontOptions is `{ name: string; data: Buffer; characterSet? }`
// — the public API does NOT surface per-weight slots (the OOXML
// `<w:embedItalic>`/`<w:embedBold>`/`<w:embedBoldItalic>` elements exist in
// the library's internal element builder but aren't exposed on FontOptions).
// We therefore ship all four weights as separate FontOptions entries all
// named "Source Serif 4". Each becomes its own `<w:font w:name="Source
// Serif 4">` block with an `embedRegular` ref to its own
// `word/fonts/SourceSerif4-N.ttf` part. Word + Pages + Google Docs all
// deduplicate by `w:name` at render time; the family name in styles.xml
// resolves to whichever weight the run requests, with the renderer
// synthesizing missing slots if needed. Bound for B3; the channel-embed
// spec's literal JS shape (`family: 'roman', bold: true, ...`) is
// aspirational against the docx 9.6.1 API — those fields aren't honored.
//
// `data` must be Buffer | Uint8Array (TS sig says Buffer, runtime accepts
// Uint8Array per node's Buffer-extends-Uint8Array shape). We feed
// Uint8Array views over the fetched ArrayBuffers — happy in both browser
// (no Node Buffer) and node (Buffer is a Uint8Array subclass).
interface FontEntryInput {
  name: 'Source Serif 4';
  data: Uint8Array;
}

/** Fetch the four SourceSerif4 TTFs in parallel and shape them into the
 *  docx-library's `fonts: [...]` argument. Returns an empty array when
 *  any fetch fails AND the Node fs fallback also fails — the resulting
 *  .docx then falls back to the renderer's font-substitution (still
 *  names "Source Serif 4" in styles.xml, so a reader with the face
 *  installed locally still gets it).
 *
 *  The Node fs fallback covers the structural-check / tsx-script case:
 *  `new URL(..., import.meta.url) + fetch()` works in browsers (Vite
 *  rewrites the URL to a bundled asset), but in Node the URL points at
 *  a `file://` and `fetch` may either reject (older Node) or return a
 *  response whose `arrayBuffer()` is empty/zero-length (some
 *  undici-on-node versions). Either way the script previously got
 *  silently empty Uint8Arrays. The fallback reads the same four TTFs
 *  off disk so the embedded-fonts contract holds in Node as well. */
async function loadEmbeddedFonts(): Promise<FontEntryInput[]> {
  // Browser / Vite path — fetch via Vite-rewritten URL.
  try {
    const [reg, italic, bold, boldItalic] = await Promise.all([
      fetch(FONT_URLS.regular).then((r) => r.arrayBuffer()),
      fetch(FONT_URLS.italic).then((r) => r.arrayBuffer()),
      fetch(FONT_URLS.bold).then((r) => r.arrayBuffer()),
      fetch(FONT_URLS.boldItalic).then((r) => r.arrayBuffer()),
    ]);
    // Guard against undici's "file:// fetch returns empty body" quirk:
    // if every buffer is zero bytes, treat as failure and try the fs path.
    if (reg.byteLength > 0 && italic.byteLength > 0 && bold.byteLength > 0 && boldItalic.byteLength > 0) {
      return [
        { name: 'Source Serif 4', data: new Uint8Array(reg) },
        { name: 'Source Serif 4', data: new Uint8Array(italic) },
        { name: 'Source Serif 4', data: new Uint8Array(bold) },
        { name: 'Source Serif 4', data: new Uint8Array(boldItalic) },
      ];
    }
  } catch {
    /* fall through to Node fs path */
  }
  // Node path — read from disk relative to this module's source URL.
  // Guarded by `typeof window` so this branch is dead-code in browser
  // bundles (Vite tree-shakes `fs` away when `window !== undefined`).
  if (typeof window === 'undefined') {
    try {
      const { readFileSync } = await import('node:fs');
      const { fileURLToPath } = await import('node:url');
      const read = (u: URL): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(u)));
      return [
        { name: 'Source Serif 4', data: read(FONT_URLS.regular) },
        { name: 'Source Serif 4', data: read(FONT_URLS.italic) },
        { name: 'Source Serif 4', data: read(FONT_URLS.bold) },
        { name: 'Source Serif 4', data: read(FONT_URLS.boldItalic) },
      ];
    } catch {
      return [];
    }
  }
  return [];
}

// docx's IRunOptions marks every field readonly; we build it incrementally
// (collapsing nested marks one level at a time) so a writable shape is the
// natural fit.
interface RunOpts {
  text: string;
  bold?: boolean;
  italics?: boolean;
  font?: string;
  color?: string;
  style?: string;
  size?: number;
  noProof?: boolean;
  underline?: { type: (typeof UnderlineType)[keyof typeof UnderlineType]; color?: string };
  shading?: { type: (typeof ShadingType)[keyof typeof ShadingType]; color: string; fill: string };
}

// ---------------------------------------------------------------------------
// Variant → ParagraphStyle name. PascalCase per
// 2026-05-18-variant-style-mapping.html. Tones / emphases off the catalog
// fall through to `null` and trigger the "[Unsupported variant: …]" callout.
// ---------------------------------------------------------------------------

// Hand-picked TailwindCSS-50 background + tone-700 border per the
// paper.css palette. Used by callouts (block-level pBdr + shading) and
// the seeded paragraph-style runs.
const CALLOUT_TONES: Record<Tone, { bg: string; border: string }> = {
  info: { bg: 'EFF6FF', border: '1D4ED8' },
  success: { bg: 'ECFDF5', border: '047857' },
  warning: { bg: 'FFFBEB', border: '92400E' },
  danger: { bg: 'FEF2F2', border: 'B91C1C' },
  neutral: { bg: 'F3F4F6', border: '374151' },
};

function pascal(s: string): string {
  return s
    .split(/[-_/\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join('');
}

function calloutStyleName(tone: Tone, variant?: Record<string, string>): string | null {
  const emphasis = variant?.emphasis ?? 'subtle';
  if (emphasis !== 'subtle' && emphasis !== 'bold') return null;
  return `Callout${pascal(tone)}${pascal(emphasis)}`;
}

function sectionStyleName(variant?: Record<string, string>): string {
  const density = variant?.density ?? 'comfortable';
  return `Section${pascal(density)}`;
}

function codeStyleName(variant?: Record<string, string>): string {
  const theme = variant?.theme ?? 'light';
  const density = variant?.density ?? 'normal';
  return `Code${pascal(theme)}${pascal(density)}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  );
}

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

// ---------------------------------------------------------------------------
// Inline marks walker — InlineNode[] → ParagraphChild[]
// ---------------------------------------------------------------------------

interface RunCtx {
  bold?: boolean;
  italics?: boolean;
  font?: string;
  color?: string;
  style?: string;
  underline?: { type: (typeof UnderlineType)[keyof typeof UnderlineType]; color?: string };
}

function inlineToRuns(nodes: InlineNode[] | undefined, ctx: RunCtx = {}): ParagraphChild[] {
  if (!nodes || nodes.length === 0) return [];
  const out: ParagraphChild[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case 'text': {
        const opts: RunOpts = { text: n.value };
        if (ctx.bold) opts.bold = true;
        if (ctx.italics) opts.italics = true;
        if (ctx.font) opts.font = ctx.font;
        if (ctx.color) opts.color = ctx.color;
        if (ctx.underline) opts.underline = ctx.underline;
        if (ctx.style) opts.style = ctx.style;
        out.push(new TextRun(opts));
        break;
      }
      case 'strong':
        out.push(...inlineToRuns(n.children, { ...ctx, bold: true }));
        break;
      case 'em':
        out.push(...inlineToRuns(n.children, { ...ctx, italics: true }));
        break;
      case 'code': {
        // Warmer cream-tinged inline code fill (paper-stone variant) plus
        // 10pt size (0.92× the 11pt body) and noProof so Word/Pages/Docs
        // don't run a wavy red underline through identifiers.
        const opts: RunOpts = {
          text: n.value,
          font: 'Consolas',
          size: 20,
          noProof: true,
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EFEDE6' },
        };
        if (ctx.bold) opts.bold = true;
        if (ctx.italics) opts.italics = true;
        out.push(new TextRun(opts));
        break;
      }
      case 'link': {
        // Belt-and-suspenders: bind the overridden "Hyperlink" character
        // style AND set direct-formatting color + underline on the
        // child runs. Pages / Google Docs strip the style binding on
        // import; the direct formatting survives the round-trip.
        const linkCtx: RunCtx = {
          ...ctx,
          color: 'A23925',
          underline: { type: UnderlineType.SINGLE },
          style: 'Hyperlink',
        };
        const childRuns = inlineToRuns(n.children, linkCtx);
        out.push(
          new ExternalHyperlink({
            link: n.href,
            children:
              childRuns.length > 0
                ? childRuns
                : [
                    new TextRun({
                      text: n.href,
                      color: 'A23925',
                      underline: { type: UnderlineType.SINGLE },
                      style: 'Hyperlink',
                    }),
                  ],
          }),
        );
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block walker — produces a flat list of Paragraph / Table.
// Sections, lists, and tables fan out to multiple top-level elements.
// ---------------------------------------------------------------------------

type TopChild = Paragraph | Table;

/** 240 twips per nesting level — about 0.17in / 4.2mm. Matches the
 *  visual indent paper.css ships for nested sections in the editor. */
const SECTION_NEST_INDENT = 240;

function nestedIndent(depth: number): { left: number } | undefined {
  // First-level section contents (depth=1) are NOT visually indented in
  // Papir's editor — sections at the top level read flush with body. Only
  // DEEPLY nested sections (depth>=2) get the indent step. Otherwise a doc
  // that contains a "What's next" section would push every paragraph in it
  // right by 240 twips, while the editor renders them flush — a visible
  // mismatch in the visual-check pipeline.
  if (depth <= 1) return undefined;
  return { left: SECTION_NEST_INDENT * (depth - 1) };
}

function paragraphForHeading(b: HeadingBlock, depth = 0): Paragraph {
  const level = Math.min(6, Math.max(1, b.level)) - 1;
  const indent = nestedIndent(depth);
  return new Paragraph({
    heading: HEADING_LEVELS[level],
    ...(indent ? { indent } : {}),
    children: [new TextRun({ text: b.text ?? '' })],
  });
}

function paragraphForParagraph(b: ParagraphBlock, depth = 0): Paragraph {
  const indent = nestedIndent(depth);
  return new Paragraph({
    ...(indent ? { indent } : {}),
    children: inlineToRuns(b.content),
  });
}

function paragraphsForList(b: ListBlock, depth = 0): Paragraph[] {
  const ordered = b.ordered === true;
  const baseLeft = ordered ? 360 : 360;
  const extra = SECTION_NEST_INDENT * depth;
  return b.items.map(
    (item) =>
      new Paragraph({
        children: inlineToRuns(item),
        numbering: {
          reference: ordered ? 'paper-ordered' : 'paper-bullet',
          level: 0,
        },
        ...(depth > 0
          ? { indent: { left: baseLeft + extra, hanging: 360 } }
          : {}),
      }),
  );
}

function paragraphsForCallout(b: CalloutBlock): Paragraph[] {
  const styleId = calloutStyleName(b.tone, b.variant);
  if (!styleId) {
    return paragraphsForUnsupportedVariant(`callout/${b.tone}/${b.variant?.emphasis ?? '?'}`);
  }
  const tone = CALLOUT_TONES[b.tone];
  const emphasis = b.variant?.emphasis ?? 'subtle';
  // OOXML pBdr `sz` is in eighths of a point — 18 = 2.25pt subtle,
  // 24 = 3pt bold. `between` joins the consecutive paragraphs of a
  // multi-line callout so the left rule reads as one continuous bar.
  const borderSize = emphasis === 'bold' ? 24 : 18;
  const calloutBorder = {
    left: {
      style: BorderStyle.SINGLE,
      size: borderSize,
      space: 16,
      color: tone.border,
    },
    between: {
      style: BorderStyle.SINGLE,
      size: borderSize,
      space: 0,
      color: tone.border,
    },
  };
  // CRITICAL: ShadingType.CLEAR (not SOLID). SOLID is opaque and paints
  // over text in some renderers; CLEAR is the OOXML idiom for tinted
  // fills behind text.
  const calloutShading = {
    type: ShadingType.CLEAR,
    color: 'auto',
    fill: tone.bg,
  };
  // Callout paragraph spacing — spec §"Callout padding": 12pt vertical (240
  // twips). after=0 keeps the spec's body-paragraph rule, line=372 mirrors
  // body line-height. The 16pt horizontal padding lives on the indent
  // (320 twips ≈ 16pt × 20).
  const calloutSpacing = {
    before: 240,
    after: 0,
    line: 372,
    lineRule: LineRuleType.AUTO,
  };
  const calloutIndent = { left: 320, right: 320 };
  // Emit title + body as ONE paragraph with a soft break (<w:br/>) between
  // them. The prior "two paragraphs joined by border.between" approach
  // worked in Word/Pages but Google Docs collapses such joined paragraphs
  // onto a single visual line on import. A single paragraph with a soft
  // break is the OOXML idiom every renderer honors identically — title
  // and body always sit on separate visual lines, regardless of importer.
  const children: ParagraphChild[] = [];
  if (b.title) {
    // Title color is INK (#1F1A14) not the tone border — editor renders
    // callout titles in body-color bold, not tinted. Tone color stays on
    // the left border + subtle bg, which is plenty signal.
    children.push(new TextRun({ text: b.title, bold: true, color: '1F1A14' }));
    children.push(new TextRun({ break: 1 }));
  }
  children.push(...inlineToRuns(b.content));
  return [
    new Paragraph({
      style: styleId,
      border: calloutBorder,
      shading: calloutShading,
      indent: calloutIndent,
      spacing: calloutSpacing,
      children,
    }),
  ];
}

function tableForCode(b: CodeBlock): Table {
  // Per-line shaded paragraphs render with hairline row gaps in Google
  // Docs (the cell-shading edge between paragraphs sits one pixel off
  // the next). A 1×1 table wraps all lines under one continuous fill —
  // every renderer paints it as a single block. The cell's paragraphs
  // still carry the variant style so spacing/density picks survive.
  const styleId = codeStyleName(b.variant);
  const dark = (b.variant?.theme ?? 'light') === 'dark';
  const fg = dark ? 'F9FAFB' : '1F1A14';
  const bg = dark ? '111827' : 'F5F2E9';
  const borderColor = dark ? '1F2937' : 'D8D1BF';
  const BORDER = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: borderColor,
  };
  const lines = (b.value ?? '').split('\n');
  const children = lines.map(
    (line) =>
      new Paragraph({
        style: styleId,
        // Word rejects empty paragraphs inside table cells — feed a
        // single space when the source line is blank.
        children: [
          new TextRun({
            text: line.length === 0 ? ' ' : line,
            font: 'Consolas',
            color: fg,
            noProof: true,
          }),
        ],
      }),
  );
  return new Table({
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: bg },
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
            children,
          }),
        ],
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: BORDER,
      bottom: BORDER,
      left: BORDER,
      right: BORDER,
      insideHorizontal: BORDER,
      insideVertical: BORDER,
    },
  });
}

function paragraphForDivider(_b: DividerBlock): Paragraph {
  // Divider — spec §"Divider": 0.75pt warm-stone rule. OOXML border size
  // is in eighths of a point, so 6 = 6/8 pt = 0.75pt. Vertical rhythm
  // matches body-paragraph "before" (240 twips = 12pt) — one paragraph
  // of breathing room above + below the hairline.
  return new Paragraph({
    spacing: { before: 240, after: 0 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: 'D8D1BF' },
    },
    children: [],
  });
}

function tableForTable(b: TableBlock): Table {
  // Paper palette warm-stone border + paper-ink runs. Header row carries
  // `tableHeader: true` (repeats across page splits) and bold runs, but
  // no background shading — the borders alone carry the structure.
  const BORDER = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: 'D8D1BF',
  };
  const rows = b.rows.map((row, rowIdx) => {
    const isHeader = rowIdx === 0;
    return new TableRow({
      tableHeader: isHeader,
      children: row.map((cell) => {
        const runs = inlineToRuns(cell, isHeader ? { bold: true } : {});
        // An empty TableCell is invalid OOXML — Word refuses to open the
        // file. Always emit at least one (possibly empty) Paragraph.
        const children =
          runs.length > 0
            ? [new Paragraph({ children: runs })]
            : [new Paragraph({ children: [] })];
        return new TableCell({ children });
      }),
    });
  });

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: BORDER,
      bottom: BORDER,
      left: BORDER,
      right: BORDER,
      insideHorizontal: BORDER,
      insideVertical: BORDER,
    },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
  });
}

function paragraphForAction(b: ActionBlock): Paragraph {
  // v1 ships actions as inline-styled hyperlinks — filled-button paragraph
  // styles (Action*Primary*, Action*Secondary*) are dropped. Word's "make
  // this look like a button" doesn't survive Pages / Docs; a warm-rust
  // underlined link does.
  return new Paragraph({
    spacing: { before: 160, after: 160 },
    alignment: AlignmentType.LEFT,
    children: [
      new ExternalHyperlink({
        link: b.href ?? '#',
        children: [
          new TextRun({
            text: b.label ?? '',
            style: 'Hyperlink',
            color: 'A23925',
            underline: { type: UnderlineType.SINGLE, color: 'A23925' },
            font: 'Source Serif 4',
          }),
        ],
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Image embedding
// ---------------------------------------------------------------------------

/** Maximum display width for an embedded image, in pixels. Docx's
 *  `transformation.{width,height}` is documented as pixels @ 96 dpi (one px
 *  ≈ 9525 EMU). 720 px ≈ 7.5 inch — narrower than A4's printable column
 *  (8.27in minus margins) so even a 4K source lands inside the text block
 *  on every importer. */
const MAX_IMAGE_WIDTH_PX = 720;

type ImageType = 'png' | 'jpg' | 'gif' | 'bmp';

interface ResolvedImage {
  type: ImageType;
  data: Uint8Array;
  /** Natural pixel width sniffed from the file header, when knowable. */
  naturalW?: number;
  /** Natural pixel height sniffed from the file header, when knowable. */
  naturalH?: number;
}

/** Decode a base64 string to a Uint8Array. Browsers + happy-dom both ship
 *  `atob`; node's runtime exposes `Buffer.from(b64, 'base64')` but we stay
 *  on the browser primitive to keep the bundle Node-free. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Map a MIME / extension hint to the four image kinds docx accepts.
 *  Returns null when the source is something exotic (svg, webp, avif) —
 *  the caller falls back to the placeholder paragraph. */
function classifyImage(hint: string): ImageType | null {
  const h = hint.toLowerCase();
  if (h.includes('png')) return 'png';
  if (h.includes('jpeg') || h.includes('jpg')) return 'jpg';
  if (h.includes('gif')) return 'gif';
  if (h.includes('bmp')) return 'bmp';
  return null;
}

/** Sniff intrinsic pixel dimensions from the file header. Returns
 *  `{ w, h }` for the four formats docx supports, or `undefined` when the
 *  header is too short or the magic bytes don't match. Cheap (no decode).
 *
 *  PNG  : 8-byte signature, then IHDR chunk with width@16 height@20 (BE).
 *  GIF  : "GIF8" + width@6 height@8 (LE).
 *  BMP  : "BM"   + width@18 height@22 (LE, signed).
 *  JPEG : scan SOFn markers — width/height live after the 5-byte segment
 *         header. Most photos have it within the first few hundred bytes. */
function sniffDimensions(
  type: ImageType,
  bytes: Uint8Array,
): { w: number; h: number } | undefined {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (type === 'png' && bytes.length >= 24) {
      // 0..7 PNG sig; 8..11 IHDR length; 12..15 "IHDR"; 16..19 width; 20..23 height (BE).
      return { w: dv.getUint32(16, false), h: dv.getUint32(20, false) };
    }
    if (type === 'gif' && bytes.length >= 10) {
      return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
    }
    if (type === 'bmp' && bytes.length >= 26) {
      return {
        w: dv.getInt32(18, true),
        h: Math.abs(dv.getInt32(22, true)),
      };
    }
    if (type === 'jpg' && bytes.length >= 4) {
      // Walk JPEG segments looking for a Start-Of-Frame marker (0xFFC0–0xFFCF
      // excluding 0xFFC4/0xFFC8/0xFFCC). Each non-SOF segment carries a
      // 2-byte big-endian length we skip past.
      let i = 2; // skip SOI 0xFFD8
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return undefined;
        const marker = bytes[i + 1]!;
        const isSof =
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc;
        if (isSof) {
          return {
            h: dv.getUint16(i + 5, false),
            w: dv.getUint16(i + 7, false),
          };
        }
        const segLen = dv.getUint16(i + 2, false);
        i += 2 + segLen;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Pull a "best guess" extension off a URL's path. Used as a fallback when
 *  the server didn't send a usable Content-Type. */
function extensionHint(url: string): string {
  try {
    const u = new URL(url);
    const m = u.pathname.toLowerCase().match(/\.(png|jpe?g|gif|bmp)$/);
    return m ? m[1]! : '';
  } catch {
    return '';
  }
}

/** Resolve an image src to bytes + format. Returns null on any error
 *  (malformed data URI, fetch failure, CORS, unsupported MIME). The caller
 *  emits the placeholder paragraph in that case. */
export async function resolveImage(src: string): Promise<ResolvedImage | null> {
  if (!src) return null;
  // data: URI — parse the MIME + base64 payload inline. We accept only the
  // base64 variant; percent-encoded text data URIs aren't a realistic image
  // source.
  if (src.startsWith('data:')) {
    const m = src.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
    if (!m) return null;
    const mime = m[1] ?? '';
    const isB64 = !!m[2];
    const payload = m[3] ?? '';
    if (!isB64) return null;
    const type = classifyImage(mime);
    if (!type) return null;
    let data: Uint8Array;
    try {
      data = base64ToBytes(payload);
    } catch {
      return null;
    }
    const dims = sniffDimensions(type, data);
    return { type, data, naturalW: dims?.w, naturalH: dims?.h };
  }
  // http(s) URL — fetch + sniff Content-Type or fall back to extension.
  if (/^https?:\/\//i.test(src)) {
    try {
      const res = await fetch(src);
      if (!res.ok) return null;
      const ct = res.headers.get('Content-Type') ?? '';
      const buf = await res.arrayBuffer();
      const type = classifyImage(ct) ?? classifyImage(extensionHint(src));
      if (!type) return null;
      const data = new Uint8Array(buf);
      const dims = sniffDimensions(type, data);
      return { type, data, naturalW: dims?.w, naturalH: dims?.h };
    } catch {
      return null;
    }
  }
  return null;
}

/** Pick the rendered transformation size in pixels, honoring explicit
 *  block dimensions, falling back to natural dimensions, clamping width to
 *  MAX_IMAGE_WIDTH_PX while preserving aspect ratio. */
function imageTransformation(
  b: ImageBlock,
  resolved: ResolvedImage,
): { width: number; height: number } {
  // Start from explicit block dims, then natural, then a sensible default.
  let w = b.width ?? resolved.naturalW ?? MAX_IMAGE_WIDTH_PX;
  let h =
    b.height ??
    (b.width && resolved.naturalW && resolved.naturalH
      ? Math.round((b.width * resolved.naturalH) / resolved.naturalW)
      : resolved.naturalH ?? Math.round(w * 0.75));
  // Clamp width to the column max, scaling height proportionally.
  if (w > MAX_IMAGE_WIDTH_PX) {
    h = Math.round((h * MAX_IMAGE_WIDTH_PX) / w);
    w = MAX_IMAGE_WIDTH_PX;
  }
  // Guard against pathological zero/negative dims (malformed source).
  if (w <= 0 || !Number.isFinite(w)) w = MAX_IMAGE_WIDTH_PX;
  if (h <= 0 || !Number.isFinite(h)) h = Math.round(w * 0.75);
  return { width: w, height: h };
}

function paragraphForImage(
  b: ImageBlock,
  resolved: ResolvedImage | null,
): Paragraph {
  if (!resolved) {
    // Fallback path — same shape as the v1 placeholder so the surrounding
    // document still reads in order when the src couldn't be fetched.
    return new Paragraph({
      children: [
        new TextRun({ text: `[Image: ${b.alt || b.src}]`, italics: true }),
      ],
    });
  }
  const { width, height } = imageTransformation(b, resolved);
  // ImageRun needs `data` as Buffer | Uint8Array | ArrayBuffer; pass the
  // Uint8Array directly. altText carries the screen-reader description —
  // Word/Pages/Docs all surface this in their accessibility inspector.
  const alt = b.alt || 'image';
  return new Paragraph({
    children: [
      new ImageRun({
        type: resolved.type,
        data: resolved.data,
        transformation: { width, height },
        altText: { name: alt, title: alt, description: alt },
      }),
    ],
  });
}

/** Walk a Block tree collecting every ImageBlock src (in document order)
 *  so the caller can resolve them in one async pass before the document
 *  tree is built. Sections recurse. */
function collectImageBlocks(blocks: Block[], out: ImageBlock[] = []): ImageBlock[] {
  for (const b of blocks) {
    if (b.type === 'image') out.push(b);
    else if (b.type === 'section') collectImageBlocks(b.blocks, out);
  }
  return out;
}

function paragraphsForUnsupportedVariant(name: string): Paragraph[] {
  return [
    new Paragraph({
      shading: { type: ShadingType.SOLID, color: 'FEF2F2', fill: 'FEF2F2' },
      border: {
        left: { style: BorderStyle.SINGLE, size: 24, space: 8, color: 'B91C1C' },
      },
      children: [
        new TextRun({ text: `[Unsupported variant: ${name}]`, color: 'B91C1C', bold: true }),
      ],
    }),
  ];
}

function paragraphsForSection(
  b: SectionBlock,
  images: Map<ImageBlock, ResolvedImage | null>,
  depth = 0,
): TopChild[] {
  const styleId = sectionStyleName(b.variant);
  const out: TopChild[] = [];
  // Section title heading level scales with nesting depth but clamps at
  // H6 (HEADING_LEVELS[5]). Depth 0 -> H2, 1 -> H3, ... 5+ -> H6.
  const titleLevel = HEADING_LEVELS[Math.min(5, 1 + depth)];
  if (b.title) {
    out.push(
      new Paragraph({
        style: styleId,
        heading: titleLevel,
        children: [new TextRun({ text: b.title, bold: true })],
      }),
    );
  }
  for (const child of b.blocks) {
    out.push(...walkBlock(child, images, depth + 1));
  }
  return out;
}

/** Stamp each child paragraph of a nested section with an additional
 *  240-twip left indent, merged with any existing left indent. Tables
 *  pass through unchanged — table indent is a separate OOXML attribute
 *  we don't surface here, and visually the cell margin reads similar. */
function indentTopChild(child: TopChild, extra: number): TopChild {
  if (extra <= 0) return child;
  if (child instanceof Paragraph) {
    // Paragraph's options are private/readonly. The pragmatic path is to
    // mutate via the underlying root XML element's `properties` builder
    // — but docx doesn't expose that cleanly either. Cheapest correct
    // route: wrap the children in a fresh Paragraph copying the public
    // surface, but Paragraph children aren't recoverable. Instead, we
    // pre-compute the indent on the production side via walkBlock(b, depth)
    // which calls helpers that already accept an indent. To keep this
    // helper as a no-op for now, we leave child untouched and let the
    // section-builder pass depth into its children explicitly.
    return child;
  }
  return child;
}

function walkBlock(
  b: Block,
  images: Map<ImageBlock, ResolvedImage | null>,
  depth = 0,
): TopChild[] {
  // Section nesting indent is applied by paragraphsForSection's depth
  // parameter, not by post-processing — see indentTopChild's note. The
  // depth parameter rides through so future call sites can layer on
  // additional context-sensitive transforms without changing the seam.
  //
  // The `images` map is the pre-resolved-bytes lookup the async pre-pass
  // builds in toDocxBlob; threading it through keeps walkBlock + helpers
  // synchronous and lets paragraphForImage stay a plain Paragraph factory.
  void indentTopChild;
  switch (b.type) {
    case 'heading':
      return [paragraphForHeading(b, depth)];
    case 'paragraph':
      return [paragraphForParagraph(b, depth)];
    case 'list':
      return paragraphsForList(b, depth);
    case 'callout':
      return paragraphsForCallout(b);
    case 'action':
      return [paragraphForAction(b)];
    case 'section':
      return paragraphsForSection(b, images, depth);
    case 'divider':
      return [paragraphForDivider(b)];
    case 'code':
      return [tableForCode(b)];
    case 'image':
      return [paragraphForImage(b, images.get(b) ?? null)];
    case 'table':
      return [tableForTable(b)];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Variant ParagraphStyle definitions seeded from the P3 mapping table. The
// generator emits these as `styles.xml` entries; values follow the seed
// columns. Word + Pages + Google Docs all honour these.
// ---------------------------------------------------------------------------

interface SeedStyle {
  id: string;
  name: string;
  font?: string;
  sizeHalfPoints?: number;
  bold?: boolean;
  italics?: boolean;
  color?: string;
  indentLeftTwips?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  uiPriority?: number;
  quickFormat?: boolean;
  unhideWhenUsed?: boolean;
  noProof?: boolean;
}

function seed(s: SeedStyle): IParagraphStyleOptions {
  const runBlock: Record<string, unknown> = {
    // Source Serif 4 is the editor's prose face — embedded into the .docx
    // via `Document({ fonts: [...] })` so Word / Pages / Google Docs all
    // render the same serif on first open, no system-font lottery.
    // (Georgia + Times Roman remain the reader-fallback chain in styles.xml
    // via the bound channel-embed spec; this `font` field is the primary.)
    font: s.font ?? 'Source Serif 4',
    size: s.sizeHalfPoints ?? 22,
    bold: s.bold === true,
    italics: s.italics === true,
    color: s.color ?? '1F1A14',
  };
  if (s.noProof) runBlock.noProof = true;
  const base: Record<string, unknown> = {
    id: s.id,
    name: s.name,
    basedOn: 'Normal',
    next: 'Normal',
    quickFormat: s.quickFormat ?? false,
    run: runBlock,
    paragraph: {
      indent: s.indentLeftTwips !== undefined ? { left: s.indentLeftTwips } : undefined,
      // line=372 (240 × 1.55) — body line-height from the spacing-translation
      // spec. Every variant paragraph inherits the same line-box height so
      // callouts, code, sections, and block-quotes all share the body rhythm.
      spacing: {
        before: s.spaceBefore ?? 0,
        after: s.spaceAfter ?? 0,
        line: 372,
        lineRule: LineRuleType.AUTO,
      },
    },
  };
  if (s.uiPriority !== undefined) base.uiPriority = s.uiPriority;
  if (s.unhideWhenUsed) base.unhideWhenUsed = true;
  // seed assembles via a dynamic record then attests the OOXML shape at
  // the boundary — every field is in IParagraphStyleOptions; the dynamic
  // build is only because uiPriority / unhideWhenUsed / noProof are
  // conditional and TypeScript widens object literals away from the
  // narrow type without the cast.
  return base as unknown as IParagraphStyleOptions;
}

function buildVariantStyles() {
  const styles: ReturnType<typeof seed>[] = [];

  // Callouts (10 rows): tone × emphasis. Runs stay Source-Serif-4-on-paper-ink;
  // the tone color lives on the left border (set inline on each callout
  // paragraph in paragraphsForCallout, not on the style row).
  //
  // Display names + uiPriority slots are mapped from the prescription
  // table so Word's Styles pane sorts them into a stable order; the
  // three primary tones (info/success/warning) carry quickFormat so
  // they surface in the Quick Styles gallery, the rest are
  // unhideWhenUsed (still visible, lower priority).
  type CalloutMeta = {
    displayName: string;
    uiPriority: number;
    quickFormat?: boolean;
    unhideWhenUsed?: boolean;
  };
  const calloutMeta: Record<string, CalloutMeta> = {
    CalloutInfoSubtle:    { displayName: 'Callout · Info',             uiPriority: 30, quickFormat: true },
    CalloutSuccessSubtle: { displayName: 'Callout · Success',          uiPriority: 31, quickFormat: true },
    CalloutWarningSubtle: { displayName: 'Callout · Warning',          uiPriority: 32, quickFormat: true },
    CalloutDangerSubtle:  { displayName: 'Callout · Danger',           uiPriority: 33 },
    CalloutNeutralSubtle: { displayName: 'Callout · Neutral',          uiPriority: 34 },
    CalloutInfoBold:      { displayName: 'Callout · Info (bold)',      uiPriority: 40, unhideWhenUsed: true },
    CalloutSuccessBold:   { displayName: 'Callout · Success (bold)',   uiPriority: 41, unhideWhenUsed: true },
    CalloutWarningBold:   { displayName: 'Callout · Warning (bold)',   uiPriority: 42, unhideWhenUsed: true },
    CalloutDangerBold:    { displayName: 'Callout · Danger (bold)',    uiPriority: 43, unhideWhenUsed: true },
    CalloutNeutralBold:   { displayName: 'Callout · Neutral (bold)',   uiPriority: 44, unhideWhenUsed: true },
  };
  const tones: Tone[] = ['success', 'warning', 'danger', 'info', 'neutral'];
  for (const tone of tones) {
    for (const emphasis of ['subtle', 'bold'] as const) {
      const id = `Callout${pascal(tone)}${pascal(emphasis)}`;
      const meta = calloutMeta[id] ?? { displayName: id, uiPriority: 49 };
      styles.push(
        seed({
          id,
          name: meta.displayName,
          uiPriority: meta.uiPriority,
          quickFormat: meta.quickFormat,
          unhideWhenUsed: meta.unhideWhenUsed,
          font: 'Source Serif 4',
          color: '1F1A14',
          bold: emphasis === 'bold',
          indentLeftTwips: 360,
          spaceBefore: 200,
          spaceAfter: 200,
        }),
      );
    }
  }

  // Actions: no paragraph style — emitted as inline-styled hyperlinks in
  // paragraphForAction. (Pre-v1 the 4 Action* styles tried to render
  // filled-buttons via paragraph shading; that look does not survive
  // Pages / Google Docs, so we ship inline warm-rust links instead.)

  // Sections (3 rows): compact / comfortable / spacious
  type SectionMeta = {
    displayName: string;
    uiPriority: number;
    quickFormat?: boolean;
  };
  const sectionMeta: Record<string, SectionMeta> = {
    SectionComfortable: { displayName: 'Section · Comfortable', uiPriority: 50, quickFormat: true },
    SectionCompact:     { displayName: 'Section · Compact',     uiPriority: 51 },
    SectionSpacious:    { displayName: 'Section · Spacious',    uiPriority: 52 },
  };
  const sectionSpacing: Record<string, number> = {
    Compact: 80,
    Comfortable: 160,
    Spacious: 240,
  };
  for (const density of ['Compact', 'Comfortable', 'Spacious'] as const) {
    const id = `Section${density}`;
    const meta = sectionMeta[id]!;
    styles.push(
      seed({
        id,
        name: meta.displayName,
        uiPriority: meta.uiPriority,
        quickFormat: meta.quickFormat,
        spaceBefore: sectionSpacing[density],
        spaceAfter: sectionSpacing[density],
      }),
    );
  }

  // Code (4 rows): light/dark × normal/compact. noProof = true so the
  // spell-checker doesn't wave red lines through every identifier.
  type CodeMeta = {
    displayName: string;
    uiPriority: number;
    quickFormat?: boolean;
  };
  const codeMeta: Record<string, CodeMeta> = {
    CodeLightNormal:  { displayName: 'Code · Light',           uiPriority: 60, quickFormat: true },
    CodeLightCompact: { displayName: 'Code · Light (compact)', uiPriority: 61 },
    CodeDarkNormal:   { displayName: 'Code · Dark',            uiPriority: 62 },
    CodeDarkCompact:  { displayName: 'Code · Dark (compact)',  uiPriority: 63 },
  };
  for (const theme of ['Light', 'Dark'] as const) {
    for (const density of ['Normal', 'Compact'] as const) {
      const id = `Code${theme}${density}`;
      const meta = codeMeta[id]!;
      styles.push(
        seed({
          id,
          name: meta.displayName,
          uiPriority: meta.uiPriority,
          quickFormat: meta.quickFormat,
          noProof: true,
          font: 'Consolas',
          sizeHalfPoints: density === 'Compact' ? 18 : 20,
          color: theme === 'Dark' ? 'F9FAFB' : '1F1A14',
          indentLeftTwips: 240,
          spaceBefore: density === 'Compact' ? 60 : 120,
          spaceAfter: density === 'Compact' ? 60 : 120,
        }),
      );
    }
  }

  // BlockQuote
  styles.push(
    seed({
      id: 'BlockQuote',
      name: 'Block Quote',
      uiPriority: 29,
      quickFormat: true,
      italics: true,
      color: '374151',
      indentLeftTwips: 480,
      spaceBefore: 160,
      spaceAfter: 160,
    }),
  );

  return styles;
}

// ---------------------------------------------------------------------------
// Numbering — list references used in paragraphsForList.
// ---------------------------------------------------------------------------

const numberingConfig = {
  config: [
    {
      reference: 'paper-bullet',
      levels: [
        {
          level: 0,
          format: 'bullet' as const,
          // Unicode bullet U+2022 in the body font. Symbol-font PUA
          // (U+F0B7) is the historical Word convention but it doesn't
          // render in browsers that lack Symbol — docx-preview shows
          // a missing-glyph box. The plain bullet character carries
          // identically through Word, Pages, Docs, and docx-preview.
          text: '•',
          alignment: AlignmentType.LEFT,
          style: {
            run: { font: { name: 'Source Serif 4' } },
            paragraph: {
              indent: { left: 360, hanging: 200 },
              // List-item DOCX override from spec §"List spacing":
              // before = 60 twips (3pt — Word's tighter default for paragraphs
              // inside a list). Editor + EPUB + HTML use 4pt (60 twips ≈ 3pt
              // is the closest natural Word match), pdfmake uses 4pt verbatim.
              // line = 372 inherits body line-height (1.55).
              spacing: { before: 60, after: 0, line: 372, lineRule: LineRuleType.AUTO },
            },
          },
        },
        {
          level: 1,
          format: 'bullet' as const,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: {
            run: { font: { name: 'Source Serif 4' } },
            paragraph: {
              indent: { left: 720, hanging: 200 },
              spacing: { before: 60, after: 0, line: 372, lineRule: LineRuleType.AUTO },
            },
          },
        },
        {
          level: 2,
          format: 'bullet' as const,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: {
            run: { font: { name: 'Source Serif 4' } },
            paragraph: {
              indent: { left: 1080, hanging: 200 },
              spacing: { before: 60, after: 0, line: 372, lineRule: LineRuleType.AUTO },
            },
          },
        },
      ],
    },
    {
      reference: 'paper-ordered',
      levels: [
        {
          level: 0,
          format: 'decimal' as const,
          text: '%1.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 200 } } },
        },
        {
          level: 1,
          format: 'lowerLetter' as const,
          text: '%2.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 200 } } },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** DOCX export options. Pass `docUuid` to keep the same identifier across
 *  re-exports of the same source document; otherwise a fresh UUID is
 *  generated per call (the persistence story for `docUuid` is a later
 *  task — this signature is the seam).
 *
 *  `language` sets the document-default authoring language (BCP-47, e.g.
 *  "en-US", "nb-NO"). Word + Pages + Google Docs all key their
 *  spell-checker off this. Defaults to "en-US" when omitted. */
export interface ToDocxOptions {
  docUuid?: string;
  language?: string;
}

export async function toDocxBlob(
  doc: PortableDoc,
  options?: ToDocxOptions,
): Promise<Blob> {
  const docUuid = options?.docUuid ?? generateDocUuid();
  const language = options?.language ?? 'en-US';
  const children: TopChild[] = [];

  // Kick off the font fetch in parallel with the image-resolve pre-pass —
  // both feed into the single `new Document({...})` call below. The .docx
  // ships with four `word/fonts/SourceSerif4-*.ttf` parts and a matching
  // `word/fontTable.xml` so the embedded faces survive across renderers.
  // On fetch failure (happy-dom tests, offline build sandboxes) the array
  // is empty and the .docx falls back to system Source Serif 4 / Georgia.
  const embeddedFonts = await loadEmbeddedFonts();

  // Pre-resolve every image block in one async pass so walkBlock can stay
  // synchronous. Each src maps to a ResolvedImage (bytes + format + sniffed
  // natural dims) or null when the fetch/decode failed — the null case is
  // handled inside paragraphForImage as the fallback placeholder.
  const imageBlocks = collectImageBlocks(doc.blocks);
  const resolved = await Promise.all(imageBlocks.map((b) => resolveImage(b.src)));
  const images = new Map<ImageBlock, ResolvedImage | null>();
  imageBlocks.forEach((b, i) => images.set(b, resolved[i] ?? null));

  // Don't emit a separate TITLE paragraph — the first heading block in the
  // doc IS the title, by convention. doc.title stays in Document properties
  // metadata for the file's Title field (set below at `title: doc.title`),
  // but rendering it as a second visual heading duplicates the H1 the user
  // already wrote (visible side-by-side in the visual-check pipeline:
  // welcome.json shows "Welcome to Atlas" twice in the exported .docx).
  for (const b of doc.blocks) {
    children.push(...walkBlock(b, images));
  }

  const document = new Document({
    creator: 'Papir',
    title: doc.title ?? 'Untitled',
    // NOTE: Each app has its own "Print background colors" toggle that defaults
    // OFF. Cream paper prints only after the user enables it in Word/Pages/etc
    // preferences. No OOXML setting forces this; a header-shape hack works but
    // costs cross-app fidelity. Document the limitation; don't fight it.
    background: { color: 'FBFAF6' },
    // Source Serif 4 — four weights, all embedded. dolanmiu/docx writes both
    // `word/fonts/SourceSerif4-*.ttf` (binary parts inside the .docx ZIP) and
    // `word/fontTable.xml` (with <w:embedRegular> + <w:embedItalic> +
    // <w:embedBold> + <w:embedBoldItalic> r:id refs) when this option is
    // present. The empty-array path is the test/offline fallback — styles
    // still name "Source Serif 4" so a reader with the face installed
    // locally still picks it up.
    // FontOptions.data is typed as Node Buffer; the runtime accepts any
    // Uint8Array (the library's JSZip pass calls .slice/.length only). We
    // cast structurally — Buffer is a Uint8Array subclass, so the actual
    // shape is compatible even when the @types/node Buffer isn't in scope.
    ...(embeddedFonts.length > 0
      ? { fonts: embeddedFonts as unknown as readonly { name: string; data: Buffer }[] }
      : {}),
    styles: {
      default: {
        document: {
          // Document-default language drives every renderer's spell-check
          // pass. Without it, Word falls back to OS locale and Google Docs
          // assumes en-US — both produce inconsistent UX across users.
          run: {
            // Embedded via Document({ fonts: [...] }) — see
            // loadEmbeddedFonts(). styles.xml refers to the family by name
            // ("Source Serif 4"); the four `word/fonts/*.ttf` parts ride
            // along in the .docx ZIP so opening in Word / Pages / Google
            // Docs uses the embedded face directly.
            font: 'Source Serif 4',
            size: 22, // 11pt — half-points per OOXML
            color: '1F1A14',
            language: { value: language },
          },
          paragraph: {
            // Body paragraph rhythm locked by the spacing-translation
            // spec (~/docs/paperflow/specs/2026-05-20-spacing-translation.html):
            // before = 240 twips (12pt), after = 0, line = 372 twips
            // (= 240 × 1.55 — absolute line-box height in twentieths of a pt).
            // Same numbers flow into paper.css (12pt / 1.55), toEpub.ts
            // (margin-top:12pt; line-height:1.55), toHtml.ts (inline CSS
            // matching toEpub), and toPdf.ts (margin:[0,12,0,0]; lineHeight:1.55).
            spacing: { before: 240, after: 0, line: 372, lineRule: LineRuleType.AUTO },
          },
        },
        // Heading sizes + spacings come from the spec table §"Heading
        // spacing". OOXML run.size is half-points (28pt → 56). Top + bottom
        // margins are spec-locked twips — the same numbers travel into
        // paper.css, toEpub, toHtml, and toPdf:
        //   H1 28pt size=56  before 480 / after 120  (24pt / 6pt)
        //   H2 22pt size=44  before 360 / after 80   (18pt / 4pt)
        //   H3 18pt size=36  before 240 / after 40   (12pt / 2pt)
        // H4..H6 step down from H3 in the same rhythm so deep outlines
        // stay readable without overpowering body text. The body line-height
        // (1.55 → line=372) carries through every heading too.
        heading1: {
          run: { font: 'Source Serif 4', size: 56, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 480, after: 120, line: 372, lineRule: LineRuleType.AUTO },
          },
        },
        heading2: {
          run: { font: 'Source Serif 4', size: 44, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 360, after: 80, line: 372, lineRule: LineRuleType.AUTO },
          },
        },
        heading3: {
          run: { font: 'Source Serif 4', size: 36, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 240, after: 40, line: 372, lineRule: LineRuleType.AUTO },
          },
        },
        heading4: {
          run: { font: 'Source Serif 4', size: 26, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 200, after: 40, line: 372, lineRule: LineRuleType.AUTO },
          },
        },
        heading5: {
          run: { font: 'Source Serif 4', size: 24, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 160, after: 40, line: 372, lineRule: LineRuleType.AUTO },
          },
        },
        heading6: {
          run: { font: 'Source Serif 4', size: 22, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 160, after: 40, line: 372, lineRule: LineRuleType.AUTO },
          },
        },
        title: {
          run: { font: 'Source Serif 4', size: 56, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 0, after: 120, line: 372, lineRule: LineRuleType.AUTO },
          },
        },
      },
      // Hyperlink character style — warm-rust ink, single underline.
      // Real Word renderers honour the style binding; Pages / Google Docs
      // strip it but the inline TextRun's direct-formatting (set in
      // inlineToRuns and paragraphForAction) carries the same look.
      // semiHidden + uiPriority:99 keeps it out of the Quick Styles
      // gallery (Word convention for character styles).
      characterStyles: [
        {
          id: 'Hyperlink',
          name: 'Hyperlink',
          basedOn: 'DefaultParagraphFont',
          semiHidden: true,
          uiPriority: 99,
          run: {
            color: 'A23925',
            underline: { type: UnderlineType.SINGLE, color: 'A23925' },
          },
        },
      ],
      paragraphStyles: buildVariantStyles(),
    },
    numbering: numberingConfig,
    sections: [
      {
        properties: {
          page: {
            // A4 — 11906×16838 twips. Matches the editor's paper canvas
            // dimensions (canonical European page).
            size: {
              width: 11906,
              height: 16838,
              orientation: PageOrientation.PORTRAIT,
            },
            // Twips: 1440 = 1in vertical, 1200 = 0.83in horizontal.
            // Header/footer reserved zones at 720 twips (0.5in).
            margin: {
              top: 1440,
              right: 1200,
              bottom: 1440,
              left: 1200,
              header: 720,
              footer: 720,
              gutter: 0,
            },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(document);
  return await embedEnvelope(blob, doc, docUuid);
}

// ---------------------------------------------------------------------------
// Round-trip envelope (Goal B, P1) — see specs:
//   2026-05-19-envelope-spec.html (shape)
//   2026-05-19-embed-locations.html (customXml/item1.xml + rels + Content_Types)
//
// The `docx` library doesn't expose customXml part injection, so we
// post-process the OPC ZIP directly: write the envelope JSON wrapped in a
// CDATA section under `customXml/item1.xml`, register the part in
// `[Content_Types].xml`, and link it from `word/_rels/document.xml.rels`.
// The .docx still opens in Word / Pages / Google Docs as a normal document;
// the envelope rides along as an invisible side-car part.
// ---------------------------------------------------------------------------

const ENVELOPE_PART = 'customXml/item1.xml';
const ENVELOPE_NS = 'https://portable-doc.dev/envelope/v1';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const CUSTOM_PROPS_PART = 'docProps/custom.xml';
const CUSTOM_PROPS_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties';
const CUSTOM_PROPS_VT_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes';
const CUSTOM_PROPS_CT =
  'application/vnd.openxmlformats-officedocument.custom-properties+xml';
const CUSTOM_PROPS_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties';

// 240 chars per chunk keeps each lpwstr well under Word's per-property
// 255-char practical ceiling (the spec allows more but Google's importer
// truncates above ~260 in lpwstr properties).
const CUSTOM_PROP_CHUNK_SIZE = 240;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Base64-encode a UTF-8 string in 32K slices so very large payloads
 *  don't overflow `String.fromCharCode(...big-array)`'s argument list. */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/** First 32 hex chars (= 16 bytes = 128 bits) of SHA-256 of the input.
 *  Plenty for tamper-detection on a multi-KB JSON payload. */
async function sha256Prefix(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 16; i++) {
    hex += arr[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

async function embedEnvelope(
  blob: Blob,
  doc: PortableDoc,
  docUuid: string,
): Promise<Blob> {
  const buffer = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  // 1. Inject customXml/item1.xml — JSON inside CDATA so the OPC parser
  //    treats it as opaque text and we don't have to XML-escape every
  //    quote in the payload. This is the *primary* embed path: smaller,
  //    survives Word/Pages round-trip unchanged.
  //
  //    Any literal `]]>` inside the JSON payload would terminate the
  //    CDATA section early and corrupt the part — most commonly when a
  //    `code` block's `value` contains raw XML/CDATA fragments. Split
  //    each occurrence across two CDATA sections via the standard XML
  //    idiom: `]]>` → `]]]]><![CDATA[>`. After both CDATA wrappers are
  //    unwrapped, the parser sees the original `]]>` byte sequence.
  const envelope = buildEnvelope(doc, docUuid);
  const envelopeJson = JSON.stringify(envelope, null, 2);
  const safeEnvelopeJson = envelopeJson.replace(/]]>/g, ']]]]><![CDATA[>');
  const customXmlBody = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<papir-envelope xmlns="${ENVELOPE_NS}">
  <payload><![CDATA[
${safeEnvelopeJson}
  ]]></payload>
</papir-envelope>`;
  zip.file(ENVELOPE_PART, customXmlBody);

  // 2. Add an Override entry to [Content_Types].xml so consumers know the
  //    new part is application/xml. Word silently drops parts it can't
  //    type-resolve.
  const ctFile = zip.file('[Content_Types].xml');
  if (ctFile) {
    let ct = await ctFile.async('string');
    if (!ct.includes(`PartName="/${ENVELOPE_PART}"`)) {
      ct = ct.replace(
        '</Types>',
        `<Override PartName="/${ENVELOPE_PART}" ContentType="application/xml"/></Types>`,
      );
    }
    if (!ct.includes(`PartName="/${CUSTOM_PROPS_PART}"`)) {
      ct = ct.replace(
        '</Types>',
        `<Override PartName="/${CUSTOM_PROPS_PART}" ContentType="${CUSTOM_PROPS_CT}"/></Types>`,
      );
    }
    zip.file('[Content_Types].xml', ct);
  }

  // 3. Add a relationship in word/_rels/document.xml.rels — `customXml`
  //    type, target is the new part. The rId is the next available slot
  //    in the existing rels file.
  const relsPath = 'word/_rels/document.xml.rels';
  const relsFile = zip.file(relsPath);
  if (relsFile) {
    const rels = await relsFile.async('string');
    const ids = [...rels.matchAll(/Id="rId(\d+)"/g)].map((m) =>
      parseInt(m[1] ?? '0', 10),
    );
    const nextId = (ids.length === 0 ? 0 : Math.max(...ids)) + 1;
    const newRel = `<Relationship Id="rId${nextId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../${ENVELOPE_PART}"/>`;
    const relsPatched = rels.replace(
      '</Relationships>',
      `${newRel}</Relationships>`,
    );
    zip.file(relsPath, relsPatched);
  }

  // 4. Fallback embed: docProps/custom.xml properties. Google Docs strips
  //    customXml/item1.xml on upload but preserves docProps/custom.xml
  //    intact, so we duplicate the payload here as base64-encoded chunks.
  //    SHA-256 prefix is stored so the importer can verify integrity.
  const bytes = new TextEncoder().encode(envelopeJson);
  const base64 = bytesToBase64(bytes);
  const chunks: string[] = [];
  for (let i = 0; i < base64.length; i += CUSTOM_PROP_CHUNK_SIZE) {
    chunks.push(base64.slice(i, i + CUSTOM_PROP_CHUNK_SIZE));
  }
  const sha = await sha256Prefix(base64);
  // pid starts at 2 — pid=1 is reserved per the OOXML spec.
  let pid = 2;
  const props: string[] = [];
  props.push(
    `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${pid++}" name="papir-ast-count"><vt:i4>${chunks.length}</vt:i4></property>`,
  );
  props.push(
    `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${pid++}" name="papir-ast-sha256"><vt:lpwstr>${escapeXml(sha)}</vt:lpwstr></property>`,
  );
  for (let i = 0; i < chunks.length; i++) {
    props.push(
      `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${pid++}" name="papir-ast-${i + 1}"><vt:lpwstr>${escapeXml(chunks[i]!)}</vt:lpwstr></property>`,
    );
  }
  const customPropsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="${CUSTOM_PROPS_NS}" xmlns:vt="${CUSTOM_PROPS_VT_NS}">${props.join('')}</Properties>`;
  zip.file(CUSTOM_PROPS_PART, customPropsXml);

  // 5. Register the custom-properties relationship in the *package* root
  //    `_rels/.rels` (not the word/ rels — custom-properties is a
  //    package-level part). Word's standard exporter puts core/app
  //    properties here too.
  const packageRelsPath = '_rels/.rels';
  const packageRelsFile = zip.file(packageRelsPath);
  if (packageRelsFile) {
    let pkgRels = await packageRelsFile.async('string');
    if (!pkgRels.includes(`Target="${CUSTOM_PROPS_PART}"`)) {
      const existingIds = [...pkgRels.matchAll(/Id="rId(\d+)"/g)].map((m) =>
        parseInt(m[1] ?? '0', 10),
      );
      const nextId =
        (existingIds.length === 0 ? 0 : Math.max(...existingIds)) + 1;
      const newRel = `<Relationship Id="rId${nextId}" Type="${CUSTOM_PROPS_REL_TYPE}" Target="${CUSTOM_PROPS_PART}"/>`;
      pkgRels = pkgRels.replace(
        '</Relationships>',
        `${newRel}</Relationships>`,
      );
      zip.file(packageRelsPath, pkgRels);
    }
  }

  return await zip.generateAsync({
    type: 'blob',
    mimeType: DOCX_MIME,
  });
}
