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
 * Images are deliberately skipped in v1 (binary embedding requires fetching
 * the src + adding an `ImageRun` with explicit dimensions; deferred). The
 * image block emits a placeholder paragraph `[Image: <alt>]` so the
 * structure survives the round-trip.
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
  type ParagraphChild,
} from 'docx';
import JSZip from 'jszip';
import { buildEnvelope, generateDocUuid } from '@portable-doc/core';

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
        const opts: RunOpts = {
          text: n.value,
          font: 'Consolas',
          shading: { type: ShadingType.SOLID, color: 'F3F4F6', fill: 'F3F4F6' },
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

function paragraphForHeading(b: HeadingBlock): Paragraph {
  const level = Math.min(6, Math.max(1, b.level)) - 1;
  return new Paragraph({
    heading: HEADING_LEVELS[level],
    children: [new TextRun({ text: b.text ?? '' })],
  });
}

function paragraphForParagraph(b: ParagraphBlock): Paragraph {
  return new Paragraph({ children: inlineToRuns(b.content) });
}

function paragraphsForList(b: ListBlock): Paragraph[] {
  const ordered = b.ordered === true;
  return b.items.map(
    (item) =>
      new Paragraph({
        children: inlineToRuns(item),
        numbering: {
          reference: ordered ? 'paper-ordered' : 'paper-bullet',
          level: 0,
        },
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
  const calloutSpacing = {
    before: 200,
    after: 200,
    line: 360,
    lineRule: LineRuleType.AUTO,
  };
  const calloutIndent = { left: 360, right: 360 };
  const out: Paragraph[] = [];
  if (b.title) {
    out.push(
      new Paragraph({
        style: styleId,
        border: calloutBorder,
        shading: calloutShading,
        indent: calloutIndent,
        spacing: calloutSpacing,
        children: [new TextRun({ text: b.title, bold: true, color: tone.border })],
      }),
    );
  }
  out.push(
    new Paragraph({
      style: styleId,
      border: calloutBorder,
      shading: calloutShading,
      indent: calloutIndent,
      spacing: calloutSpacing,
      children: inlineToRuns(b.content),
    }),
  );
  return out;
}

function paragraphsForCode(b: CodeBlock): Paragraph[] {
  const styleId = codeStyleName(b.variant);
  const dark = (b.variant?.theme ?? 'light') === 'dark';
  const fg = dark ? 'E5E7EB' : '111827';
  const bg = dark ? '111827' : 'F3F4F6';
  const lines = (b.value ?? '').split('\n');
  return lines.map(
    (line) =>
      new Paragraph({
        style: styleId,
        shading: { type: ShadingType.SOLID, color: bg, fill: bg },
        children: [new TextRun({ text: line, font: 'Consolas', color: fg })],
      }),
  );
}

function paragraphForDivider(_b: DividerBlock): Paragraph {
  return new Paragraph({
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: 'CCCCCC' },
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
            font: 'Georgia',
          }),
        ],
      }),
    ],
  });
}

function paragraphForImage(b: ImageBlock): Paragraph {
  // v1: skip binary embedding (would require fetching src + ImageRun with
  // explicit dimensions). Emit a structural placeholder so the surrounding
  // document still reads in order.
  return new Paragraph({
    children: [new TextRun({ text: `[Image: ${b.alt || b.src}]`, italics: true })],
  });
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

function paragraphsForSection(b: SectionBlock): TopChild[] {
  const styleId = sectionStyleName(b.variant);
  const out: TopChild[] = [];
  if (b.title) {
    out.push(
      new Paragraph({
        style: styleId,
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: b.title, bold: true })],
      }),
    );
  }
  for (const child of b.blocks) {
    out.push(...walkBlock(child));
  }
  return out;
}

