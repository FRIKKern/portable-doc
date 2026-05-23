/**
 * render-to-pdf — the "universal-PDF funnel" render leg (Goal pdoc-r9p / T2).
 *
 * The funnel verifier renders EVERY export channel AND the editor canvas to
 * PDF, then compares per-block GEOMETRY read from the PDF (see
 * `pdf-geometry.ts`, T1). This module is the render leg for the two cheapest
 * surfaces — the editor canvas and the HTML export — both via headless
 * Chromium's `page.pdf(...)`. Both return a `Uint8Array` so the bytes pipe
 * straight into `extractPdfGeometry(input)`.
 *
 * Why headless setContent, not the live vite preview
 * --------------------------------------------------
 * `semantic-diff.ts` renders the editor by loading the live vite preview at
 * `/`, which is hardcoded to the `welcome` fixture (see App.tsx). To render an
 * ARBITRARY fixture — the brief mandates a hard list+table+callout fixture —
 * without touching the app, we render the editor-canvas DOM directly from the
 * PortableDoc and let Chromium lay it out under the editor's own `paper.css`.
 * The editor's TipTap stack emits standard semantic HTML for these node types
 * (h1..h6 / p / ul / ol / li / table / blockquote / pre); the custom
 * extensions (slash menu, block chrome, auto-joiner) DECORATE the canvas, they
 * do not restructure the block boxes, so they do not move geometry. The CSS
 * subset inlined here is lifted verbatim from `src/styles/paper.css` (the
 * `.paper-column` rules) so the editor side measures the same layout the app
 * ships.
 *
 * Geometry comparability
 * ----------------------
 * `renderEditorToPdf` and `renderHtmlChannelToPdf` use the SAME page size and
 * margins (`PDF_PAGE`), so the continuous-y axis `extractPdfGeometry` stitches
 * is on the same scale for both sides. The editor and the HTML export use
 * different stylesheets by design (the editor canvas vs. the portable reader
 * CSS) — that difference is exactly what the geometry gate measures; we hold
 * the PAGE geometry fixed so block-to-block deltas are the only variable.
 *
 * Pure-ish + typed. Each function launches its own short-lived browser and
 * closes it before returning, so callers don't manage browser lifecycle.
 */
import { chromium, type LaunchOptions } from 'playwright';
import type {
  Block,
  CalloutBlock,
  CodeBlock,
  HeadingBlock,
  InlineNode,
  ListBlock,
  ParagraphBlock,
  PortableDoc,
  TableBlock,
} from '@portable-doc/core';
import { toHtmlBlob } from '../../src/export/toHtml.ts';

// ─── shared page geometry (identical for both render legs) ───────────────────

/**
 * Page size + margins shared by every render leg so the stitched
 * continuous-y axis is on one scale. US Letter with 1-inch margins is the
 * pdfmake/PDF-channel default this project already uses; matching it keeps
 * the editor + HTML legs comparable to the eventual PDF channel too.
 */
export const PDF_PAGE = {
  format: 'Letter' as const,
  margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' },
  printBackground: true,
} as const;

// ─── public types ────────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Forwarded to `chromium.launch`. Defaults to headless. */
  launch?: LaunchOptions;
}

// ─── inline → HTML (editor-canvas DOM shape) ─────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/** PortableDoc inline subtree → the HTML the editor's ProseMirror DOM emits
 *  (nested <strong>/<em>/<a>, inline <code>). Mirrors the shape
 *  `tiptap-to-portable-doc.ts` round-trips against. */
function inlineToHtml(nodes: InlineNode[] | undefined): string {
  if (!nodes) return '';
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        out += escapeHtml(n.value);
        break;
      case 'strong':
        out += `<strong>${inlineToHtml(n.children)}</strong>`;
        break;
      case 'em':
        out += `<em>${inlineToHtml(n.children)}</em>`;
        break;
      case 'code':
        out += `<code>${escapeHtml(n.value)}</code>`;
        break;
      case 'link':
        out += `<a href="${escapeAttr(n.href)}">${inlineToHtml(n.children)}</a>`;
        break;
    }
  }
  return out;
}

