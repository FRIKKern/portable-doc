import { describe, expect, it } from 'vitest';
import stringWidth from 'string-width';
import { composeDocument } from '@portable-doc/primitives';
import { incident, welcome } from '@portable-doc/fixtures';
import type { PortableDoc } from '@portable-doc/core';
import { renderInk } from './render.js';
import type { InkRenderOptions } from './render.js';

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
