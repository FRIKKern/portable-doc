/**
 * Pd-tree → ANSI-styled terminal text. Pure string output. NO React/Ink runtime.
 *
 * v0.2 — Charm/Ink-quality terminal renderer:
 *   - Truecolor (24-bit) primary path. supports-color drives 24-bit → 256 → 16
 *     → mono degradation. Tone resolution uses tonePalette hex directly.
 *   - BorderStyleRenderer maps single/double/bold to Lipgloss-equivalent
 *     glyphs (╭─╮│╰╯ / ╔═╗║╚╝ / ┏━┓┃┗┛).
 *   - Code blocks pass through cli-highlight (lang-tagged or auto-detected)
 *     with a custom chalk@5 theme so coloring is depth-aware, not stuck at
 *     cli-highlight's auto-detected level.
 *   - Inline images: when iTerm2/Kitty/WezTerm is detected via env vars AND
 *     the src is a local file or data: URL, emit the iTerm2 inline image
 *     OSC-1337 sequence (sync, no fetching). Otherwise fall back to
 *     [image: alt]. HTTP URLs always fall back — no network from inside
 *     this package.
 *   - Variant-aware rendering: when a Pd node carries variant info (forwarded
 *     via the kernel from BlockBase.variant), nudge styling accordingly.
 *     Currently a light touch — emphasis=bold callouts get the bold border
 *     style. Kernel forwarding is opt-in: if the field is absent the renderer
 *     falls back to the default styling.
 *
 * "Works at 80, ugly under 60" (grill Q4). Width caps to min(opts.width ?? 80, 80).
 * mono mode strips ALL escapes (CSI styles AND OSC-8 hyperlinks AND OSC-1337
 * inline images) so output is clean for redirected pipes.
 */

import { readFileSync } from 'node:fs';
import { tonePalette } from '@portable-doc/core';
import type { TuiColorName } from '@portable-doc/core';
import type { PdNode, PdTextNode, PdBoxNode } from '@portable-doc/primitives';
import { highlight } from 'cli-highlight';
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import supportsColor from 'supports-color';
import {
  codes,
  osc8,
  resolveColorFg,
  wrapColor,
  wrapStyle,
  type ColorDepth,
} from './ansi.js';

export interface InkRenderOptions {
  width?: number;
  colorDepth?: ColorDepth;
  hyperlinks?: boolean;
  /** Override env detection — primarily for tests. */
  env?: Record<string, string | undefined>;
  /** Force-enable inline images even without env detection (tests). */
  inlineImages?: boolean;
}

interface Ctx {
  width: number;
  color: boolean;
  depth: ColorDepth;
  hyperlinks: boolean;
  env: Record<string, string | undefined>;
  inlineImages: boolean;
}

// ---------------------------------------------------------------------------
// Border styles — Lipgloss-equivalent.
// ---------------------------------------------------------------------------

interface BorderGlyphs {
  tl: string; tr: string; bl: string; br: string; h: string; v: string;
}

const BORDER_STYLES: Record<'single' | 'double' | 'bold', BorderGlyphs> = {
  single: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
  double: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' },
  bold:   { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' },
};

const TONE_GLYPH = { success: '✓', warning: '⚠', danger: '✗', info: 'ℹ', neutral: '•' } as const;
const TUI_NAMES: ReadonlyArray<TuiColorName> =
  ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'gray'];

export function renderInk(root: PdNode, opts: InkRenderOptions = {}): string {
  const depth = opts.colorDepth ?? detectDepth();
  const mono = depth === 'mono';
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const inlineImages = opts.inlineImages ?? detectInlineImages(env);
  return r(root, {
    width: Math.min(opts.width ?? 80, 80),
    color: !mono,
    depth,
    hyperlinks: !mono && opts.hyperlinks !== false,
    env,
    inlineImages: inlineImages && !mono,
  });
}

function detectDepth(): ColorDepth {
  const s = supportsColor.stdout;
  if (!s) return 'mono';
  return s.has16m ? 'truecolor' : s.has256 ? '256' : '16';
}

/**
 * Detect whether the terminal supports an inline-image protocol via env vars.
 * Returns true for iTerm2 / Kitty / WezTerm; false otherwise. We do not actually
 * speak Kitty's protocol in v0.2 — only iTerm2's OSC-1337 — but the detection
 * is shared so the renderer can decide between inline emission and fallback.
 */
function detectInlineImages(env: Record<string, string | undefined>): boolean {
  if (env.TERM_PROGRAM === 'iTerm.app') return true;
  if (env.KITTY_WINDOW_ID) return true;
  if (env.WEZTERM_PANE) return true;
  return false;
}

