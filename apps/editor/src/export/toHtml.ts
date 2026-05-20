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
// Inline @font-face — base64-embedded 'Source Serif 4' family
// (Regular / Italic / Bold / BoldItalic).
//
// Family name: 'Source Serif 4' — must match the CSS font-family below.
//
// Per spec `2026-05-20-channel-embed.html` §4 ("HTML export — base64
// inline @font-face"), the exported .html ships the four TTFs inline as
// `src: url('data:font/ttf;base64,…') format('truetype')`. Cost: ~1.6 MB
// per file (33% base64 inflation over the ~1.2 MB binary). Win: the doc
// renders with the editor's exact typeface offline, on USB, in email —
// no CDN, no system-font lottery.
//
// `new URL(..., import.meta.url)` is the same Vite pattern toDocx.ts uses
// (see §2 of the same spec). At dev/prod the URL resolves through Vite's
// public-dir middleware; at build the loader rewrites it to the bundled
// asset path. Vitest/happy-dom can't fetch the URL — loadInlineFontFaces
// returns an empty string in that environment and the export still works
// (browsers fall back to the rest of the family stack — Georgia, Times
// New Roman, serif — which is fine for the test assertions; the
// integration test in the editor app verifies the data URIs end up in
// the real export).
// ---------------------------------------------------------------------------

const FONT_URLS = {
  regular: new URL('../../public/fonts/SourceSerif4-Regular.ttf', import.meta.url),
  italic: new URL('../../public/fonts/SourceSerif4-Italic.ttf', import.meta.url),
  bold: new URL('../../public/fonts/SourceSerif4-Bold.ttf', import.meta.url),
  boldItalic: new URL('../../public/fonts/SourceSerif4-BoldItalic.ttf', import.meta.url),
} as const;

interface FontFaceSpec {
  url: URL;
  weight: 400 | 700;
  style: 'normal' | 'italic';
}

const FONT_FACE_SPECS: readonly FontFaceSpec[] = [
  { url: FONT_URLS.regular, weight: 400, style: 'normal' },
  { url: FONT_URLS.italic, weight: 400, style: 'italic' },
  { url: FONT_URLS.bold, weight: 700, style: 'normal' },
  { url: FONT_URLS.boldItalic, weight: 700, style: 'italic' },
];

function arrayBufferToBase64(buf: ArrayBuffer): string {
  // Chunked walk to avoid `apply()` arg-count limits on huge TTFs (>~100 KB
  // already trips the call-stack on some engines). 0x8000 chunks are the
  // documented MDN size — works across V8/JSC/SpiderMonkey/happy-dom.
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  // `btoa` exists in browser + happy-dom + modern Node (≥16).
  return btoa(binary);
}

/** Fetch the four TTFs and return four `@font-face` CSS rules with
 *  base64-encoded data URIs. Returns an empty string when any fetch
 *  fails or stalls (vitest/happy-dom, no-net build, etc.) — the
 *  exported document still works, it just falls back through the
 *  family stack to Georgia / Times New Roman / serif.
 *
 *  The 2-second AbortSignal cap is the happy-dom guard: that environment
 *  resolves `fetch(new URL('…', import.meta.url))` to a hanging promise
 *  rather than a thrown error, so a pure try/catch never trips. The cap
 *  is generously above any plausible same-origin TTF read (~30 ms on
 *  localhost dev, instant when bundled), so the production browser path
 *  is unaffected. */
