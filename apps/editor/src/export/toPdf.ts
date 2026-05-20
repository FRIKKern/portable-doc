/**
 * Papir → PDF serializer.
 *
 * Library choice: **pdfmake** (v0.3.x, bundled in the browser build with the
 * vfs_fonts Roboto subset). Rationale:
 *   - PortableDoc is richly structured (headings, callouts, lists, code
 *     blocks, tables, dividers, sections, hyperlinks). pdfmake's declarative
 *     `content: [...]` tree mirrors that AST 1:1 — every block becomes a
 *     `{ stack, columns, table, text, ... }` node. Hand-rolling line-wrap
 *     and pagination in pdf-lib for callouts + tables + code blocks would
 *     run 600+ LOC of layout math for output a declarative pass produces
 *     correctly out of the box.
 *   - Font embedding for reMarkable (which has no system fonts) comes free:
 *     pdfmake ships Roboto subset in `pdfmake/build/vfs_fonts.js` and embeds
 *     it into every output PDF. The artifact renders identically on
 *     reMarkable, Adobe Reader, Preview, and browser PDF viewers.
 *   - Hyperlinks emit as real PDF link annotations (`{ text, link }`), not
 *     blue underline cosmetics — they're clickable in any PDF reader.
 *   - The single optimized output is A4 portrait at 22mm margins, cream
 *     background, Roboto body / Courier code, warm-rust links, hand-picked
 *     pastel callout tones from the Tailwind-50 palette (matching toDocx
 *     for cross-channel visual coherence).
 *
 * v1 limitations (mirrors toEpub.ts):
 *   - Round-trip envelope: SKIP. PDF custom-XMP would be the analog to
 *     docx customXml, but reMarkable strips PDF custom metadata on
 *     transfer. One path at a time — DOCX remains the round-trip channel.
 *   - Image embedding: emits a `[Image: alt]` placeholder paragraph, same
 *     disposition as toDocx + toEpub. Binary embed is future.
 *
 * Why Roboto over Georgia: the spec prefers Georgia (crisp serif on e-ink),
 * but pdfmake's default vfs ships Roboto as the only universally available
 * font. Shipping a Georgia TTF would add ~250KB and a maintenance burden
 * (license, subset pipeline). Roboto reads well on reMarkable's 226dpi
 * e-ink display — calm, even hinting, no ink-bleed pixels at 11pt. The
 * heading scale (22/18/14/12/11/10pt) and 1.45 line height come straight
 * from the spec; only the family swaps.
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

// pdfmake's browser entry — uses `self`/`window` and ships its own Roboto vfs.
// `vfs_fonts` is a separate file that we wire into pdfMake.vfs once at module
// load. Both are CommonJS — `import x from 'foo'` picks up the default.
//
// Vitest runs in happy-dom which provides `window` + `self`, so the browser
// build loads cleanly in tests too.
import pdfMake from 'pdfmake/build/pdfmake.js';
import pdfFonts from 'pdfmake/build/vfs_fonts.js';

// The vfs_fonts module shape changed across pdfmake versions. In 0.3.x it
// exports the vfs map directly; older builds nested it under `pdfMake.vfs`.
// Handle both so we don't ship a foot-gun on accidental version bumps.
const vfsMap: Record<string, string> =
  (pdfFonts as { pdfMake?: { vfs?: Record<string, string> } }).pdfMake?.vfs ??
  (pdfFonts as unknown as Record<string, string>);
(pdfMake as unknown as { vfs: Record<string, string> }).vfs = vfsMap;

// ---------------------------------------------------------------------------
// Palette — pinned to the Tailwind-50 tones used in toDocx so the three
// channels (Word, EPUB, PDF) share the exact same callout colors. Hex pairs
// are { background, accent } per tone; the accent paints the left border
// stripe and the title text.
// ---------------------------------------------------------------------------

const TONE_PALETTE: Record<
  CalloutBlock['tone'],
  { bg: string; accent: string }
> = {
  info:    { bg: '#EFF6FF', accent: '#1D4ED8' },
  success: { bg: '#ECFDF5', accent: '#047857' },
  warning: { bg: '#FFFBEB', accent: '#92400E' },
  danger:  { bg: '#FEF2F2', accent: '#B91C1C' },
  neutral: { bg: '#F3F4F6', accent: '#374151' },
};

const PAGE_BG = '#FBFAF6';         // warm cream — matches paper.css --paper-bg
const RULE_HAIRLINE = '#D8D1BF';   // 0.5pt divider color, matches paper.css
const INK = '#1F1A14';             // body ink
const INK_FAINT = '#6B7280';       // muted captions / placeholder text
const LINK = '#A23925';            // warm rust — matches paper-accent-warm-rust
const CODE_BG = '#F5F2E9';         // warm cream-tinted, NOT cool gray

// Body type scale — 11pt body anchors the rest at the 1.0 step. Heading sizes
// step DOWN per H-level; spacing-before > spacing-after to bind a heading to
// the section it introduces (vertical rhythm rule from typography theory).
const FONT_BODY = 11;
const HEADING_SIZES: Record<1 | 2 | 3 | 4 | 5 | 6, number> = {
  1: 22,
  2: 18,
  3: 14,
  4: 12,
  5: 11,
  6: 10,
};

// ---------------------------------------------------------------------------
// pdfmake content types. We don't bind to the package's published types
// (they ship as JSDoc — no shipped .d.ts in 0.3.x), so we lean on a loose
// recursive shape that pdfmake accepts at runtime. `unknown[]` for `content`
// lets pdfmake's own validator do the heavy lifting; we never inspect the
// tree we produce, only emit it.
// ---------------------------------------------------------------------------

type PdfNode =
  | string
  | {
      text?: string | PdfNode[];
      stack?: PdfNode[];
      columns?: PdfNode[];
      table?: { body: PdfNode[][]; widths?: (string | number)[]; headerRows?: number };
      ul?: PdfNode[];
      ol?: PdfNode[];
      image?: string;
      bold?: boolean;
      italics?: boolean;
      decoration?: 'underline' | 'lineThrough' | 'overline';
      color?: string;
      background?: string;
      fillColor?: string;
      link?: string;
      style?: string | string[];
      fontSize?: number;
      font?: string;
      lineHeight?: number;
      margin?: [number, number, number, number] | number;
      alignment?: 'left' | 'center' | 'right' | 'justify';
      preserveLeadingSpaces?: boolean;
      noWrap?: boolean;
      layout?: string | Record<string, unknown>;
      canvas?: Array<Record<string, unknown>>;
    };

// ---------------------------------------------------------------------------
// Inline AST → pdfmake `text:[]` runs.
//
// pdfmake collapses a `text: [...]` array of strings + nested objects into a
// single laid-out paragraph, with each child carrying its own marks (bold,
// italic, link, code). Returning an array keeps mark composition local — a
// link inside bold inside paragraph reads cleanly without manual nesting.
// ---------------------------------------------------------------------------

function inlineToRuns(nodes: InlineNode[] | undefined): PdfNode[] {
  if (!nodes || nodes.length === 0) return [];
  const runs: PdfNode[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        runs.push({ text: n.value });
        break;
      case 'strong':
        runs.push(...inlineToRuns(n.children).map(markBold));
        break;
      case 'em':
        runs.push(...inlineToRuns(n.children).map(markItalic));
        break;
      case 'code':
        // Inline code — Roboto with a faint background tint. pdfmake renders
        // `background:` as a highlight stripe sized to the run's line height.
        // We don't ship a separate mono face (vfs_fonts bundles Roboto only;
        // pulling in a Courier TTF would balloon the bundle); the cream
        // highlight is enough to set code runs apart from prose.
        runs.push({
          text: n.value,
          fontSize: FONT_BODY - 1,
          background: CODE_BG,
        });
        break;
      case 'link': {
        const inner = inlineToRuns(n.children);
        for (const r of inner) {
          runs.push(markLink(r, n.href));
        }
        break;
      }
    }
  }
  return runs;
}

function markBold(n: PdfNode): PdfNode {
  if (typeof n === 'string') return { text: n, bold: true };
  return { ...n, bold: true };
}
function markItalic(n: PdfNode): PdfNode {
  if (typeof n === 'string') return { text: n, italics: true };
  return { ...n, italics: true };
}
function markLink(n: PdfNode, href: string): PdfNode {
  if (typeof n === 'string') {
    return { text: n, link: href, color: LINK, decoration: 'underline' };
  }
  return {
    ...n,
    link: href,
    color: LINK,
    decoration: 'underline',
  };
}

// ---------------------------------------------------------------------------
// Block AST → pdfmake nodes.
//
// Every emitter returns a single `PdfNode` (or array of nodes for sections).
// pdfmake's renderer handles line-wrap + pagination + page-break across the
// whole tree, so emitters never have to reason about column width or page
// position — they describe shape, the renderer lays it out.
// ---------------------------------------------------------------------------

function blockToNodes(b: Block, depth = 0): PdfNode[] {
  switch (b.type) {
    case 'heading':
      return [headingNode(b, depth)];
    case 'paragraph':
      return [paragraphNode(b)];
    case 'list':
      return [listNode(b)];
    case 'callout':
      return [calloutNode(b)];
    case 'action':
      return [actionNode(b)];
    case 'section':
      return sectionNodes(b, depth);
    case 'divider':
      return [dividerNode(b)];
    case 'code':
      return [codeNode(b)];
    case 'image':
      return [imageNode(b)];
    case 'table':
      return [tableNode(b)];
    default:
      return [];
  }
}

function headingNode(b: HeadingBlock, depth: number): PdfNode {
  // depth-shifted levels mirror the EPUB/Word strategy: a top-level H2 inside
  // a section reads as an H3, capped at H6. Keeps the visual hierarchy
  // honest when authors nest sections deeply.
  const lvl = Math.min(6, Math.max(1, (b.level ?? 1) + Math.min(depth, 2))) as
    | 1 | 2 | 3 | 4 | 5 | 6;
  return {
    text: b.text ?? '',
    fontSize: HEADING_SIZES[lvl],
    bold: true,
    color: INK,
    margin: [0, lvl === 1 ? 12 : 14, 0, 4],
    lineHeight: 1.25,
  };
}

function paragraphNode(b: ParagraphBlock): PdfNode {
  return {
    text: inlineToRuns(b.content),
    fontSize: FONT_BODY,
    color: INK,
    lineHeight: 1.45,
    alignment: 'left',
    margin: [0, 0, 0, 8],
  };
}

function listNode(b: ListBlock): PdfNode {
  const items = b.items.map((item) => ({
    text: inlineToRuns(item),
    fontSize: FONT_BODY,
    color: INK,
    lineHeight: 1.4,
  }));
  return b.ordered === true
    ? { ol: items, margin: [0, 0, 0, 8] }
    : { ul: items, margin: [0, 0, 0, 8] };
}

function calloutNode(b: CalloutBlock): PdfNode {
  const tone = TONE_PALETTE[b.tone] ?? TONE_PALETTE.neutral;
  const emphasis = b.variant?.emphasis ?? 'subtle';
  // "bold" emphasis lands as a thicker accent stripe via a 6pt left padding
  // and a 1pt border (pdfmake tables are the canonical way to paint a
  // tinted block with a colored left edge). Subtle is the same shape with
  // a 3pt stripe.
  const stripeWidth = emphasis === 'bold' ? 4 : 2;
  const titleRun: PdfNode[] = b.title
    ? [{ text: b.title, bold: true, color: tone.accent, fontSize: FONT_BODY, margin: [0, 0, 0, 4] }]
    : [];
  const body: PdfNode = {
    text: inlineToRuns(b.content),
    fontSize: FONT_BODY,
    color: INK,
    lineHeight: 1.45,
  };
  // Single-row table with one cell for the colored stripe and one for the
  // content. `fillColor` paints the background; `border` is suppressed
  // except on the left of the first cell where we want the stripe.
  return {
    table: {
      widths: [stripeWidth, '*'],
      body: [
        [
          { text: '', fillColor: tone.accent, border: [false, false, false, false] } as PdfNode,
          {
            stack: [...titleRun, body],
            fillColor: tone.bg,
            margin: [10, 8, 10, 8],
          } as PdfNode,
        ],
      ],
    },
    layout: 'noBorders',
    margin: [0, 6, 0, 10],
  };
}

function actionNode(b: ActionBlock): PdfNode {
  // Actions render as a single warm-rust hyperlink — pdfmake doesn't draw
  // button chrome (no native equivalent), so we lean on the inline link
  // affordance + a chevron glyph. Stays calm on e-ink, clickable in any
  // PDF viewer.
  const priority = b.priority ?? 'primary';
  return {
    text: [
      {
        text: `${b.label ?? ''}  →`,
        link: b.href ?? '#',
        color: LINK,
        decoration: 'underline',
        bold: priority === 'primary',
      },
    ],
    fontSize: FONT_BODY,
    margin: [0, 4, 0, 10],
  };
}

function sectionNodes(b: SectionBlock, depth: number): PdfNode[] {
  // Sections don't draw any chrome themselves — they're a structural wrapper.
  // Title becomes a depth-shifted heading; children recurse. Returning a flat
  // node list (instead of wrapping in `stack`) lets pdfmake paginate inside
  // a section naturally.
  const out: PdfNode[] = [];
  if (b.title) {
    out.push(headingNode(
      { id: 'sec-title', type: 'heading', level: Math.min(6, 2 + depth) as 1 | 2 | 3 | 4 | 5 | 6, text: b.title },
      depth,
    ));
  }
  for (const c of b.blocks) out.push(...blockToNodes(c, depth + 1));
  return out;
}

function dividerNode(_b: DividerBlock): PdfNode {
  // A horizontal rule via the canvas primitive — pdfmake doesn't have a
  // dedicated `hr` shape but a 0.5pt line drawn at full page width is the
  // canonical workaround.
  return {
    canvas: [
      {
        type: 'line',
        x1: 0,
        y1: 4,
        x2: 515, // ~A4 width − 2 × 22mm margins, in PDF points
        y2: 4,
        lineWidth: 0.5,
        lineColor: RULE_HAIRLINE,
      },
    ],
    margin: [0, 6, 0, 14],
  };
}

function codeNode(b: CodeBlock): PdfNode {
  // Code blocks: Roboto on a warm cream background with a hairline border,
  // tighter line height than prose. preserveLeadingSpaces keeps indentation.
  // See the inline-code comment in `inlineToRuns` for the font rationale —
  // shipping a separate mono face would bloat the bundle for a single
  // visual signal that the fillColor + border already deliver.
  return {
    table: {
      widths: ['*'],
      body: [[
        {
          text: b.value ?? '',
          fontSize: FONT_BODY - 1,
          color: INK,
          lineHeight: 1.25,
          fillColor: CODE_BG,
          margin: [10, 8, 10, 8],
          preserveLeadingSpaces: true,
        } as PdfNode,
      ]],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => RULE_HAIRLINE,
      vLineColor: () => RULE_HAIRLINE,
    },
    margin: [0, 4, 0, 12],
  };
}

function imageNode(b: ImageBlock): PdfNode {
  // v1: placeholder — matches toDocx + toEpub. Binary embed (data: URI or
  // network fetch + base64) is a future story per the multi-format export
  // Goal's image disposition.
  const alt = b.alt || b.src || '';
  return {
    text: `[Image: ${alt}]`,
    italics: true,
    color: INK_FAINT,
    fontSize: FONT_BODY - 1,
    margin: [0, 4, 0, 10],
  };
}

function tableNode(b: TableBlock): PdfNode {
  if (!b.rows || b.rows.length === 0) {
    return { text: '', margin: [0, 0, 0, 0] };
  }
  const ncols = b.rows[0]?.length ?? 0;
  const body: PdfNode[][] = b.rows.map((row, rowIdx) =>
    row.map((cell): PdfNode => ({
      text: inlineToRuns(cell),
      fontSize: FONT_BODY - 1,
      bold: rowIdx === 0,
      fillColor: rowIdx === 0 ? CODE_BG : undefined,
      color: INK,
      margin: [4, 4, 4, 4],
    })),
  );
  return {
    table: {
      widths: Array.from({ length: ncols }, () => '*'),
      body,
      headerRows: 1,
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => RULE_HAIRLINE,
      vLineColor: () => RULE_HAIRLINE,
    },
    margin: [0, 4, 0, 12],
  };
}

// ---------------------------------------------------------------------------
// Document assembly.
// ---------------------------------------------------------------------------

/** PDF export options. Mirrors `ToEpubOptions` / `ToDocxOptions` so the seam
 *  is uniform across serializers. `language` rides into the PDF's
 *  `Info.Lang` entry (BCP-47); defaults to "en-US". */
