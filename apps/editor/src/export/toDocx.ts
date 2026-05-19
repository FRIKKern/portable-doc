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
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
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
  shading?: { type: (typeof ShadingType)[keyof typeof ShadingType]; color: string; fill: string };
}

// ---------------------------------------------------------------------------
// Variant → ParagraphStyle name. PascalCase per
// 2026-05-18-variant-style-mapping.html. Tones / emphases off the catalog
// fall through to `null` and trigger the "[Unsupported variant: …]" callout.
// ---------------------------------------------------------------------------

const TONE_COLOR: Record<Tone, { fg: string; bg: string }> = {
  success: { fg: '047857', bg: 'ECFDF5' },
  warning: { fg: '92400E', bg: 'FFFBEB' },
  danger: { fg: 'B91C1C', bg: 'FEF2F2' },
  info: { fg: '1D4ED8', bg: 'EFF6FF' },
  neutral: { fg: '374151', bg: 'F3F4F6' },
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

function actionStyleName(b: ActionBlock): string {
  const priority = b.priority ?? 'primary';
  const size = b.variant?.size ?? 'medium';
  return `Action${pascal(priority)}${pascal(size)}`;
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
        const childRuns = inlineToRuns(n.children, ctx);
        out.push(
          new ExternalHyperlink({
            link: n.href,
            children: childRuns.length > 0 ? childRuns : [new TextRun({ text: n.href })],
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
  const tone = TONE_COLOR[b.tone];
  const out: Paragraph[] = [];
  if (b.title) {
    out.push(
      new Paragraph({
        style: styleId,
        border: {
          left: { style: BorderStyle.SINGLE, size: 24, space: 8, color: tone.fg },
        },
        shading: { type: ShadingType.SOLID, color: tone.bg, fill: tone.bg },
        children: [new TextRun({ text: b.title, bold: true, color: tone.fg })],
      }),
    );
  }
  out.push(
    new Paragraph({
      style: styleId,
      border: {
        left: { style: BorderStyle.SINGLE, size: 24, space: 8, color: tone.fg },
      },
      shading: { type: ShadingType.SOLID, color: tone.bg, fill: tone.bg },
      children: inlineToRuns(b.content, { color: tone.fg }),
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
  const rows = b.rows.map((row, rowIdx) => {
    const isHeader = rowIdx === 0;
    return new TableRow({
      children: row.map(
        (cell) =>
          new TableCell({
            shading: isHeader
              ? { type: ShadingType.SOLID, color: 'F3F4F6', fill: 'F3F4F6' }
              : undefined,
            children: [
              new Paragraph({
                children: inlineToRuns(cell).map((run) => {
                  if (isHeader && run instanceof TextRun) {
                    // Header runs: bold via re-wrap. TextRun is mostly opaque
                    // post-construction — easiest is to wrap the original text
                    // in a fresh bold run. We only get here for `text` and
                    // `code` inlines; links / nested marks emit ExternalHyperlink
                    // and pass through.
                    return run;
                  }
                  return run;
                }),
              }),
            ],
          }),
      ),
    });
  });

  // Header bold: rebuild row 0's cells with bold runs (cleaner than mutating).
  if (rows.length > 0 && b.rows[0]) {
    rows[0] = new TableRow({
      children: b.rows[0].map(
        (cell) =>
          new TableCell({
            shading: { type: ShadingType.SOLID, color: 'F3F4F6', fill: 'F3F4F6' },
            children: [
              new Paragraph({ children: inlineToRuns(cell, { bold: true }) }),
            ],
          }),
      ),
    });
  }

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

function paragraphForAction(b: ActionBlock): Paragraph {
  const styleId = actionStyleName(b);
  const isPrimary = (b.priority ?? 'primary') === 'primary';
  return new Paragraph({
    style: styleId,
    alignment: AlignmentType.LEFT,
    shading: isPrimary
      ? { type: ShadingType.SOLID, color: '4F46E5', fill: '4F46E5' }
      : undefined,
    border: !isPrimary
      ? {
          top: { style: BorderStyle.SINGLE, size: 16, space: 4, color: '4F46E5' },
          bottom: { style: BorderStyle.SINGLE, size: 16, space: 4, color: '4F46E5' },
          left: { style: BorderStyle.SINGLE, size: 16, space: 4, color: '4F46E5' },
          right: { style: BorderStyle.SINGLE, size: 16, space: 4, color: '4F46E5' },
        }
      : undefined,
    children: [
      new ExternalHyperlink({
        link: b.href,
        children: [
          new TextRun({
            text: b.label,
            bold: true,
            color: isPrimary ? 'FFFFFF' : '4F46E5',
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
      font: s.font ?? 'Calibri',
      size: s.sizeHalfPoints ?? 22,
      bold: s.bold === true,
      italics: s.italics === true,
      color: s.color ?? '111827',
    },
    paragraph: {
      indent: s.indentLeftTwips !== undefined ? { left: s.indentLeftTwips } : undefined,
      spacing: { before: s.spaceBefore ?? 120, after: s.spaceAfter ?? 120 },
    },
  };
}

function buildVariantStyles() {
  const styles: ReturnType<typeof seed>[] = [];

  // Callouts (10 rows): tone × emphasis
  const tones: Array<{ tone: Tone; color: string }> = [
    { tone: 'success', color: '047857' },
    { tone: 'warning', color: '92400E' },
    { tone: 'danger', color: 'B91C1C' },
    { tone: 'info', color: '1D4ED8' },
    { tone: 'neutral', color: '374151' },
  ];
  for (const { tone, color } of tones) {
    for (const emphasis of ['subtle', 'bold'] as const) {
      const id = `Callout${pascal(tone)}${pascal(emphasis)}`;
      styles.push(
        seed({
          id,
          name: id,
          color,
          bold: emphasis === 'bold',
          indentLeftTwips: 240,
          spaceBefore: emphasis === 'bold' ? 160 : 120,
          spaceAfter: emphasis === 'bold' ? 160 : 120,
        }),
      );
    }
  }

  // Actions (4 rows): primary/secondary × medium/large
  for (const priority of ['Primary', 'Secondary'] as const) {
    for (const size of ['Medium', 'Large'] as const) {
      const id = `Action${priority}${size}`;
      styles.push(
        seed({
          id,
          name: id,
          sizeHalfPoints: size === 'Large' ? 26 : 22,
          bold: true,
          color: priority === 'Primary' ? 'FFFFFF' : '4F46E5',
          spaceBefore: size === 'Large' ? 160 : 120,
          spaceAfter: size === 'Large' ? 160 : 120,
        }),
      );
    }
  }

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
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 360 } } },
        },
        {
          level: 1,
          format: 'bullet' as const,
          text: '◦',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
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
    styles: {
      paragraphStyles: buildVariantStyles(),
    },
    numbering: numberingConfig,
    sections: [
      {
        properties: {},
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