function walkBlock(b: Block): TopChild[] {
  switch (b.type) {
    case 'heading':
      return [paragraphForHeading(b)];
    case 'paragraph':
      return [paragraphForParagraph(b)];
    case 'list':
      return paragraphsForList(b);
    case 'callout':
      return paragraphsForCallout(b);
    case 'action':
      return [paragraphForAction(b)];
    case 'section':
      return paragraphsForSection(b);
    case 'divider':
      return [paragraphForDivider(b)];
    case 'code':
      return paragraphsForCode(b);
    case 'image':
      return [paragraphForImage(b)];
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
}

function seed(s: SeedStyle) {
  return {
    id: s.id,
    name: s.name,
    basedOn: 'Normal',
    next: 'Normal',
    quickFormat: true,
    run: {
      // Georgia matches the editor's serif fallback. Iowan Old Style is
      // Apple-only, so the .docx ships Georgia (universally installed).
      font: s.font ?? 'Georgia',
      size: s.sizeHalfPoints ?? 22,
      bold: s.bold === true,
      italics: s.italics === true,
      color: s.color ?? '1F1A14',
    },
    paragraph: {
      indent: s.indentLeftTwips !== undefined ? { left: s.indentLeftTwips } : undefined,
      // 1.6 line-height (line=384, 240×1.6) feels like the editor.
      spacing: {
        before: s.spaceBefore ?? 0,
        after: s.spaceAfter ?? 120,
        line: 384,
        lineRule: LineRuleType.AUTO,
      },
    },
  };
}

function buildVariantStyles() {
  const styles: ReturnType<typeof seed>[] = [];

  // Callouts (10 rows): tone × emphasis. Runs stay Georgia-on-paper-ink;
  // the tone color lives on the left border (set inline on each callout
  // paragraph in paragraphsForCallout, not on the style row).
  const tones: Tone[] = ['success', 'warning', 'danger', 'info', 'neutral'];
  for (const tone of tones) {
    for (const emphasis of ['subtle', 'bold'] as const) {
      const id = `Callout${pascal(tone)}${pascal(emphasis)}`;
      styles.push(
        seed({
          id,
          name: id,
          font: 'Georgia',
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
  const sectionSpacing: Record<string, number> = {
    Compact: 80,
    Comfortable: 160,
    Spacious: 240,
  };
  for (const density of ['Compact', 'Comfortable', 'Spacious'] as const) {
    const id = `Section${density}`;
    styles.push(
      seed({
        id,
        name: id,
        spaceBefore: sectionSpacing[density],
        spaceAfter: sectionSpacing[density],
      }),
    );
  }

  // Code (4 rows): light/dark × normal/compact
  for (const theme of ['Light', 'Dark'] as const) {
    for (const density of ['Normal', 'Compact'] as const) {
      const id = `Code${theme}${density}`;
      styles.push(
        seed({
          id,
          name: id,
          font: 'Consolas',
          sizeHalfPoints: density === 'Compact' ? 18 : 20,
          color: theme === 'Dark' ? 'E5E7EB' : '111827',
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
      name: 'BlockQuote',
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
          // \u{F0B7} is the Word/Symbol-font bullet (PUA codepoint).
          // Pairing it with `font: 'Symbol'` is how native Word lists
          // ship; Pages + Docs both honour it.
          text: '\u{F0B7}',
          alignment: AlignmentType.LEFT,
          style: {
            run: { font: { name: 'Symbol' } },
            paragraph: {
              indent: { left: 360, hanging: 360 },
              spacing: { after: 80, line: 276, lineRule: LineRuleType.AUTO },
            },
          },
        },
        {
          level: 1,
          format: 'bullet' as const,
          text: '\u{F0B7}',
          alignment: AlignmentType.LEFT,
          style: {
            run: { font: { name: 'Symbol' } },
            paragraph: {
              indent: { left: 720, hanging: 360 },
              spacing: { after: 80, line: 276, lineRule: LineRuleType.AUTO },
            },
          },
        },
        {
          level: 2,
          format: 'bullet' as const,
          text: '\u{F0B7}',
          alignment: AlignmentType.LEFT,
          style: {
            run: { font: { name: 'Symbol' } },
            paragraph: {
              indent: { left: 1080, hanging: 360 },
              spacing: { after: 80, line: 276, lineRule: LineRuleType.AUTO },
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
          style: { paragraph: { indent: { left: 360, hanging: 360 } } },
        },
        {
          level: 1,
          format: 'lowerLetter' as const,
          text: '%2.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
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
 *  task — this signature is the seam). */
export interface ToDocxOptions {
  docUuid?: string;
}

export async function toDocxBlob(
  doc: PortableDoc,
  options?: ToDocxOptions,
): Promise<Blob> {
  const docUuid = options?.docUuid ?? generateDocUuid();
  const children: TopChild[] = [];

  if (doc.title) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        children: [new TextRun({ text: doc.title, bold: true })],
      }),
    );
  }

  for (const b of doc.blocks) {
    children.push(...walkBlock(b));
  }

  const document = new Document({
    creator: 'Papir',
    title: doc.title ?? 'Untitled',
    // Document-wide cream paper. dolanmiu/docx auto-emits both
    // <w:background> in document.xml AND <w:displayBackgroundShape/>
    // in settings.xml when this option is set, so the colour shows in
    // Word's Print Layout (Web Layout already shows the document
    // background by default).
    background: { color: 'FBFAF6' },
    styles: {
      default: {
        document: {
          run: {
            font: 'Georgia',
            size: 22, // 11pt
            color: '1F1A14',
          },
          paragraph: {
            spacing: { line: 384, lineRule: LineRuleType.AUTO, after: 120 },
          },
        },
        // Heading sizes follow paper.css's scale: H1=24pt … H6=10pt.
        // OOXML's run.size is half-points, so 24pt → 48.
        heading1: {
          run: { font: 'Georgia', size: 48, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 360, after: 240, line: 384, lineRule: LineRuleType.AUTO },
          },
        },
        heading2: {
          run: { font: 'Georgia', size: 36, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 280, after: 200, line: 384, lineRule: LineRuleType.AUTO },
          },
        },
        heading3: {
          run: { font: 'Georgia', size: 30, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 240, after: 160, line: 384, lineRule: LineRuleType.AUTO },
          },
        },
        heading4: {
          run: { font: 'Georgia', size: 26, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 200, after: 140, line: 384, lineRule: LineRuleType.AUTO },
          },
        },
        heading5: {
          run: { font: 'Georgia', size: 22, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 160, after: 120, line: 384, lineRule: LineRuleType.AUTO },
          },
        },
        heading6: {
          run: { font: 'Georgia', size: 20, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 160, after: 120, line: 384, lineRule: LineRuleType.AUTO },
          },
        },
        title: {
          run: { font: 'Georgia', size: 56, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 0, after: 360, line: 384, lineRule: LineRuleType.AUTO },
          },
        },
      },
      // Hyperlink character style — warm-rust ink, single underline.
      // Real Word renderers honour the style binding; Pages / Google Docs
      // strip it but the inline TextRun's direct-formatting (set in
      // inlineToRuns and paragraphForAction) carries the same look.
      characterStyles: [
        {
          id: 'Hyperlink',
          name: 'Hyperlink',
          basedOn: 'DefaultParagraphFont',
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

async function embedEnvelope(
  blob: Blob,
  doc: PortableDoc,
  docUuid: string,
): Promise<Blob> {
  const buffer = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  // 1. Inject customXml/item1.xml — JSON inside CDATA so the OPC parser
  //    treats it as opaque text and we don't have to XML-escape every
  //    quote in the payload.
  const envelope = buildEnvelope(doc, docUuid);
  const customXmlBody = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<papir-envelope xmlns="${ENVELOPE_NS}">
  <payload><![CDATA[
${JSON.stringify(envelope, null, 2)}
  ]]></payload>
</papir-envelope>`;
  zip.file(ENVELOPE_PART, customXmlBody);

  // 2. Add an Override entry to [Content_Types].xml so consumers know the
  //    new part is application/xml. Word silently drops parts it can't
  //    type-resolve.
  const ctFile = zip.file('[Content_Types].xml');
  if (ctFile) {
    const ct = await ctFile.async('string');
    if (!ct.includes(`PartName="/${ENVELOPE_PART}"`)) {
      const ctPatched = ct.replace(
        '</Types>',
        `<Override PartName="/${ENVELOPE_PART}" ContentType="application/xml"/></Types>`,
      );
      zip.file('[Content_Types].xml', ctPatched);
    }
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

  return await zip.generateAsync({
    type: 'blob',
    mimeType: DOCX_MIME,
  });
}
