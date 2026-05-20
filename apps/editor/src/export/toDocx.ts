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
  type IParagraphStyleOptions,
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
  const calloutSpacing = {
    before: 200,
    after: 200,
    line: 360,
    lineRule: LineRuleType.AUTO,
  };
  const calloutIndent = { left: 360, right: 360 };
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
  // 28px × 20 = 560 twips above and below — matches paper.css's <hr>
  // vertical rhythm. Hairline (size=4 eighths = 0.5pt) warm-stone rule.
  return new Paragraph({
    spacing: { before: 560, after: 560 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 4, space: 1, color: 'D8D1BF' },
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

function paragraphsForSection(b: SectionBlock, depth = 0): TopChild[] {
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
    out.push(...walkBlock(child, depth + 1));
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

function walkBlock(b: Block, depth = 0): TopChild[] {
  // Section nesting indent is applied by paragraphsForSection's depth
  // parameter, not by post-processing — see indentTopChild's note. The
  // depth parameter rides through so future call sites can layer on
  // additional context-sensitive transforms without changing the seam.
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
      return paragraphsForSection(b, depth);
    case 'divider':
      return [paragraphForDivider(b)];
    case 'code':
      return [tableForCode(b)];
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
  uiPriority?: number;
  quickFormat?: boolean;
  unhideWhenUsed?: boolean;
  noProof?: boolean;
}

function seed(s: SeedStyle): IParagraphStyleOptions {
  const runBlock: Record<string, unknown> = {
    // Georgia matches the editor's serif fallback. Iowan Old Style is
    // Apple-only, so the .docx ships Georgia (universally installed).
    font: s.font ?? 'Georgia',
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
      // 1.6 line-height (line=384, 240×1.6) feels like the editor.
      spacing: {
        before: s.spaceBefore ?? 0,
        after: s.spaceAfter ?? 120,
        line: 384,
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

  // Callouts (10 rows): tone × emphasis. Runs stay Georgia-on-paper-ink;
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
            run: { font: { name: 'Georgia' } },
            paragraph: {
              indent: { left: 360, hanging: 200 },
              spacing: { after: 80, line: 276, lineRule: LineRuleType.AUTO },
            },
          },
        },
        {
          level: 1,
          format: 'bullet' as const,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: {
            run: { font: { name: 'Georgia' } },
            paragraph: {
              indent: { left: 720, hanging: 200 },
              spacing: { after: 80, line: 276, lineRule: LineRuleType.AUTO },
            },
          },
        },
        {
          level: 2,
          format: 'bullet' as const,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: {
            run: { font: { name: 'Georgia' } },
            paragraph: {
              indent: { left: 1080, hanging: 200 },
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

  // Don't emit a separate TITLE paragraph — the first heading block in the
  // doc IS the title, by convention. doc.title stays in Document properties
  // metadata for the file's Title field (set below at `title: doc.title`),
  // but rendering it as a second visual heading duplicates the H1 the user
  // already wrote (visible side-by-side in the visual-check pipeline:
  // welcome.json shows "Welcome to Atlas" twice in the exported .docx).
  for (const b of doc.blocks) {
    children.push(...walkBlock(b));
  }

  const document = new Document({
    creator: 'Papir',
    title: doc.title ?? 'Untitled',
    // NOTE: Each app has its own "Print background colors" toggle that defaults
    // OFF. Cream paper prints only after the user enables it in Word/Pages/etc
    // preferences. No OOXML setting forces this; a header-shape hack works but
    // costs cross-app fidelity. Document the limitation; don't fight it.
    background: { color: 'FBFAF6' },
    styles: {
      default: {
        document: {
          // Document-default language drives every renderer's spell-check
          // pass. Without it, Word falls back to OS locale and Google Docs
          // assumes en-US — both produce inconsistent UX across users.
          run: {
            font: 'Georgia',
            size: 22, // 11pt
            color: '1F1A14',
            language: { value: language },
          },
          paragraph: {
            // 330 twips after — matches paper.css's 22px paragraph margin
            // (22 × 15 = 330). Previously 120 (too tight).
            spacing: { line: 384, lineRule: LineRuleType.AUTO, after: 330 },
          },
        },
        // Heading sizes + spacings follow paper.css's scale (px × 15 = twips).
        // OOXML's run.size is half-points (24pt → 48).
        //
        // Verified 2026-05-20 against apps/editor/src/styles/paper.css against
        // --paper-font-size-h1..h3 + h4..h6 explicit px values, all within 0 hp
        // tolerance — DO NOT tune these blindly off a composite-thumbnail
        // visual diff. The conversion ladder is:
        //   h1 32px → 48 hp (24pt), margin 0/14px → 0/210 twips
        //   h2 24px → 36 hp (18pt), margin 38/14px → 570/210 twips
        //   h3 20px → 30 hp (15pt), margin 28/10px → 420/150 twips
        //   h4 18px → 27 hp (13.5pt), margin 22/8px → 330/120 twips
        //   h5 16px → 24 hp (12pt), margin 18/6px → 270/90 twips
        //   h6 14px → 21 hp (10.5pt), margin 14/4px → 210/60 twips
        // If a future audit claims an H1 mismatch, re-derive from paper.css
        // first; the px×1.5 = hp / px×15 = twips identity is exact.
        heading1: {
          run: { font: 'Georgia', size: 48, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 0, after: 210, line: 384, lineRule: LineRuleType.AUTO },
          },
        },
        heading2: {
          run: { font: 'Georgia', size: 36, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 570, after: 210, line: 384, lineRule: LineRuleType.AUTO },
          },
        },
        heading3: {
          run: { font: 'Georgia', size: 30, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 420, after: 150, line: 384, lineRule: LineRuleType.AUTO },
          },
        },
        heading4: {
          run: { font: 'Georgia', size: 27, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 330, after: 120, line: 384, lineRule: LineRuleType.AUTO },
          },
        },
        heading5: {
          run: { font: 'Georgia', size: 24, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 270, after: 90, line: 384, lineRule: LineRuleType.AUTO },
          },
        },
        heading6: {
          run: { font: 'Georgia', size: 21, bold: true, color: '1F1A14' },
          paragraph: {
            spacing: { before: 210, after: 60, line: 384, lineRule: LineRuleType.AUTO },
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
  const envelope = buildEnvelope(doc, docUuid);
  const envelopeJson = JSON.stringify(envelope, null, 2);
  const customXmlBody = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<papir-envelope xmlns="${ENVELOPE_NS}">
  <payload><![CDATA[
${envelopeJson}
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
