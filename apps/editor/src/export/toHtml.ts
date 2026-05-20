/**
 * Papir → HTML serializer (Goal B P2, embedded-roundtrip-ast).
 *
 * Walks the PortableDoc AST and emits a complete, self-contained HTML5
 * document. The envelope (round-trip AST payload) rides along inside a
 * `<script type="application/portable-doc+json">` block in `<head>`, AFTER
 * `<title>` and BEFORE any user-visible script (per the embed-locations
 * spec: 2026-05-19-embed-locations.html, §HTML). Browsers ignore unknown
 * script types, so the embedded JSON is structurally invisible to readers
 * yet trivially recoverable by `fromHtml.ts`.
 *
 * Class conventions intentionally mirror toEpub.ts so the bundled reader
 * stylesheet (a trimmed subset of paper.css) styles both consistently —
 * `paper-callout-{tone}-{emphasis}`, `paper-action paper-action-{priority}`,
 * `paper-table`, `paper-section`, `paper-code`, `paper-image-placeholder`.
 *
 * DO NOT share logic with toEpub.ts / toDocx.ts. The output target is
 * different (HTML5 vs XHTML vs OOXML) and forcing a common walker would
 * buy nothing — these serializers stay parallel and small.
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
import { buildEnvelope, generateDocUuid } from '@portable-doc/core';

// ---------------------------------------------------------------------------
// HTML escape helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
// Inline node → HTML
// ---------------------------------------------------------------------------

function inlineToHtml(nodes: InlineNode[] | undefined): string {
  if (!nodes || nodes.length === 0) return '';
  const parts: string[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        parts.push(escapeHtml(n.value));
        break;
      case 'strong':
        parts.push(`<strong>${inlineToHtml(n.children)}</strong>`);
        break;
      case 'em':
        parts.push(`<em>${inlineToHtml(n.children)}</em>`);
        break;
      case 'code':
        parts.push(`<code>${escapeHtml(n.value)}</code>`);
        break;
      case 'link':
        parts.push(
          `<a href="${escapeAttr(n.href)}">${inlineToHtml(n.children)}</a>`,
        );
        break;
    }
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Block → HTML walker
// ---------------------------------------------------------------------------

function blockToHtml(b: Block, depth = 0): string {
  switch (b.type) {
    case 'heading':
      return headingToHtml(b, depth);
    case 'paragraph':
      return paragraphToHtml(b);
    case 'list':
      return listToHtml(b);
    case 'callout':
      return calloutToHtml(b);
    case 'action':
      return actionToHtml(b);
    case 'section':
      return sectionToHtml(b, depth);
    case 'divider':
      return dividerToHtml(b);
    case 'code':
      return codeToHtml(b);
    case 'image':
      return imageToHtml(b);
    case 'table':
      return tableToHtml(b);
    default:
      return '';
  }
}

function headingToHtml(b: HeadingBlock, depth: number): string {
  const level = Math.min(6, Math.max(1, b.level + Math.min(depth, 2)));
  const text = b.text ?? '';
  const id = slugify(text);
  return `<h${level} id="${escapeAttr(id)}">${escapeHtml(text)}</h${level}>`;
}

function paragraphToHtml(b: ParagraphBlock): string {
  return `<p>${inlineToHtml(b.content)}</p>`;
}

function listToHtml(b: ListBlock): string {
  const tag = b.ordered === true ? 'ol' : 'ul';
  const items = b.items
    .map((item) => `  <li>${inlineToHtml(item)}</li>`)
    .join('\n');
  return `<${tag}>\n${items}\n</${tag}>`;
}

function calloutToHtml(b: CalloutBlock): string {
  const emphasis = b.variant?.emphasis ?? 'subtle';
  const cls = `paper-callout paper-callout-${b.tone}-${emphasis}`;
  const titlePart = b.title
    ? `  <p class="paper-callout__title">${escapeHtml(b.title)}</p>\n`
    : '';
  return `<aside class="${escapeAttr(cls)}">\n${titlePart}  <p>${inlineToHtml(
    b.content,
  )}</p>\n</aside>`;
}

function actionToHtml(b: ActionBlock): string {
  const priority = b.priority ?? 'primary';
  return `<p class="paper-action paper-action-${escapeAttr(
    priority,
  )}"><a href="${escapeAttr(b.href ?? '#')}">${escapeHtml(b.label ?? '')}</a></p>`;
}

function sectionToHtml(b: SectionBlock, depth: number): string {
  const hLevel = Math.min(6, 2 + depth);
  const titlePart = b.title
    ? `  <h${hLevel} class="paper-section__title">${escapeHtml(b.title)}</h${hLevel}>\n`
    : '';
  const children = b.blocks.map((c) => blockToHtml(c, depth + 1)).join('\n');
  return `<section class="paper-section">\n${titlePart}${children}\n</section>`;
}

function dividerToHtml(_b: DividerBlock): string {
  return '<hr>';
}

function codeToHtml(b: CodeBlock): string {
  const lang = b.lang ? ` data-lang="${escapeAttr(b.lang)}"` : '';
  return `<pre class="paper-code"${lang}><code>${escapeHtml(b.value ?? '')}</code></pre>`;
}

function imageToHtml(b: ImageBlock): string {
  // v1 contract (matches toEpub / toDocx): no binary fetch + embed. Emit
  // a real <img> tag — HTML can carry the src directly without an archive
  // dance — but still preserve the alt text and the structural slot.
  const alt = b.alt ?? '';
  return `<p class="paper-image"><img src="${escapeAttr(b.src)}" alt="${escapeAttr(alt)}"></p>`;
}

function tableToHtml(b: TableBlock): string {
  const rows = b.rows
    .map((row, rowIdx) => {
      const tag = rowIdx === 0 ? 'th' : 'td';
      const cells = row
        .map((cell) => `    <${tag}>${inlineToHtml(cell)}</${tag}>`)
        .join('\n');
      return `  <tr>\n${cells}\n  </tr>`;
    })
    .join('\n');
  return `<table class="paper-table">\n${rows}\n</table>`;
}

// ---------------------------------------------------------------------------
// Bundled reader stylesheet — trimmed subset of toEpub's paper.css. Inline
// so the file is portable (single-file distribution, no CDN dependency).
// ---------------------------------------------------------------------------

function buildReaderCss(): string {
  return `html,body{margin:0;padding:0;font-family:Georgia,"Iowan Old Style",serif;color:#1f1a14;background:#fbfaf6;line-height:1.6}
body{max-width:36em;margin:0 auto;padding:1.5em 1em 3em}
h1,h2,h3,h4,h5,h6{font-family:Georgia,"Iowan Old Style",serif;font-weight:700;line-height:1.25;margin:1.6em 0 .6em;color:#1f1a14}
h1{font-size:1.625em;margin-top:.6em}h2{font-size:1.25em}h3{font-size:1.125em}h4{font-size:1em}h5{font-size:.95em}h6{font-size:.85em;text-transform:uppercase;letter-spacing:.04em}
p{margin:0 0 1em;text-align:left}
a{color:#a23925;text-decoration:underline}
ul,ol{margin:0 0 1em 1.6em;padding:0}li{margin:0 0 .3em}
hr{border:0;border-bottom:1px solid #d8d1bf;margin:2em 0}
pre.paper-code{background:#f5f2e9;border:1px solid #d8d1bf;border-radius:4px;padding:.8em 1em;font-family:Consolas,"SF Mono",Menlo,monospace;font-size:.9em;overflow-x:auto;white-space:pre-wrap;line-height:1.45}
code{background:#efede6;padding:.05em .3em;border-radius:3px;font-family:Consolas,"SF Mono",Menlo,monospace;font-size:.92em}
aside.paper-callout{border-left:4px solid #374151;background:#f3f4f6;padding:.8em 1em;margin:1.2em 0;border-radius:0 4px 4px 0}
aside.paper-callout p{margin:0 0 .5em}aside.paper-callout p:last-child{margin-bottom:0}
aside.paper-callout__title{font-weight:700;margin-bottom:.4em}
aside.paper-callout-info-subtle,aside.paper-callout-info-bold{border-left-color:#1d4ed8;background:#eff6ff}
aside.paper-callout-success-subtle,aside.paper-callout-success-bold{border-left-color:#047857;background:#ecfdf5}
aside.paper-callout-warning-subtle,aside.paper-callout-warning-bold{border-left-color:#92400e;background:#fffbeb}
aside.paper-callout-danger-subtle,aside.paper-callout-danger-bold{border-left-color:#b91c1c;background:#fef2f2}
aside.paper-callout-neutral-subtle,aside.paper-callout-neutral-bold{border-left-color:#374151;background:#f3f4f6}
p.paper-action a{color:#a23925;text-decoration:underline}
p.paper-action-primary a{font-weight:600}
table.paper-table{border-collapse:collapse;width:100%;margin:1em 0}
table.paper-table th,table.paper-table td{border:1px solid #d8d1bf;padding:.4em .6em;text-align:left;vertical-align:top}
table.paper-table th{background:#f5f2e9}
section.paper-section{margin:1em 0}
p.paper-image img{max-width:100%;height:auto}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ToHtmlOptions {
  docUuid?: string;
}

export const HTML_MIME = 'text/html';

/** Serialize a PortableDoc to a self-contained HTML5 Blob. The returned
 *  document carries the envelope (round-trip AST payload) in a
 *  `<script type="application/portable-doc+json" id="papir-envelope">`
 *  block inside `<head>`, immediately after `<title>` and before any
 *  user-visible scripts. Browsers ignore unknown script types so the
 *  embedded JSON is structurally invisible to readers; `fromHtml.ts`
 *  recovers it via DOMParser + envelopeSchema. */
export async function toHtmlBlob(
  doc: PortableDoc,
  options?: ToHtmlOptions,
): Promise<Blob> {
  const docUuid = options?.docUuid ?? generateDocUuid();
  const envelope = buildEnvelope(doc, docUuid);
  const envelopeJson = JSON.stringify(envelope, null, 2);

  const title = doc.title ?? 'Untitled';
  const body = doc.blocks.map((b) => blockToHtml(b)).join('\n');

  // Envelope script position: AFTER <title>, BEFORE any user-visible
  // script. Per the embed-locations spec, this ordering keeps the head
  // metadata in a stable sequence even if future passes inject extra
  // <script> tags below.
  const html =
    `<!doctype html>\n` +
    `<html lang="en">\n` +
    `<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">\n` +
    `<title>${escapeHtml(title)}</title>\n` +
    `<script type="application/portable-doc+json" id="papir-envelope">\n` +
    `${envelopeJson}\n` +
    `</script>\n` +
    `<style>\n${buildReaderCss()}\n</style>\n` +
    `</head>\n` +
    `<body>\n` +
    `${body}\n` +
    `</body>\n` +
    `</html>\n`;

  return new Blob([html], { type: HTML_MIME });
}