// ─── block → editor-canvas HTML ──────────────────────────────────────────────

function headingHtml(b: HeadingBlock): string {
  const level = Math.min(6, Math.max(1, b.level));
  return `<h${level}>${escapeHtml(b.text)}</h${level}>`;
}

function paragraphHtml(b: ParagraphBlock): string {
  return `<p>${inlineToHtml(b.content)}</p>`;
}

function listHtml(b: ListBlock): string {
  const tag = b.ordered === true ? 'ol' : 'ul';
  const items = b.items.map((it) => `<li><p>${inlineToHtml(it)}</p></li>`).join('');
  return `<${tag}>${items}</${tag}>`;
}

function calloutHtml(b: CalloutBlock): string {
  // The editor renders a callout as a ProseMirror blockquote carrying the
  // `paper-block` class (see paper.css `.paper-column blockquote.paper-block`).
  // An optional title is a bold prefix + hard break on the first paragraph —
  // the exact shape `portable-doc-to-tiptap-json.ts` emits.
  const titlePrefix = b.title
    ? `<strong>${escapeHtml(b.title)}</strong><br>`
    : '';
  return `<blockquote class="paper-block"><p>${titlePrefix}${inlineToHtml(
    b.content,
  )}</p></blockquote>`;
}

function codeHtml(b: CodeBlock): string {
  return `<pre><code>${escapeHtml(b.value ?? '')}</code></pre>`;
}

