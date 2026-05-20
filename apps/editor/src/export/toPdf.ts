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
 *   - Image embedding: data: URIs are embedded directly; http(s) URLs are
 *     fetched + base64-encoded into the doc; failures fall back to the
 *     historical italic `[Image: alt]` placeholder so an offline export
 *     still produces a valid PDF.
 *
 * Body type: Adobe Source Serif 4 (SIL OFL), bundled inline as base64 TTFs
 * — see the SOURCE_SERIF_4_*_B64 block below. The editor's prose lane uses a
 * humanist serif (Iowan / Charter on Apple, system-serif elsewhere), and the
 * spec calls for visual coherence across editor↔PDF. Source Serif 4 is the
 * canonical OFL drop-in: Adobe's open-source serif, designed for screen + print,
 * 226dpi e-ink-friendly. Roboto stays registered for code blocks + inline code
 * — the monospace-like sans is still the right "code lane" signal on a cream
 * background. The heading scale (22/18/14/12/11/10pt) and 1.45 line height
 * come straight from the spec.
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
// Body serif: Adobe Source Serif 4 (v4.005, SIL OFL 1.1).
// ---------------------------------------------------------------------------
// pdfmake's bundled `vfs_fonts.js` ships *only* Roboto-Regular/Medium/Italic/
// MediumItalic — no AFM metrics for the PDF Core 14 fonts, so 'Times-Roman'
// throws at layout time. To close the editor↔PDF font gap (editor body type
// is Iowan/serif; PDF was sans Roboto), we bundle Source Serif 4 inline as
// four base64 TTFs and register them as a custom font family alongside
// Roboto. Source Serif 4 is the canonical OFL drop-in serif: Adobe's
// open-source serif family, designed by Frank Grießhammer for screen + print,
// excellent on e-ink. Files sourced from:
//   https://github.com/adobe-fonts/source-serif (release 4.005R, TTF/ dir)
// License: SIL Open Font License 1.1 (LICENSE.md in the repo).
//
// Bundle cost: ~913 KB of TTF binary → ~1.22 MB base64 inline in this file.
// Acceptable trade — the visual win (serif body matching editor) is the
// single biggest fidelity gap remaining in the PDF channel. Roboto stays
// registered for code blocks / inline code, where mono-ish sans on a cream
// background still reads as "the code lane".
//
// We assemble the four weights as one literal each; pdfmake's vfs accepts
// raw base64 strings keyed by filename. The fonts go into a fresh map that
// merges Roboto + SourceSerif4 (so existing code-block emitters that
// reference 'Roboto' keep working).
// SourceSerif4 base64 strings live in ./sourceSerif4.ts — shared with toEpub.ts.
import {
  SOURCE_SERIF_4_REGULAR_B64,
  SOURCE_SERIF_4_BOLD_B64,
  SOURCE_SERIF_4_ITALIC_B64,
  SOURCE_SERIF_4_BOLDITALIC_B64,
} from './sourceSerif4';

// pdfmake's virtual filesystem is a module-level singleton — setting
// pdfMake.vfs (above) is *not* the registration path. The browser build
// auto-registers Roboto by calling pdfMake.addVirtualFileSystem({...}) at
// vfs_fonts.js import time. We do the same for the four SourceSerif4 TTFs,
// which writes them into pdfmake's internal in-memory FS so the layout
// engine can resolve 'SourceSerif4-Regular.ttf' etc. by filename.
(pdfMake as unknown as {
  addVirtualFileSystem: (vfs: Record<string, string>) => void;
}).addVirtualFileSystem({
  'SourceSerif4-Regular.ttf': SOURCE_SERIF_4_REGULAR_B64,
  'SourceSerif4-Bold.ttf': SOURCE_SERIF_4_BOLD_B64,
  'SourceSerif4-Italic.ttf': SOURCE_SERIF_4_ITALIC_B64,
  'SourceSerif4-BoldItalic.ttf': SOURCE_SERIF_4_BOLDITALIC_B64,
});

// pdfmake's defaultClientFonts only registers Roboto. We replace it with a
// merged map so SourceSerif4 (body) and Roboto (code blocks) are both
// available to the layout engine.
(pdfMake as unknown as { fonts: Record<string, Record<string, string>> }).fonts = {
  Roboto: {
    normal: 'Roboto-Regular.ttf',
    bold: 'Roboto-Medium.ttf',
    italics: 'Roboto-Italic.ttf',
    bolditalics: 'Roboto-MediumItalic.ttf',
  },
  SourceSerif4: {
    normal: 'SourceSerif4-Regular.ttf',
    bold: 'SourceSerif4-Bold.ttf',
    italics: 'SourceSerif4-Italic.ttf',
    bolditalics: 'SourceSerif4-BoldItalic.ttf',
  },
};

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

