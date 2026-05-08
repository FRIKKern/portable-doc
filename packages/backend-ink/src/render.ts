/**
 * Pd-tree → ANSI-styled terminal text. Pure string output. NO React/Ink runtime.
 *
 * "Works at 80, ugly under 60" (grill Q4). Width caps to min(opts.width ?? 80, 80).
 * supports-color resolves depth when undefined; mono mode strips ALL escapes
 * (CSI styles AND OSC-8 hyperlinks) so output is clean for redirected pipes.
 */

import { tonePalette } from '@portable-doc/core';
import type { TuiColorName } from '@portable-doc/core';
import type { PdNode, PdTextNode } from '@portable-doc/primitives';
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import supportsColor from 'supports-color';
import { codes, osc8, wrapColor, wrapStyle } from './ansi.js';

export interface InkRenderOptions {
  width?: number;
  colorDepth?: 'truecolor' | '256' | '16' | 'mono';
  hyperlinks?: boolean;
}

interface Ctx { width: number; color: boolean; hyperlinks: boolean }

const BORDERS = {
  single: ['╭', '╮', '╰', '╯', '─', '│'],
  double: ['╔', '╗', '╚', '╝', '═', '║'],
  bold:   ['┏', '┓', '┗', '┛', '━', '┃'],
} as const;

const TONE_GLYPH = { success: '✓', warning: '⚠', danger: '✗', info: 'ℹ', neutral: '•' } as const;
const TUI_NAMES: ReadonlyArray<TuiColorName> =
  ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'gray'];

export function renderInk(root: PdNode, opts: InkRenderOptions = {}): string {
  const depth = opts.colorDepth ?? detectDepth();
  const mono = depth === 'mono';
  return r(root, {
    width: Math.min(opts.width ?? 80, 80),
    color: !mono,
    hyperlinks: !mono && opts.hyperlinks !== false,
  });
}

function detectDepth(): InkRenderOptions['colorDepth'] {
  const s = supportsColor.stdout;
  if (!s) return 'mono';
  return s.has16m ? 'truecolor' : s.has256 ? '256' : '16';
}

function r(n: PdNode, c: Ctx): string {
  switch (n.kind) {
    case 'PdContainer': {
      const inner: Ctx = { ...c, width: Math.min(n.maxWidth ?? c.width, c.width) };
      return n.children.map((k) => r(k, inner)).join('\n\n');
    }
    case 'PdBox': {
      const sep = n.style?.flexDirection === 'row' ? '' : '\n';
      const body = n.children.map((k) => r(k, c)).join(sep);
      return n.style?.borderStyle ? frame(body, BORDERS[n.style.borderStyle], c.width) : body;
    }
    case 'PdText':       return text(n, c);
    case 'PdLink': {
      const label = n.children.map((k) => typeof k === 'string' ? k : r(k, c)).join('');
      if (!c.hyperlinks) return `[${label}](${n.href})`;
      return osc8(n.href, c.color ? wrapStyle(codes.underline, label) : label);
    }
    case 'PdInlineCode': return c.color ? wrapStyle(codes.inverse, ` ${n.value} `) : `\`${n.value}\``;
    case 'PdButton': {
      const lbl = `[ ${n.label} ]`;
      const styled = !c.color ? lbl
        : n.priority === 'primary' ? wrapStyle(codes.inverse, wrapStyle(codes.bold, lbl))
        : wrapStyle(codes.underline, lbl);
      return c.hyperlinks ? osc8(n.href, styled) : `${styled}(${n.href})`;
    }
    case 'PdHr':         return '─'.repeat(c.width);
    case 'PdImage':      return `[image: ${n.alt}]`;
    case 'PdTable':      return table(n.rows, c);
    case 'PdCallout':    return callout(n.tone, n.title, n.children, c);
    default: { const _x: never = n; throw new Error(`renderInk: unhandled ${(_x as { kind: string }).kind}`); }
  }
}

function text(n: PdTextNode, c: Ctx): string {
  let s = n.children.map((k) => typeof k === 'string' ? k : r(k, c)).join('');
  if (c.color) {
    if (n.weight === 'bold') s = wrapStyle(codes.bold, s);
    if (n.italic)            s = wrapStyle(codes.italic, s);
    if (n.underline)         s = wrapStyle(codes.underline, s);
    if (n.strike)            s = wrapStyle(codes.strike, s);
    if (n.color && (TUI_NAMES as readonly string[]).includes(n.color)) {
      s = wrapColor(n.color as TuiColorName, s);
    }
  }
  return wrapAnsi(s, c.width, { hard: false, trim: false });
}

function frame(body: string, b: readonly [string, string, string, string, string, string], w: number): string {
  const [tl, tr, bl, br, h, v] = b;
  const iw = Math.max(1, w - 2);
  const lines = wrapAnsi(body, iw, { hard: true, trim: false }).split('\n').map((l) =>
    `${v}${l}${' '.repeat(Math.max(0, iw - stringWidth(l)))}${v}`);
  return [`${tl}${h.repeat(iw)}${tr}`, ...lines, `${bl}${h.repeat(iw)}${br}`].join('\n');
}

function table(rows: PdNode[][][], c: Ctx): string {
  if (rows.length === 0) return '';
  const grid = rows.map((row) => row.map((cell) => cell.map((n) => r(n, c)).join('')));
  const cols = Math.max(...grid.map((g) => g.length));
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.max(1, ...grid.map((g) => stringWidth(g[i] ?? ''))));
  const renderRow = (row: string[]): string =>
    widths.map((w, i) => (row[i] ?? '') + ' '.repeat(Math.max(0, w - stringWidth(row[i] ?? '')))).join(' │ ');
  const out: string[] = [];
  const head = grid[0];
  if (head) {
    out.push(renderRow(head));
    out.push(widths.map((w) => '─'.repeat(w)).join('─┼─'));
  }
  for (let i = 1; i < grid.length; i++) out.push(renderRow(grid[i] ?? []));
  return out.join('\n');
}

function callout(tone: keyof typeof TONE_GLYPH, title: string | undefined, kids: PdNode[], c: Ctx): string {
  const pal = tonePalette[tone];
  const head = `${TONE_GLYPH[tone]}${title ? ` ${title}` : ''}`;
  const titleLine = `╭─ ${c.color ? wrapColor(pal.tuiFg, head) : head}`;
  const inner: Ctx = { ...c, width: Math.max(1, c.width - 2) };
  const rule = c.color ? wrapColor(pal.tuiFg, '│') : '│';
  const body = kids.map((k) => r(k, inner)).join('\n').split('\n').map((l) => `${rule} ${l}`);
  return [titleLine, ...body, '╰─'].join('\n');
}