function tableHtml(b: TableBlock): string {
  const rows = b.rows
    .map((row, rowIdx) => {
      const tag = rowIdx === 0 ? 'th' : 'td';
      const cells = row.map((cell) => `<${tag}><p>${inlineToHtml(cell)}</p></${tag}>`).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<table><tbody>${rows}</tbody></table>`;
}

function blockToEditorHtml(b: Block): string {
  switch (b.type) {
    case 'heading':
      return headingHtml(b);
    case 'paragraph':
      return paragraphHtml(b);
    case 'list':
      return listHtml(b);
    case 'callout':
      return calloutHtml(b);
    case 'action':
      // Editor renders an action as a paragraph wrapping a link run.
      return `<p><a href="${escapeAttr(b.href)}">${escapeHtml(b.label)}</a></p>`;
    case 'section': {
      const heading = b.title
        ? `<h2>${escapeHtml(b.title)}</h2>`
        : '';
      return heading + b.blocks.map(blockToEditorHtml).join('');
    }
    case 'divider':
      return '<hr>';
    case 'code':
      return codeHtml(b);
    case 'image':
      return `<p><img src="${escapeAttr(b.src)}" alt="${escapeAttr(b.alt)}"></p>`;
    case 'table':
      return tableHtml(b);
    default:
      return '';
  }
}

/**
 * Editor-canvas CSS — the `.paper-column` subset of `src/styles/paper.css`
 * that governs BLOCK GEOMETRY (font sizes, margins, list/callout/table
 * spacing). Lifted verbatim so the editor render leg measures the same
 * layout the app ships. Chrome/headless has no 'Source Serif 4' installed,
 * so the family falls through to its serif fallbacks — the same fallback the
 * HTML export takes in a no-font environment, keeping the two legs on equal
 * footing.
 */
const EDITOR_CANVAS_CSS = `
  :root { --paper-ink: #1f1a14; --paper-tone-info: #3b6e8f; }
  html, body { margin: 0; padding: 0; }
  .paper-column {
    font-family: 'Source Serif 4', Georgia, 'Times New Roman', serif;
    font-size: 18px;
    line-height: 1.55;
    letter-spacing: 0.005em;
    color: var(--paper-ink);
  }
  .paper-column h1, .paper-column h2, .paper-column h3,
  .paper-column h4, .paper-column h5, .paper-column h6 {
    font-family: 'Source Serif 4', Georgia, 'Times New Roman', serif;
    line-height: 1.3; font-weight: 600; color: var(--paper-ink);
  }
  .paper-column h1 { font-size: 32px; letter-spacing: -0.01em; margin: 24pt 0 6pt; }
  .paper-column h2 { font-size: 24px; margin: 18pt 0 4pt; }
  .paper-column h3 { font-size: 20px; margin: 12pt 0 2pt; }
  .paper-column h4 { font-size: 18px; margin: 22px 0 8px; }
  .paper-column h5 { font-size: 16px; margin: 18px 0 6px; font-weight: 700; }
  .paper-column h6 { font-size: 14px; margin: 14px 0 4px; font-weight: 700; }
  .paper-column p { margin: 12pt 0 0; }
  .paper-column a { color: #a23925; text-decoration: none; border-bottom: 1px solid rgba(162,57,37,0.10); }
  .paper-column ul, .paper-column ol { margin: 0 0 24px; padding-left: 24px; }
  .paper-column li { margin: 4pt 0 0; }
  .paper-column li > p { margin: 0; }
  .paper-column blockquote.paper-block {
    margin: 12pt 0 0; padding: 12pt 16pt;
    border-left: 4px solid var(--paper-tone-info);
    background: rgba(59,110,143,0.07); border-radius: 2px; font-style: normal;
  }
  .paper-column blockquote > :first-child { margin-top: 0; }
  .paper-column blockquote > :last-child { margin-bottom: 0; }
  .paper-column code { font-family: 'JetBrains Mono', Menlo, monospace; font-size: 0.92em; }
  .paper-column pre {
    font-family: 'JetBrains Mono', Menlo, monospace; font-size: 14px; line-height: 1.5;
    background: #f5f2e9; border: 1px solid rgba(31,26,20,0.08); border-radius: 4px;
    padding: 14px 16px; margin: 0 0 22px;
  }
  .paper-column hr { border: 0; border-top: 0.75pt solid #D8D1BF; margin: 12pt 0 0; }
  .paper-column table { border-collapse: collapse; width: 100%; margin: 12pt 0 0; }
  .paper-column th, .paper-column td {
    border: 1px solid rgba(31,26,20,0.12); padding: 6px 10px; text-align: left; vertical-align: top;
  }
  .paper-column th p, .paper-column td p { margin: 0; }
`;

/**
 * Build the full editor-canvas HTML document for a fixture: the PortableDoc
 * blocks projected into the editor's ProseMirror DOM shape, wrapped in
 * `.paper-column .ProseMirror` and styled by the inlined canvas CSS.
 */
function buildEditorCanvasHtml(doc: PortableDoc): string {
  const body = doc.blocks.map(blockToEditorHtml).join('\n');
  return (
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n` +
    `<style>${EDITOR_CANVAS_CSS}</style></head>\n` +
    `<body><main class="paper-column"><div class="ProseMirror">\n${body}\n` +
    `</div></main></body></html>\n`
  );
}

// ─── render legs ─────────────────────────────────────────────────────────────

async function htmlToPdf(html: string, options?: RenderOptions): Promise<Uint8Array> {
  const browser = await chromium.launch({ headless: true, ...options?.launch });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const buf = await page.pdf(PDF_PAGE);
    return new Uint8Array(buf);
  } finally {
    await browser.close();
  }
}

/**
 * Render the EDITOR CANVAS of a fixture to PDF. The fixture's blocks are
 * projected into the editor's ProseMirror DOM shape and laid out under the
 * editor's `paper.css` subset, then printed to PDF with the shared page
 * geometry. Returns the PDF bytes — feed straight into `extractPdfGeometry`.
 */
export async function renderEditorToPdf(
  doc: PortableDoc,
  options?: RenderOptions,
): Promise<Uint8Array> {
  return htmlToPdf(buildEditorCanvasHtml(doc), options);
}

/**
 * Render the HTML EXPORT of a fixture to PDF. Produces the channel via the
 * real `toHtmlBlob` serializer (the same bytes a writer would export), then
 * prints that document to PDF with the shared page geometry. Returns the PDF
 * bytes — feed straight into `extractPdfGeometry`.
 */
export async function renderHtmlChannelToPdf(
  doc: PortableDoc,
  options?: RenderOptions,
): Promise<Uint8Array> {
  const blob = await toHtmlBlob(doc);
  const html = Buffer.from(await blob.arrayBuffer()).toString('utf8');
  return htmlToPdf(html, options);
}