async function loadInlineFontFaces(): Promise<string> {
  // Helper: shape one resolved ArrayBuffer/Uint8Array into a @font-face rule.
  const renderFace = (buf: ArrayBuffer | Uint8Array, spec: FontFaceSpec): string => {
    const ab = buf instanceof Uint8Array ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf;
    const b64 = arrayBufferToBase64(ab);
    return (
      `@font-face {\n` +
      `  font-family: 'Source Serif 4';\n` +
      `  src: url('data:font/ttf;base64,${b64}') format('truetype');\n` +
      `  font-weight: ${spec.weight};\n` +
      `  font-style: ${spec.style};\n` +
      `  font-display: swap;\n` +
      `}`
    );
  };

  // Browser / Vite path — fetch the Vite-rewritten URL.
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2000);
    try {
      const bufs = await Promise.all(
        FONT_FACE_SPECS.map((spec) =>
          fetch(spec.url, { signal: ac.signal }).then((r) => r.arrayBuffer()),
        ),
      );
      // Same undici-empty-body guard as toDocx — fall through to fs when
      // every fetched buffer is zero-length.
      if (bufs.every((b) => b.byteLength > 0)) {
        return bufs.map((b, i) => renderFace(b, FONT_FACE_SPECS[i]!)).join('\n');
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    /* fall through to Node fs path */
  }

  // Node path — read from disk. Guarded so Vite tree-shakes `fs` for the
  // browser bundle.
  if (typeof window === 'undefined') {
    try {
      const { readFileSync } = await import('node:fs');
      const { fileURLToPath } = await import('node:url');
      const bytes = FONT_FACE_SPECS.map((spec) =>
        new Uint8Array(readFileSync(fileURLToPath(spec.url))),
      );
      return bytes.map((b, i) => renderFace(b, FONT_FACE_SPECS[i]!)).join('\n');
    } catch {
      return '';
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Bundled reader stylesheet — trimmed subset of toEpub's paper.css. Inline
// so the file is portable (single-file distribution, no CDN dependency).
// ---------------------------------------------------------------------------

function buildReaderCss(fontFaces: string): string {
  // Inline reader-CSS spacing is the HTML-channel column of the
  // spacing-translation spec (~/docs/paperflow/specs/2026-05-20-spacing-
  // translation.html): body 12pt before / 0 after / 1.55 line-height,
  // heading scale 28/22/18pt with locked top + bottom margins, list-item
  // 4pt override, hairline 0.75pt #D8D1BF divider, callout padding 12/16pt.
  return `${fontFaces}
html,body{margin:0;padding:0;font-family:'Source Serif 4',Georgia,'Times New Roman',serif;color:#1f1a14;background:#fbfaf6;font-size:11pt;line-height:1.55}
body{max-width:36em;margin:0 auto;padding:1.5em 1em 3em;font-family:'Source Serif 4',Georgia,'Times New Roman',serif}
h1,h2,h3,h4,h5,h6{font-family:'Source Serif 4',Georgia,'Times New Roman',serif;font-weight:700;line-height:1.25;color:#1f1a14}
h1{font-size:28pt;margin:24pt 0 6pt}h2{font-size:22pt;margin:18pt 0 4pt}h3{font-size:18pt;margin:12pt 0 2pt}h4{font-size:13pt;margin:10pt 0 2pt}h5{font-size:12pt;margin:8pt 0 2pt}h6{font-size:11pt;margin:8pt 0 2pt;text-transform:uppercase;letter-spacing:.04em}
p{margin:12pt 0 0;text-align:left}
a{color:#a23925;text-decoration:underline}
ul,ol{margin:12pt 0 0 1.6em;padding:0}li{margin:4pt 0 0}
hr{border:0;border-top:0.75pt solid #d8d1bf;margin:12pt 0 0}
pre.paper-code{background:#f5f2e9;border:1px solid #d8d1bf;border-radius:4px;padding:.8em 1em;font-family:Consolas,"SF Mono",Menlo,monospace;font-size:.9em;overflow-x:auto;white-space:pre-wrap;line-height:1.45}
code{background:#efede6;padding:.05em .3em;border-radius:3px;font-family:Consolas,"SF Mono",Menlo,monospace;font-size:.92em}
aside.paper-callout{border-left:4px solid #374151;background:#f3f4f6;padding:12pt 16pt;margin:12pt 0 0;border-radius:0 4px 4px 0}
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
  // Base64-embed the four SourceSerif4 TTFs as @font-face rules inside
  // the bundled <style> block. See `loadInlineFontFaces` for the spec
  // pointer and the test-environment fallback.
  const fontFaces = await loadInlineFontFaces();

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
    `<style>\n${buildReaderCss(fontFaces)}\n</style>\n` +
    `</head>\n` +
    `<body>\n` +
    `${body}\n` +
    `</body>\n` +
    `</html>\n`;

  return new Blob([html], { type: HTML_MIME });
}
