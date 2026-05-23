/**
 * Pd-tree → inline-styled HTML string. Pure string emission. NO React, NO JSX,
 * NO react-native-web — server stays slim per spec §6 / grill Q5.
 *
 * Output is byte-comparable to the email backend (T7) by sticking to inline
 * styles only (no `<style>` blocks, no class selectors), so the editor's
 * react-native-web preview can line up with this output.
 */

import { tonePalette } from '@portable-doc/core';
import type { Block } from '@portable-doc/core';
import { composeBlock } from '@portable-doc/primitives';
import type {
  PdBoxNode,
  PdButtonNode,
  PdCalloutNode,
  PdContainerNode,
  PdHrNode,
  PdImageNode,
  PdLinkNode,
  PdNode,
  PdStyle,
  PdTableNode,
  PdTextNode,
} from '@portable-doc/primitives';
import { escapeAttr, escapeHtml, safeUrl } from './escape.js';

export interface HtmlRenderOptions {
  doctype?: boolean;
  containerWidth?: number;
}

// Font names are wrapped in single quotes inside CSS so the surrounding
// double-quoted style attribute stays valid HTML. (Embedding `"SF Pro Text"`
// directly would terminate the attribute at the first `"`.)
const FONT_BODY =
  "-apple-system,'SF Pro Text',system-ui,sans-serif";
const FONT_MONO = 'ui-monospace,Menlo,monospace';
const BRAND = '#4f46e5';
const BRAND_TEXT = '#ffffff';
const RULE = '#e5e7eb';
const PAGE_BG = '#f9fafb';

export function renderHtml(root: PdNode, opts: HtmlRenderOptions = {}): string {
  const width = opts.containerWidth ?? 600;
  const body = walk(root, width);
  if (opts.doctype === false) return body;
  return (
    '<!doctype html><html><head><meta charset="utf-8"></head>' +
    `<body style="background:${PAGE_BG};margin:0;padding:0;">` +
    body +
    '</body></html>'
  );
}

/**
 * Render a single block to a bare HTML fragment — no `<!doctype>`, no `<html>`,
 * no container `<div max-width>`.
 *
 * Bypasses `composeDocument`'s `PdContainer` wrap by composing the block
 * directly via `composeBlock`, and suppresses the document chrome via
 * `doctype:false`. The emitted string is byte-identical to the corresponding
 * fragment inside a full-document `renderHtml` run for the same block.
 *
 * Note: a `section` block still carries its own leading/trailing `PdHr` rules —
 * those live inside the block's own composed sub-tree, not in the document
 * chrome, so they survive here by design.
 */
export function renderBlockHtml(
  block: Block,
  opts: HtmlRenderOptions = {},
): string {
  return renderHtml(composeBlock(block), { ...opts, doctype: false });
}

function walk(n: PdNode, width: number): string {
  switch (n.kind) {
    case 'PdContainer':   return container(n, width);
    case 'PdBox':         return box(n, width);
    case 'PdText':        return text(n, width);
    case 'PdLink':        return link(n, width);
    case 'PdInlineCode':  return `<code style="background:#f3f4f6;padding:2px 6px;font-family:${FONT_MONO};font-size:0.95em">${escapeHtml(n.value)}</code>`;
    case 'PdButton':      return button(n);
    case 'PdHr':          return hr(n);
    case 'PdImage':       return image(n);
    case 'PdTable':       return table(n, width);
    case 'PdCallout':     return callout(n, width);
    default: { const _x: never = n; throw new Error(`renderHtml: unhandled ${(_x as { kind: string }).kind}`); }
  }
}

function container(n: PdContainerNode, width: number): string {
  const w = Math.min(n.maxWidth ?? width, width);
  const inner = n.children.map((k) => walk(k, w)).join('');
  return `<div style="max-width:${w}px;margin:0 auto;padding:24px;font-family:${FONT_BODY};color:#111827;background:#ffffff">${inner}</div>`;
}

function box(n: PdBoxNode, width: number): string {
  const inner = n.children.map((k) => walk(k, width)).join('');
  return `<div style="${boxStyle(n.style)}">${inner}</div>`;
}