// Body type scale + heading cascade locked by the spacing-translation spec
// (~/docs/paperflow/specs/2026-05-20-spacing-translation.html). 11pt body
// + 28 / 22 / 18 pt H1..H3 mirror DOCX (size halves), EPUB CSS, inline
// HTML CSS, and the editor canvas (paper.css). H4..H6 step down from H3
// in the same rhythm so deep outlines stay readable.
const FONT_BODY = 11;
const BODY_LINE_HEIGHT = 1.55;
const HEADING_SIZES: Record<1 | 2 | 3 | 4 | 5 | 6, number> = {
  1: 28,
  2: 22,
  3: 18,
  4: 13,
  5: 12,
  6: 11,
};
// Top + bottom margins per heading level — spec §"Heading spacing".
// Per-level [before, after] in pt; pdfmake margin: [L, T, R, B].
const HEADING_MARGINS: Record<1 | 2 | 3 | 4 | 5 | 6, [number, number]> = {
  1: [24, 6],
  2: [18, 4],
  3: [12, 2],
  4: [10, 2],
  5: [8, 2],
  6: [8, 2],
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
      width?: number;
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
          // Force Roboto for inline-code runs so they read as a different
          // lane than the SourceSerif4 prose around them.
          font: 'Roboto',
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

async function blockToNodes(b: Block, depth = 0): Promise<PdfNode[]> {
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
      return await sectionNodes(b, depth);
    case 'divider':
      return [dividerNode(b)];
    case 'code':
      return [codeNode(b)];
    case 'image':
      return [await imageNodeAsync(b)];
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
  const [before, after] = HEADING_MARGINS[lvl];
  return {
    text: b.text ?? '',
    fontSize: HEADING_SIZES[lvl],
    bold: true,
    color: INK,
    margin: [0, before, 0, after],
    lineHeight: 1.25,
  };
}

function paragraphNode(b: ParagraphBlock): PdfNode {
  // Body paragraph — locked by spec: 12pt before / 0 after, line-height 1.55.
  return {
    text: inlineToRuns(b.content),
    fontSize: FONT_BODY,
    color: INK,
    lineHeight: BODY_LINE_HEIGHT,
    alignment: 'left',
    margin: [0, 12, 0, 0],
  };
}

function listNode(b: ListBlock): PdfNode {
  // List items — per-channel spec override: 4pt top per item (tighter
  // than body's 12pt), line-height 1.3 keeps the bullet column tight.
  const items = b.items.map((item) => ({
    text: inlineToRuns(item),
    fontSize: FONT_BODY,
    color: INK,
    lineHeight: 1.3,
    margin: [0, 4, 0, 0] as [number, number, number, number],
  }));
  return b.ordered === true
    ? { ol: items, margin: [0, 12, 0, 0] }
    : { ul: items, margin: [0, 12, 0, 0] };
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
    lineHeight: BODY_LINE_HEIGHT,
  };
  // Single-row table with one cell for the colored stripe and one for the
  // content. `fillColor` paints the background; `border` is suppressed
  // except on the left of the first cell where we want the stripe.
  // Spec-locked callout padding: 12pt vertical × 16pt horizontal —
  // pdfmake margin is [L, T, R, B] so the inner stack carries [16,12,16,12].
  return {
    table: {
      widths: [stripeWidth, '*'],
      body: [
        [
          { text: '', fillColor: tone.accent, border: [false, false, false, false] } as PdfNode,
          {
            stack: [...titleRun, body],
            fillColor: tone.bg,
            margin: [16, 12, 16, 12],
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
  // button chrome (no native equivalent). The underlined + warm-rust
  // treatment matches the editor's link aesthetic exactly. No trailing
  // arrow glyph — the bundled Roboto vfs doesn't carry U+2192 (→) so
  // it rendered as tofu/missing-glyph in the visual-check pipeline.
  const priority = b.priority ?? 'primary';
  return {
    text: [
      {
        text: b.label ?? '',
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

async function sectionNodes(b: SectionBlock, depth: number): Promise<PdfNode[]> {
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
  for (const c of b.blocks) out.push(...(await blockToNodes(c, depth + 1)));
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
        // 0.75pt is more visible against the cream bg than 0.5pt
        // (a hairline at 0.5pt nearly vanishes at typical viewing zoom)
        lineWidth: 0.75,
        lineColor: RULE_HAIRLINE,
      },
    ],
    margin: [0, 4, 0, 14],
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
          // Force Roboto here — the prose font (SourceSerif4) would lose the
          // visual "code lane" signal that the cream background sets up.
          font: 'Roboto',
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

// A4 content column at 22mm margins ≈ 471pt — clamp embedded images to that
// width so they never overflow the column. pdfmake widths are in pt.
const IMAGE_MAX_WIDTH_PT = 470;

function imagePlaceholderNode(b: ImageBlock): PdfNode {
  // Fallback for non-embeddable images (fetch failure, unrecognized scheme).
  // Matches the historical v1 disposition + toDocx + toEpub: a faint italic
  // `[Image: alt]` paragraph so the reader can see something was meant to
  // be there.
  const alt = b.alt || b.src || '';
  return {
    text: `[Image: ${alt}]`,
    italics: true,
    color: INK_FAINT,
    fontSize: FONT_BODY - 1,
    margin: [0, 4, 0, 10],
  };
}

/**
 * Resolve an ImageBlock to a pdfmake node.
 *
 * Strategy:
 *   - data: URIs pass straight through to pdfmake's `image` field — pdfmake
 *     accepts inline data URIs as of 0.3.x without needing to register them
 *     under `docDefinition.images`.
 *   - http(s) URLs are fetched, base64-encoded, and rewrapped as a data: URI.
 *     pdfmake can't follow URLs on its own in the browser build.
 *   - On any fetch failure (network, non-2xx, hostile MIME), fall back to the
 *     italic placeholder — the export must never throw on a bad image src.
 *
 * Width: respect b.width if given; otherwise pdfmake measures the natural
 * width. Either way we clamp to IMAGE_MAX_WIDTH_PT so a 4000px screenshot
 * doesn't overflow the column.
 */
async function imageNodeAsync(b: ImageBlock): Promise<PdfNode> {
  const src = b.src ?? '';
  let dataUri: string | undefined;

  if (src.startsWith('data:')) {
    dataUri = src;
  } else if (/^https?:\/\//i.test(src)) {
    try {
      const res = await fetch(src);
      if (!res.ok) return imagePlaceholderNode(b);
      const buf = new Uint8Array(await res.arrayBuffer());
      const mime = res.headers.get('content-type') || 'image/png';
      // Build base64 without Buffer (we run in browser + happy-dom).
      let bin = '';
      for (let i = 0; i < buf.byteLength; i++) bin += String.fromCharCode(buf[i]!);
      const b64 = typeof btoa === 'function'
        ? btoa(bin)
        // Fallback for any environment without btoa (extremely unlikely
        // here, but cheap insurance).
        : Buffer.from(bin, 'binary').toString('base64');
      dataUri = `data:${mime};base64,${b64}`;
    } catch {
      return imagePlaceholderNode(b);
    }
  } else {
    // Unknown scheme (file://, relative, etc.) — placeholder.
    return imagePlaceholderNode(b);
  }

  // Width: explicit override clamped to column width, otherwise just clamp.
  const width = typeof b.width === 'number' && b.width > 0
    ? Math.min(b.width, IMAGE_MAX_WIDTH_PT)
    : IMAGE_MAX_WIDTH_PT;

  return {
    image: dataUri,
    width,
    alignment: 'center',
    margin: [0, 8, 0, 8],
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
  // so pagination can land inside a section. The walk is async because image
  // blocks may fetch over the network to resolve their bytes — we pre-resolve
  // every image before pdfmake's synchronous layout pass sees the tree.
  const body: PdfNode[] = [];
  for (const b of doc.blocks) body.push(...(await blockToNodes(b, 0)));

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
      // SourceSerif4 is registered above alongside Roboto; code blocks
      // and inline-code runs still opt into Roboto via per-node `font:` overrides.
      font: 'SourceSerif4',
      fontSize: FONT_BODY,
      color: INK,
      // Body line-height locked to 1.55 by the spec — same number flows
      // into paper.css, toEpub, toHtml, and toDocx (line=372 twips).
      lineHeight: BODY_LINE_HEIGHT,
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