export interface ToPdfOptions {
  language?: string;
}

export const PDF_MIME = 'application/pdf';

/**
 * Serialize a PortableDoc to a single Blob carrying a paginated, optimized
 * PDF — A4 portrait, 22mm margins, Roboto body, embedded text layer,
 * clickable links, cream page background.
 *
 * The output is a single best-for-everything PDF: reMarkable renders it at
 * near 1:1 zoom on the 10.3" screen, Adobe Reader / Preview / browser PDF
 * viewers render it identically. No "reMarkable mode" toggle — one path.
 */
export async function toPdfBlob(
  doc: PortableDoc,
  options?: ToPdfOptions,
): Promise<Blob> {
  const language = options?.language ?? 'en-US';
  const title = doc.title ?? 'Untitled';

  // Walk the AST top-to-bottom. Section nodes flatten into the parent list
  // so pagination can land inside a section.
  const body: PdfNode[] = [];
  for (const b of doc.blocks) body.push(...blockToNodes(b, 0));

  // Page-background painter — drawn behind every page via pdfmake's
  // `background` hook. Painted as a single full-bleed rectangle in the page
  // size's pt dimensions (A4 = 595.28 × 841.89pt). Both reMarkable and
  // Adobe Reader honor canvas backgrounds.
  function background(): PdfNode[] {
    return [
      {
        canvas: [
          {
            type: 'rect',
            x: 0,
            y: 0,
            w: 595.28,
            h: 841.89,
            color: PAGE_BG,
          },
        ],
      } as PdfNode,
    ];
  }

  const docDefinition = {
    info: {
      title,
      creator: 'Papir',
      producer: 'Papir',
      author: 'Papir',
      // PDF metadata's `Lang` entry; downstream readers consult this for
      // hyphenation + accessibility text extraction.
      language,
    },
    pageSize: 'A4' as const,
    pageOrientation: 'portrait' as const,
    // 22mm = 62.36pt (1mm ≈ 2.835pt). pdfmake takes [L, T, R, B].
    pageMargins: [62, 62, 62, 62] as [number, number, number, number],
    defaultStyle: {
      font: 'Roboto',
      fontSize: FONT_BODY,
      color: INK,
      lineHeight: 1.45,
    },
    background,
    content: body,
  };

  const pdfDoc = (pdfMake as unknown as {
    createPdf: (def: unknown) => {
      getBlob?: () => Promise<Blob>;
      getBuffer: () => Promise<Uint8Array | { buffer: ArrayBuffer; byteOffset: number; byteLength: number }>;
    };
  }).createPdf(docDefinition);

  // Prefer getBlob in browsers (uses file-saver internally for download() but
  // not for the buffer assembly itself, so it's safe in test environments).
  // Fall back to getBuffer + manual Blob wrap so happy-dom — which provides
  // Blob but not Node's Buffer constructor — still works. Both methods
  // return promises in pdfmake 0.3.x.
  if (typeof pdfDoc.getBlob === 'function') {
    const blob = await pdfDoc.getBlob();
    // happy-dom's Blob carries a `type` but pdfmake's browser path sets it
    // to `application/pdf` already. Re-wrap defensively to pin the MIME.
    if (blob.type === PDF_MIME) return blob;
    return new Blob([await blob.arrayBuffer()], { type: PDF_MIME });
  }
  const buf = await pdfDoc.getBuffer();
  // Normalize the buffer to a fresh, ArrayBuffer-backed Uint8Array so the
  // Blob constructor's TS overload (which requires `ArrayBufferView<ArrayBuffer>`,
  // explicitly excluding SharedArrayBuffer) is happy without an `as any` cast.
  const view = buf instanceof Uint8Array
    ? buf
    : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const owned = new Uint8Array(view.byteLength);
  owned.set(view);
  return new Blob([owned], { type: PDF_MIME });
}