function boxStyle(s: PdStyle | undefined): string {
  if (!s) return '';
  const out: string[] = [];
  if (s.flexDirection) { out.push('display:flex'); out.push(`flex-direction:${s.flexDirection}`); }
  if (s.width !== undefined) out.push(`width:${s.width}px`);
  if (s.padding !== undefined) out.push(`padding:${s.padding}px`);
  if (s.margin !== undefined) out.push(`margin:${s.margin}px`);
  if (s.borderWidth !== undefined && s.borderColor && s.borderStyle) {
    out.push(`border:${s.borderWidth}px ${cssBorderStyle(s.borderStyle)} ${s.borderColor}`);
  }
  if (s.backgroundColor) out.push(`background-color:${s.backgroundColor}`);
  if (s.verticalAlign) out.push(`vertical-align:${s.verticalAlign === 'middle' ? 'middle' : s.verticalAlign}`);
  return out.join(';');
}

function cssBorderStyle(b: PdStyle['borderStyle']): string {
  if (b === 'double') return 'double';
  // 'single' and 'bold' both map to solid in HTML; thickness conveys bold-ness.
  return 'solid';
}

function text(n: PdTextNode, width: number): string {
  const inner = n.children.map((k): string => {
    if (typeof k === 'string') return escapeHtml(k);
    return walk(k, width);
  }).join('');
  const out: string[] = [];
  if (n.weight === 'bold') out.push('font-weight:bold');
  if (n.italic)            out.push('font-style:italic');
  const deco: string[] = [];
  if (n.underline) deco.push('underline');
  if (n.strike)    deco.push('line-through');
  if (deco.length > 0) out.push(`text-decoration:${deco.join(' ')}`);
  if (n.color)     out.push(`color:${n.color}`);
  return out.length === 0 ? `<span>${inner}</span>` : `<span style="${out.join(';')}">${inner}</span>`;
}

function link(n: PdLinkNode, width: number): string {
  const inner = n.children.map((k): string => {
    if (typeof k === 'string') return escapeHtml(k);
    return walk(k, width);
  }).join('');
  return `<a href="${safeUrl(n.href)}" style="color:#1d4ed8;text-decoration:underline">${inner}</a>`;
}

function button(n: PdButtonNode): string {
  const label = escapeHtml(n.label);
  const href = safeUrl(n.href);
  if (n.priority === 'primary') {
    return `<a href="${href}" style="display:inline-block;padding:10px 20px;background:${BRAND};color:${BRAND_TEXT};text-decoration:none;font-weight:bold;border-radius:0">${label}</a>`;
  }
  return `<a href="${href}" style="display:inline-block;padding:10px 20px;border:2px solid ${BRAND};color:${BRAND};text-decoration:none;font-weight:bold;border-radius:0">${label}</a>`;
}

function hr(n: PdHrNode): string {
  const t = n.thickness ?? 1;
  return `<hr style="border:none;border-top:${t}px solid ${RULE};margin:16px 0">`;
}

function image(n: PdImageNode): string {
  const dims =
    (n.width !== undefined ? ` width="${n.width}"` : '') +
    (n.height !== undefined ? ` height="${n.height}"` : '');
  return `<img src="${safeUrl(n.src)}" alt="${escapeAttr(n.alt)}" style="max-width:100%;height:auto"${dims}>`;
}

function table(n: PdTableNode, width: number): string {
  const rows = n.rows.map((row) => {
    const cells = row.map((cell) => {
      const inner = cell.map((k) => walk(k, width)).join('');
      return `<td style="border:1px solid ${RULE};padding:8px 12px;vertical-align:top">${inner}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<table role="presentation" style="border-collapse:collapse;width:100%">${rows}</table>`;
}

function callout(n: PdCalloutNode, width: number): string {
  const pal = tonePalette[n.tone];
  const titleHtml = n.title ? `<strong>${escapeHtml(n.title)}</strong> ` : '';
  const inner = n.children.map((k) => walk(k, width)).join('');
  return `<div style="border-left:4px solid ${pal.fg};background:${pal.bg};padding:16px;color:${pal.fg}">${titleHtml}${inner}</div>`;
}
