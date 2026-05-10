import { describe, expect, it } from 'vitest';
import stringWidth from 'string-width';
import { composeDocument } from '@portable-doc/primitives';
import { incident, welcome } from '@portable-doc/fixtures';
import type { PortableDoc } from '@portable-doc/core';
import { highlightCode, renderInk } from './render.js';
import type { InkRenderOptions } from './render.js';
import { resolveColorFg, resolveColorBg } from './ansi.js';

const MONO: InkRenderOptions = { colorDepth: 'mono' };
const NO_LINKS: InkRenderOptions = { colorDepth: 'mono', hyperlinks: false };

const stripAnsi = (s: string): string =>
  // eslint-disable-next-line no-control-regex
  s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\]8;;[^\x07]*\x07/g, '');

const visibleWidth = (s: string): number => stringWidth(stripAnsi(s));

// ---------------------------------------------------------------------------
// 1–5. Snapshot suite
// ---------------------------------------------------------------------------

describe('renderInk — snapshots', () => {
  it('welcome fixture, default options (mono for stable snapshots)', () => {
    const out = renderInk(composeDocument(welcome), MONO);
    expect(out).toMatchSnapshot();
  });

  it('incident fixture, default options (mono)', () => {
    const out = renderInk(composeDocument(incident), MONO);
    expect(out).toMatchSnapshot();
  });

  it('incident fixture at width 60 wraps narrower', () => {
    const wide = renderInk(composeDocument(incident), MONO);
    const narrow = renderInk(composeDocument(incident), { ...MONO, width: 60 });
    expect(narrow).toMatchSnapshot();
    // Spec §6 / grill Q4 — "works at 80, ugly under 60". Wrapping kicks in
    // (most lines fit in 60), but un-wrappable atoms (long URLs in plaintext
    // hyperlink fallback) may overflow. The narrow render must differ from
    // the 80-col render and have a smaller dominant line length.
    expect(narrow).not.toBe(wide);
    const longestVisible = (s: string): number =>
      Math.max(...s.split('\n').map(visibleWidth));
    expect(longestVisible(narrow)).toBeLessThanOrEqual(longestVisible(wide));
  });

  it('incident fixture mono mode contains no ANSI escapes', () => {
    const out = renderInk(composeDocument(incident), MONO);
    expect(out).not.toMatch(/\x1b\[[0-9;]*m/);
    expect(out).not.toMatch(/\x1b\]8;;/);
    expect(out).toMatchSnapshot();
  });

  it('incident fixture without hyperlinks falls back to plaintext', () => {
    const out = renderInk(composeDocument(incident), NO_LINKS);
    expect(out).not.toMatch(/\x1b\]8;;/);
    // The secondary action should appear as `[ Label ](href)` plaintext.
    expect(out).toMatch(/\[ View incident dashboard \]\(https:\/\//);
    expect(out).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// 6. Determinism
// ---------------------------------------------------------------------------

describe('renderInk — determinism', () => {
  it('same input produces deeply equal string', () => {
    const a = renderInk(composeDocument(welcome), MONO);
    const b = renderInk(composeDocument(welcome), MONO);
    expect(a).toBe(b);
  });

  it('determinism holds in colored mode too', () => {
    const opts: InkRenderOptions = { colorDepth: '16' };
    const a = renderInk(composeDocument(incident), opts);
    const b = renderInk(composeDocument(incident), opts);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// 7. Heading bold escape present in colored mode
// ---------------------------------------------------------------------------

describe('renderInk — text styling', () => {
  it('a bold heading emits the bold ANSI escape \\x1b[1m', () => {
    const doc: PortableDoc = {
      version: 1,
      title: 't',
      preview: 'p',
      blocks: [{ id: 'h', type: 'heading', level: 1, text: 'Hello' }],
    };
    const out = renderInk(composeDocument(doc), { colorDepth: '16' });
    expect(out).toMatch(/\x1b\[1m/);
    expect(out).toContain('Hello');
  });

  it('mono mode strips bold escape', () => {
    const doc: PortableDoc = {
      version: 1,
      title: 't',
      preview: 'p',
      blocks: [{ id: 'h', type: 'heading', level: 1, text: 'Hello' }],
    };
    const out = renderInk(composeDocument(doc), MONO);
    expect(out).not.toMatch(/\x1b\[1m/);
    expect(out).toContain('Hello');
  });
});

// ---------------------------------------------------------------------------
// 8. Callout tone color
// ---------------------------------------------------------------------------

describe('renderInk — callout tone', () => {
  it('danger callout contains the red ANSI escape \\x1b[31m', () => {
    const out = renderInk(composeDocument(incident), { colorDepth: '16' });
    expect(out).toMatch(/\x1b\[31m/);
  });

  it('success callout in welcome contains the green ANSI escape \\x1b[32m', () => {
    const out = renderInk(composeDocument(welcome), { colorDepth: '16' });
    expect(out).toMatch(/\x1b\[32m/);
  });
});

// ---------------------------------------------------------------------------
// 9. Button OSC-8 wrap
// ---------------------------------------------------------------------------

describe('renderInk — button OSC-8', () => {
  it('primary action wraps href with OSC-8 hyperlink', () => {
    const out = renderInk(composeDocument(welcome), { colorDepth: '16' });
    expect(out).toContain('\x1b]8;;https://example.com/workspace\x07');
    expect(out).toContain('\x1b]8;;\x07'); // closing
  });

  it('mono + no hyperlinks reverts to "[ Label ](href)"', () => {
    const out = renderInk(composeDocument(welcome), NO_LINKS);
    expect(out).toMatch(/\[ Open workspace \]\(https:\/\/example\.com\/workspace\)/);
  });
});

// ---------------------------------------------------------------------------
// 10. Image placeholder
// ---------------------------------------------------------------------------

describe('renderInk — image placeholder', () => {
  it('emits "[image: <alt>]" for a PdImage node', () => {
    const out = renderInk(composeDocument(incident), MONO);
    expect(out).toContain('[image: DB CPU graph showing failover spike]');
  });
});

// ---------------------------------------------------------------------------
// 11. Table separators + header rule
// ---------------------------------------------------------------------------

describe('renderInk — table', () => {
  it('renders columns separated by │ and a dashed header rule', () => {
    const out = renderInk(composeDocument(incident), MONO);
    expect(out).toMatch(/Metric\s+│\s+Threshold\s+│\s+Actual/);
    // Header rule contains ─ and the ─┼─ joiner.
    expect(out).toMatch(/─┼─/);
  });
});

// ---------------------------------------------------------------------------
// 12. Width default 80 — longest non-wrapped line ≤ 80 cells
// ---------------------------------------------------------------------------

describe('renderInk — width default', () => {
  it('no line in mono welcome output exceeds 80 cells', () => {
    const out = renderInk(composeDocument(welcome), MONO);
    const longest = Math.max(...out.split('\n').map(visibleWidth));
    expect(longest).toBeLessThanOrEqual(80);
  });

  it('no line in mono incident output exceeds 80 cells', () => {
    const out = renderInk(composeDocument(incident), MONO);
    const longest = Math.max(...out.split('\n').map(visibleWidth));
    expect(longest).toBeLessThanOrEqual(80);
  });
});

// ---------------------------------------------------------------------------
// 13. Callout glyph by tone
// ---------------------------------------------------------------------------

describe('renderInk — callout glyphs', () => {
  it('success → ✓, danger → ✗', () => {
    const w = renderInk(composeDocument(welcome), MONO);
    expect(w).toContain('✓');
    const i = renderInk(composeDocument(incident), MONO);
    expect(i).toContain('✗');
  });
});

// ---------------------------------------------------------------------------
// 14. Inline code styling
// ---------------------------------------------------------------------------

describe('renderInk — inline code', () => {
  it('mono mode renders inline code with backticks', () => {
    const doc: PortableDoc = {
      version: 1,
      title: 't',
      preview: 'p',
      blocks: [
        {
          id: 'p',
          type: 'paragraph',
          content: [
            { type: 'text', value: 'run ' },
            { type: 'code', value: 'pnpm install' },
          ],
        },
      ],
    };
    const out = renderInk(composeDocument(doc), MONO);
    expect(out).toContain('`pnpm install`');
  });

  it('colored mode wraps inline code in inverse escape \\x1b[7m', () => {
    const doc: PortableDoc = {
      version: 1,
      title: 't',
      preview: 'p',
      blocks: [
        {
          id: 'p',
          type: 'paragraph',
          content: [{ type: 'code', value: 'pnpm install' }],
        },
      ],
    };
    const out = renderInk(composeDocument(doc), { colorDepth: '16' });
    expect(out).toMatch(/\x1b\[7m/);
  });
});

// ---------------------------------------------------------------------------
// 15. Plaintext content matches stripped colored content
// ---------------------------------------------------------------------------

describe('renderInk — color is purely decorative', () => {
  it('stripping ANSI from colored output yields a string with the same words as mono', () => {
    const doc = composeDocument(welcome);
    const colored = renderInk(doc, { colorDepth: '16' });
    const mono = renderInk(doc, MONO);
    // The inline content survives both — pick a few stable strings.
    for (const phrase of [
      'Welcome to Atlas',
      'Setup complete',
      'Open workspace',
      'Read the docs',
    ]) {
      expect(stripAnsi(colored)).toContain(phrase);
      expect(mono).toContain(phrase);
    }
  });
});

// ===========================================================================
// v0.2 — new behaviors. Truecolor degradation, Lipgloss borders, syntax
// highlighting, inline images via env detection, image alt-text fallback.
// ===========================================================================

// ---------------------------------------------------------------------------
// 16. Truecolor depth degradation
// ---------------------------------------------------------------------------

describe('renderInk — truecolor depth degradation', () => {
  it('truecolor mode emits 24-bit fg escape \\x1b[38;2;R;G;Bm for callout tone', () => {
    // tonePalette.danger.fg = '#b91c1c' → 185;28;28
    const out = renderInk(composeDocument(incident), { colorDepth: 'truecolor' });
    expect(out).toMatch(/\x1b\[38;2;185;28;28m/);
  });

  it('256 mode emits 8-bit fg escape \\x1b[38;5;Nm for callout tone', () => {
    const out = renderInk(composeDocument(incident), { colorDepth: '256' });
    expect(out).toMatch(/\x1b\[38;5;\d+m/);
    // Should NOT contain a truecolor sequence at this depth.
    expect(out).not.toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);
  });

  it('16 mode falls back to named-ANSI fg escape (\\x1b[31m for danger)', () => {
    const out = renderInk(composeDocument(incident), { colorDepth: '16' });
    expect(out).toMatch(/\x1b\[31m/);
    expect(out).not.toMatch(/\x1b\[38;2;/);
    expect(out).not.toMatch(/\x1b\[38;5;/);
  });

  it('mono mode strips all color escapes regardless of depth degradation', () => {
    const out = renderInk(composeDocument(incident), MONO);
    expect(out).not.toMatch(/\x1b\[[0-9;]*m/);
  });
});

// ---------------------------------------------------------------------------
// 17. Lipgloss-equivalent border styles
// ---------------------------------------------------------------------------

describe('renderInk — border styles', () => {
  it('single-border PdBox renders rounded corners ╭─╮│╰╯', () => {
    const doc: PortableDoc = {
      version: 1,
      title: 't',
      preview: 'p',
      blocks: [
        {
          id: 's',
          type: 'section',
          title: 'A section',
          blocks: [{ id: 'p', type: 'paragraph', content: [{ type: 'text', value: 'hi' }] }],
        },
      ],
    };
    // The kernel renders sections with horizontal rules above/below — stable
    // path. Construct a PdBox-with-border directly via the renderer to test
    // the BorderStyleRenderer map without coupling to kernel section style.
    const out = renderInk(
      {
        kind: 'PdBox',
        style: { borderStyle: 'single' },
        children: [{ kind: 'PdText', children: ['hello'] }],
      },
      MONO,
    );
    expect(out.split('\n')[0]).toMatch(/^╭[─]+╮$/);
    expect(out.split('\n').at(-1)).toMatch(/^╰[─]+╯$/);
    // Side rails use │
    expect(out).toMatch(/│hello\s*│/);
    void doc; // silence unused
  });

  it('double-border PdBox renders ╔═╗║╚╝', () => {
    const out = renderInk(
      {
        kind: 'PdBox',
        style: { borderStyle: 'double' },
        children: [{ kind: 'PdText', children: ['hello'] }],
      },
      MONO,
    );
    expect(out.split('\n')[0]).toMatch(/^╔[═]+╗$/);
    expect(out.split('\n').at(-1)).toMatch(/^╚[═]+╝$/);
    expect(out).toMatch(/║hello\s*║/);
  });

  it('bold-border PdBox renders ┏━┓┃┗┛', () => {
    const out = renderInk(
      {
        kind: 'PdBox',
        style: { borderStyle: 'bold' },
        children: [{ kind: 'PdText', children: ['hello'] }],
      },
      MONO,
    );
    expect(out.split('\n')[0]).toMatch(/^┏[━]+┓$/);
    expect(out.split('\n').at(-1)).toMatch(/^┗[━]+┛$/);
    expect(out).toMatch(/┃hello\s*┃/);
  });
});

// ---------------------------------------------------------------------------
// 18. Code-block syntax highlighting
// ---------------------------------------------------------------------------

describe('renderInk — code block syntax highlighting', () => {
  it('highlightCode emits ANSI escapes for known languages in colored modes', () => {
    const out = highlightCode('const x = 42;', 'javascript', 'truecolor');
    expect(/\x1b\[/.test(out)).toBe(true);
    // The number literal "42" should be wrapped in some color escape.
    expect(out).toContain('42');
  });

  it('highlightCode is a no-op in mono mode', () => {
    const src = 'const x = 42;';
    expect(highlightCode(src, 'javascript', 'mono')).toBe(src);
  });

  it('highlightCode falls back to plain text on unknown language', () => {
    const src = 'foo bar baz';
    const out = highlightCode(src, 'this-language-does-not-exist', 'truecolor');
    // Either highlight skipped (returned src verbatim) or auto-detect ran;
    // either way the original tokens must survive.
    expect(out).toContain('foo');
    expect(out).toContain('bar');
    expect(out).toContain('baz');
  });

  it('rendering the incident fixture in colored mode highlights the code block', () => {
    // The incident fixture has a bash code block. With cli-highlight + a
    // depth-aware theme, the block should contain at least one ANSI escape
    // beyond the existing callout escapes.
    const colored = renderInk(composeDocument(incident), { colorDepth: 'truecolor' });
    // Strings like "SELECT 1" or "/var/log/incident.log" become highlighted.
    // Look for an escape sequence in proximity to the code-block content.
    const lines = colored.split('\n').filter((l) => l.includes('kubectl') || l.includes('pgcli'));
    expect(lines.length).toBeGreaterThan(0);
    // At least one of the code-block lines must carry an ANSI escape.
    expect(lines.some((l) => /\x1b\[/.test(l))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 19. Inline images — env-driven detection + safe fallback
// ---------------------------------------------------------------------------

describe('renderInk — inline images', () => {
  const imgDoc: PortableDoc = {
    version: 1,
    title: 't',
    preview: 'p',
    blocks: [
      {
        id: 'img',
        type: 'image',
        src: 'https://example.com/pic.png',
        alt: 'a chart',
        surfaces: ['web', 'native'],
      },
    ],
  };

  it('falls back to "[image: alt]" when no inline-graphics env detected', () => {
    const out = renderInk(composeDocument(imgDoc), {
      colorDepth: 'truecolor',
      env: {},
    });
    expect(out).toContain('[image: a chart]');
  });

  it('falls back to "[image: alt]" for HTTP(S) sources even with iTerm2 detected', () => {
    const out = renderInk(composeDocument(imgDoc), {
      colorDepth: 'truecolor',
      env: { TERM_PROGRAM: 'iTerm.app' },
    });
    expect(out).toContain('[image: a chart]');
    // No OSC-1337 sequence — HTTP fetching is not done from here.
    expect(out).not.toMatch(/\x1b\]1337;File=/);
  });

  it('sync renderInk emits placeholder for data: URL even with iTerm2 detected (async path is renderInkAsync)', () => {
    // 1×1 transparent PNG, base64-encoded, embedded in a data URL.
    const onePxPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
    const doc: PortableDoc = {
      version: 1,
      title: 't',
      preview: 'p',
      blocks: [
        {
          id: 'img',
          type: 'image',
          src: onePxPng,
          alt: 'a pixel',
          surfaces: ['web', 'native'],
        },
      ],
    };
    const out = renderInk(composeDocument(doc), {
      colorDepth: 'truecolor',
      env: { TERM_PROGRAM: 'iTerm.app' },
    });
    // Sync path is now placeholder-only — terminal-image is async.
    // No hand-rolled OSC-1337 escape from the sync path.
    expect(out).not.toMatch(/\x1b\]1337;/);
    expect(out).toContain('[image: a pixel]');
  });

  it('Kitty-detected env emits placeholder (sync path is alt-text only)', () => {
    const out = renderInk(composeDocument(imgDoc), {
      colorDepth: 'truecolor',
      env: { KITTY_WINDOW_ID: '42' },
    });
    // Sync placeholder-only contract — Kitty rendering goes through renderInkAsync.
    expect(out).toContain('[image: a chart]');
  });

  it('Kitty-detected env with data: src — sync emits the alt-text placeholder', () => {
    const dataDoc: PortableDoc = {
      version: 1,
      title: 't',
      preview: 'p',
      blocks: [
        {
          id: 'img',
          type: 'image',
          src: 'data:image/png;base64,AAAA',
          alt: 'a pixel',
          surfaces: ['web', 'native'],
        },
      ],
    };
    const out = renderInk(composeDocument(dataDoc), {
      colorDepth: 'truecolor',
      env: { KITTY_WINDOW_ID: '42' },
    });
    // Sync renderInk only emits the alt-text placeholder; renderInkAsync
    // is the path that consumes terminal-image and renders Kitty/iTerm2 inline.
    expect(out).toContain('[image: a pixel]');
    expect(out).not.toMatch(/\x1b\]1337;/);
  });

  it('mono mode never emits inline image escapes even with iTerm2 detected', () => {
    const out = renderInk(composeDocument(imgDoc), {
      colorDepth: 'mono',
      env: { TERM_PROGRAM: 'iTerm.app' },
    });
    expect(out).not.toMatch(/\x1b\]1337;/);
    expect(out).toContain('[image: a chart]');
  });
});

// ---------------------------------------------------------------------------
// 20. Variant-aware rendering — light touch
// ---------------------------------------------------------------------------

describe('renderInk — variant-aware rendering', () => {
  it('callout with variant.emphasis === "bold" uses bold border glyphs', () => {
    // Construct a PdCallout directly with a duck-typed variant attached. The
    // renderer reads it via duck-type so it works whether or not the kernel
    // forwards variant info today.
    const node = {
      kind: 'PdCallout' as const,
      tone: 'info' as const,
      title: 'Heads up',
      children: [{ kind: 'PdText' as const, children: ['body'] }],
      variant: { emphasis: 'bold' },
    };
    const out = renderInk(node, MONO);
    // Bold border uses ┏ for top-left, ┗ for bottom-left.
    expect(out.split('\n')[0]?.startsWith('┏')).toBe(true);
    expect(out.split('\n').at(-1)?.startsWith('┗')).toBe(true);
  });

  it('callout without variant info uses default rounded border glyphs', () => {
    const out = renderInk(composeDocument(incident), MONO);
    // Default callout uses ╭ / ╰ as before.
    const lines = out.split('\n');
    expect(lines.some((l) => l.startsWith('╭'))).toBe(true);
    expect(lines.some((l) => l.startsWith('╰'))).toBe(true);
  });
});

// ===========================================================================
// 21. v0.2.1 — color-depth interface (resolveColorFg / resolveColorBg)
//
// Single deliberate path for every color emission in backend-ink. Replaces
// chalk's accidental named-token theme (cli-highlight pre-v0.2.1 went through
// `chalk.cyan`/`chalk.yellow`, which always degraded to 16-color escapes
// regardless of depth). Both syntax-highlighting and tone resolution funnel
// through this interface so we never silently drop into 16-color escapes on a
// truecolor terminal.
// ===========================================================================

describe('resolveColorFg / resolveColorBg — color-depth interface', () => {
  it('truecolor depth → \\x1b[38;2;R;G;Bm prefix', () => {
    // #047857 = (4, 120, 87) — tonePalette.success.fg
    expect(resolveColorFg('#047857', 'truecolor')).toBe('\x1b[38;2;4;120;87m');
  });

  it('256 depth → \\x1b[38;5;Nm prefix (6×6×6 cube index)', () => {
    const out = resolveColorFg('#047857', '256');
    expect(out).toMatch(/^\x1b\[38;5;\d+m$/);
    // No truecolor escape leaks through.
    expect(out).not.toMatch(/38;2;/);
  });

  it('16 depth → mapped to nearest named ANSI for chromatic input', () => {
    // #ff0000 (255, 0, 0) → bright red (91) by HSV-aware nearest match.
    expect(resolveColorFg('#ff0000', '16')).toBe('\x1b[91m');
    // No higher-depth escape leaks through.
    expect(resolveColorFg('#ff0000', '16')).not.toMatch(/38;2;|38;5;/);
  });

  it('mono depth → empty string (caller falls back to plain text)', () => {
    expect(resolveColorFg('#047857', 'mono')).toBe('');
    expect(resolveColorFg('#ffffff', 'mono')).toBe('');
    expect(resolveColorBg('#047857', 'mono')).toBe('');
  });

  it('resolveColorBg mirrors fg with 48; instead of 38;', () => {
    expect(resolveColorBg('#047857', 'truecolor')).toBe('\x1b[48;2;4;120;87m');
    expect(resolveColorBg('#047857', '256')).toMatch(/^\x1b\[48;5;\d+m$/);
    // 16 mode emits 4Xm or 10Xm — same family as 3Xm/9Xm but +10.
    expect(resolveColorBg('#ff0000', '16')).toBe('\x1b[101m');
  });

  it('unparseable hex returns empty string at every depth', () => {
    expect(resolveColorFg('not-a-hex', 'truecolor')).toBe('');
    expect(resolveColorFg('#xyz', '256')).toBe('');
    expect(resolveColorFg('', '16')).toBe('');
  });

  it('namedFallback (semantic anchor) overrides RGB-nearest at depth 16', () => {
    // Without the anchor, #047857 would land on cyan (closer hue at 163°).
    // With `green` as the semantic fallback, depth 16 emits green (32).
    expect(resolveColorFg('#047857', '16')).not.toBe('\x1b[32m');
    expect(resolveColorFg('#047857', '16', 'green')).toBe('\x1b[32m');
    // The fallback only applies at depth 16 — truecolor still emits the RGB.
    expect(resolveColorFg('#047857', 'truecolor', 'green')).toBe('\x1b[38;2;4;120;87m');
  });
});

describe('renderInk — color-depth interface end-to-end', () => {
  it('truecolor incident render emits 24-bit escapes for syntax tokens (was 16-color before v0.2.1)', () => {
    const colored = renderInk(composeDocument(incident), { colorDepth: 'truecolor' });
    // Syntax tokens MUST emit truecolor escapes now that buildTheme funnels
    // through resolveColorFg. Pre-v0.2.1, cli-highlight's chalk.cyan-style
    // theme could only emit 16-color escapes (\x1b[36m) regardless of depth.
    const truecolorEscapes = colored.match(/\x1b\[38;2;\d+;\d+;\d+m/g) ?? [];
    expect(truecolorEscapes.length).toBeGreaterThan(0);
    // And specifically NOT 16-color escapes for syntax tokens (the bug).
    // Tone resolution may still use 16-color via namedFallback only at depth
    // 16, but at truecolor depth nothing should drop to \x1b[3Xm.
    const sixteenColorEscapes = colored.match(/\x1b\[3[1-7]m/g) ?? [];
    expect(sixteenColorEscapes.length).toBe(0);
  });

  it('16-depth incident render: syntax tokens emit \\x1b[3Xm or \\x1b[9Xm, no truecolor', () => {
    const colored = renderInk(composeDocument(incident), { colorDepth: '16' });
    // No truecolor leaks at depth 16.
    expect(colored).not.toMatch(/\x1b\[38;2;/);
    expect(colored).not.toMatch(/\x1b\[38;5;/);
    // Lines covering the bash code block carry color escapes.
    const codeLines = colored.split('\n').filter((l) => l.includes('kubectl') || l.includes('pgcli'));
    expect(codeLines.length).toBeGreaterThan(0);
    expect(codeLines.some((l) => /\x1b\[(3[0-7]|9[0-7])m/.test(l))).toBe(true);
  });

  it('256-depth incident render: tone + syntax tokens both emit \\x1b[38;5;Nm', () => {
    const colored = renderInk(composeDocument(incident), { colorDepth: '256' });
    expect(colored).toMatch(/\x1b\[38;5;\d+m/);
    expect(colored).not.toMatch(/\x1b\[38;2;/);
  });
});