function r(n: PdNode, c: Ctx): string {
  switch (n.kind) {
    case 'PdContainer': {
      const inner: Ctx = { ...c, width: Math.min(n.maxWidth ?? c.width, c.width) };
      return n.children.map((k) => r(k, inner)).join('\n\n');
    }
    case 'PdBox': {
      // Code-block detection: a column box where every child is a PdText
      // wrapping exactly one PdInlineCode. The kernel emits this shape for
      // CodeBlock; we re-route through cli-highlight when detected.
      const codeBlock = detectCodeBlock(n);
      if (codeBlock) return renderCodeBlock(codeBlock.lines, codeBlock.lang, c);

      const sep = n.style?.flexDirection === 'row' ? '' : '\n';
      const body = n.children.map((k) => r(k, c)).join(sep);
      const style = n.style?.borderStyle;
      return style ? frame(body, BORDER_STYLES[style], c.width) : body;
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
    case 'PdImage':      return image(n.src, n.alt, c);
    case 'PdTable':      return table(n.rows, c);
    case 'PdCallout':    return callout(n.tone, n.title, n.children, c, n);
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

function frame(body: string, b: BorderGlyphs, w: number): string {
  const iw = Math.max(1, w - 2);
  const lines = wrapAnsi(body, iw, { hard: true, trim: false }).split('\n').map((l) =>
    `${b.v}${l}${' '.repeat(Math.max(0, iw - stringWidth(l)))}${b.v}`);
  return [`${b.tl}${b.h.repeat(iw)}${b.tr}`, ...lines, `${b.bl}${b.h.repeat(iw)}${b.br}`].join('\n');
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

/**
 * Light-touch variant consumption. The kernel may eventually attach `variant`
 * to its PdCallout / PdBox emissions (BlockBase.variant flowing through). We
 * read it via a duck-type to avoid a hard dependency on a kernel that hasn't
 * yet shipped variant forwarding. When variant.emphasis === 'bold', the
 * callout uses the bold-weight border. Otherwise default rounded.
 */
function readVariant(n: PdNode | { variant?: Record<string, string> }): Record<string, string> | undefined {
  return (n as { variant?: Record<string, string> }).variant;
}

function callout(
  tone: keyof typeof TONE_GLYPH,
  title: string | undefined,
  kids: PdNode[],
  c: Ctx,
  source: PdNode,
): string {
  const pal = tonePalette[tone];
  const variant = readVariant(source);
  const borderKey: 'single' | 'bold' = variant?.emphasis === 'bold' ? 'bold' : 'single';
  const b = BORDER_STYLES[borderKey];

  // Single color path: tone fg (hex) → resolveColorFg(depth) → ANSI prefix.
  // Same interface used by the syntax-highlighting theme below. The named
  // fallback (`pal.tuiFg`) anchors the 16-color path semantically — keeps
  // "success → green" green at depth 16 even if pure RGB-nearest disagrees.
  const fgPrefix = c.color ? resolveColorFg(pal.fg, c.depth, pal.tuiFg) : '';
  const paint = (s: string): string => (fgPrefix ? `${fgPrefix}${s}${codes.reset}` : s);

  const head = `${TONE_GLYPH[tone]}${title ? ` ${title}` : ''}`;
  const titleLine = `${b.tl}${b.h} ${paint(head)}`;
  const inner: Ctx = { ...c, width: Math.max(1, c.width - 2) };
  const rule = paint(b.v);
  const body = kids.map((k) => r(k, inner)).join('\n').split('\n').map((l) => `${rule} ${l}`);
  return [titleLine, ...body, `${b.bl}${b.h}`].join('\n');
}

// ---------------------------------------------------------------------------
// Code blocks — cli-highlight + custom chalk@5 theme.
// ---------------------------------------------------------------------------

interface CodeBlockShape { lines: string[]; lang: string | undefined }

/**
 * Recognise the kernel's CodeBlock emission shape. The kernel composes
 * a `code` block as a column-direction PdBox of one PdText-per-line, each
 * holding exactly one PdInlineCode child. Anything else is just a regular
 * PdBox and falls through to the default rendering path.
 *
 * Lang is currently lost during kernel composition. We default to `auto`
 * detection. When the kernel one day attaches `lang` to the PdBox, this
 * detector picks it up via duck-type — no breaking change required here.
 */
function detectCodeBlock(box: PdBoxNode): CodeBlockShape | null {
  if (box.style?.flexDirection !== 'column' || box.style?.borderStyle) return null;
  if (box.children.length === 0) return null;
  const lines: string[] = [];
  for (const child of box.children) {
    if (child.kind !== 'PdText') return null;
    if (child.children.length !== 1) return null;
    const inner = child.children[0]!;
    if (typeof inner === 'string') return null;
    if (inner.kind !== 'PdInlineCode') return null;
    lines.push(inner.value);
  }
  const lang = (box as { lang?: string }).lang;
  return { lines, lang };
}

/**
 * Syntax-token → hex map. Every cli-highlight class we want to color lives
 * here as an explicit hex. The theme builder funnels each through
 * `resolveColorFg(hex, depth)` so coloring stays depth-aware (truecolor →
 * 256 → 16 → mono) without ever falling through to chalk's accidental
 * named-token escapes.
 *
 * Hex picks lean on Tailwind v3 stops we already use elsewhere — keeps the
 * palette coherent across surfaces. `default` is the fallback for any
 * highlight.js class not enumerated below (cli-highlight passes through any
 * function-valued key).
 */
const SYNTAX_HEX: Record<string, string> = {
  keyword:        '#0891b2',  // cyan-600
  'selector-tag': '#0891b2',
  literal:        '#2563eb',  // blue-600
  number:         '#a16207',  // yellow-700
  built_in:       '#9333ea',  // purple-600
  type:           '#0891b2',
  string:         '#16a34a',  // green-600
  'meta string':  '#16a34a',
  regexp:         '#dc2626',  // red-600
  symbol:         '#a16207',
  bullet:         '#a16207',
  function:       '#2563eb',  // blue-600
  title:          '#0891b2',
  section:        '#0891b2',
  comment:        '#6b7280',  // gray-500
  quote:          '#6b7280',
  deletion:       '#dc2626',
  addition:       '#16a34a',
  variable:       '#9333ea',
  'meta-keyword': '#9333ea',
  'template-tag': '#9333ea',
  attr:           '#a16207',
  'attr-value':   '#16a34a',
  name:           '#0891b2',
  'tag.name':     '#0891b2',
  meta:           '#6b7280',
  'class .title': '#0891b2',
  params:         '#a16207',
  default:        '#374151',  // gray-700
};

/**
 * Build a depth-aware cli-highlight theme. Each token class wraps text in
 * the resolved ANSI prefix for its hex (or returns the text unchanged in
 * mono mode / when the depth/hex resolves to no prefix).
 */
function buildTheme(depth: ColorDepth): Record<string, (s: string) => string> {
  if (depth === 'mono') {
    const id = (s: string): string => s;
    return new Proxy({}, { get: () => id });
  }
  const theme: Record<string, (s: string) => string> = {};
  for (const [cls, hex] of Object.entries(SYNTAX_HEX)) {
    const prefix = resolveColorFg(hex, depth);
    theme[cls] = prefix
      ? (s: string): string => `${prefix}${s}${codes.reset}`
      : (s: string): string => s;
  }
  return theme;
}

/**
 * Highlight a block of code. Exported so tests can exercise the path
 * directly. Falls back to the unhighlighted text on any throw — cli-highlight
 * can throw on truly unknown languages even with `ignoreIllegals`.
 */
export function highlightCode(value: string, lang: string | undefined, depth: ColorDepth): string {
  if (depth === 'mono') return value;
  try {
    const theme = buildTheme(depth);
    return highlight(value, {
      ...(lang ? { language: lang } : {}),
      ignoreIllegals: true,
      theme,
    });
  } catch {
    return value;
  }
}

function renderCodeBlock(lines: string[], lang: string | undefined, c: Ctx): string {
  const value = lines.join('\n');
  const highlighted = c.color ? highlightCode(value, lang, c.depth) : value;
  // wrap-ansi handles long lines without breaking ANSI escapes.
  return wrapAnsi(highlighted, c.width, { hard: false, trim: false });
}

// ---------------------------------------------------------------------------
// Images — env-detected inline rendering, with safe fallback.
// ---------------------------------------------------------------------------

/**
 * Render an image node. Strategy (kept deliberately simple per the v0.2 plan):
 *   1. If mono, hyperlinks off, or inline images disabled: emit `[image: alt]`.
 *   2. If src is an http(s) URL: always fall back to `[image: alt]`. We do
 *      not perform network I/O from inside backend-ink.
 *   3. If env detection saw iTerm2 (TERM_PROGRAM === iTerm.app) AND src is a
 *      local file path or data: URL: emit the iTerm2 inline image OSC-1337
 *      sequence with the file bytes base64-encoded.
 *   4. Kitty/WezTerm get a placeholder note for now — the OSC sequences are
 *      protocol-specific and the v0.2 plan endorses the simpler path.
 */
function image(src: string, alt: string, c: Ctx): string {
  const fallback = `[image: ${alt}]`;
  if (!c.inlineImages) return fallback;
  if (/^https?:/i.test(src)) return fallback;

  // iTerm2 is the only protocol we emit in v0.2.
  if (c.env.TERM_PROGRAM === 'iTerm.app') {
    try {
      const bytes = readImageSync(src);
      if (!bytes) return fallback;
      const b64 = bytes.toString('base64');
      // OSC 1337;File=inline=1:<base64><BEL>
      return `\x1b]1337;File=inline=1;preserveAspectRatio=1:${b64}\x07`;
    } catch {
      return fallback;
    }
  }

  // Kitty / WezTerm — protocol not implemented in v0.2. Emit a clear
  // placeholder so downstream tooling can see the intent.
  if (c.env.KITTY_WINDOW_ID || c.env.WEZTERM_PANE) {
    return `[image: ${alt} — Kitty/WezTerm inline supported when src is local]`;
  }
  return fallback;
}

function readImageSync(src: string): Buffer | null {
  if (src.startsWith('data:')) {
    const comma = src.indexOf(',');
    if (comma < 0) return null;
    const meta = src.slice(5, comma);
    const payload = src.slice(comma + 1);
    if (meta.endsWith(';base64')) {
      return Buffer.from(payload, 'base64');
    }
    return Buffer.from(decodeURIComponent(payload), 'utf8');
  }
  // Local file path — including `file:` URLs.
  const path = src.startsWith('file:') ? new URL(src).pathname : src;
  return readFileSync(path);
}
