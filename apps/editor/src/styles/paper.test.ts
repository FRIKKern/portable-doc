// @vitest-environment jsdom
/**
 * A1 — smoke tests for paper.css.
 *
 *   1. The file exists on disk and imports motion.css (import path resolves).
 *   2. It declares the locked :root variables from T1 + T3 (~30 names).
 *   3. The @media (prefers-reduced-motion: reduce) block collapses every
 *      motion-* token to 0ms. Asserted by reading the CSS text — happy-dom /
 *      jsdom doesn't fully evaluate cascading custom properties under the
 *      media query, so we check the rule text directly.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PAPER_CSS = path.resolve(__dirname, 'paper.css');
const MOTION_CSS = path.resolve(__dirname, 'motion.css');

describe('paper.css — A1 stylesheet smoke tests', () => {
  it('paper.css exists on disk', () => {
    const st = statSync(PAPER_CSS);
    expect(st.isFile()).toBe(true);
    expect(st.size).toBeGreaterThan(500);
  });

  it('imports motion.css via @import (the import path resolves)', () => {
    const css = readFileSync(PAPER_CSS, 'utf8');
    expect(css).toMatch(/@import\s+['"]\.\/motion\.css['"]\s*;/);
    // The referenced sibling file must exist.
    expect(statSync(MOTION_CSS).isFile()).toBe(true);
  });

  it('declares the locked T1 typography :root variables verbatim', () => {
    const css = readFileSync(PAPER_CSS, 'utf8');
    const T1_VARS = [
      '--paper-font-serif',
      '--paper-font-sans',
      '--paper-font-mono',
      '--paper-font-size-body',
      '--paper-font-size-h1',
      '--paper-font-size-h2',
      '--paper-font-size-h3',
      '--paper-font-size-small',
      '--paper-line-height-body',
      '--paper-line-height-heading',
      '--paper-letter-spacing-body',
    ];
    for (const v of T1_VARS) {
      expect(css).toContain(`${v}:`);
    }
  });

  it('declares the locked T3 layout :root variables verbatim', () => {
    const css = readFileSync(PAPER_CSS, 'utf8');
    const T3_VARS = [
      '--paper-column-max',
      '--paper-padding-side-md',
      '--paper-padding-side-sm',
      '--paper-padding-side-xs',
      '--paper-padding-top-md',
      '--paper-padding-top-sm',
      '--paper-padding-top-xs',
      '--paper-footer-height',
      '--paper-overlay-inset-md',
      '--paper-overlay-inset-sm',
      '--paper-overlay-inset-xs',
      '--paper-outline-rail-width',
      '--paper-slash-popover-width',
      '--paper-bubble-menu-touch',
      '--paper-breakpoint-sm',
      '--paper-breakpoint-md',
    ];
    for (const v of T3_VARS) {
      expect(css).toContain(`${v}:`);
    }
  });

  it('declares the prototype warm-cream palette (incl. --paper-accent-warm-rust)', () => {
    const css = readFileSync(PAPER_CSS, 'utf8');
    // Locked palette values from the prototype.
    expect(css).toMatch(/--paper-bg:\s*#fbfaf6/i);
    expect(css).toMatch(/--paper-accent-warm-rust:\s*#a23925/i);
    expect(css).toMatch(/--paper-ink:\s*#1f1a14/i);
  });

  it('every class declared in the file uses the .paper- prefix', () => {
    const css = readFileSync(PAPER_CSS, 'utf8');
    // Strip the comment blocks + the @import url + @font-face src urls so
    // we don't false-positive on ".css" / ".woff2" file extensions in strings.
    const stripped = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/url\([^)]*\)/g, '')
      .replace(/@import\s+['"][^'"]+['"]\s*;/g, '');

    // Find class selectors only at selector positions — i.e. preceded by a
    // selector boundary (start of line, whitespace, comma, `>`, `~`, `+`, or
    // an opening brace's whitespace). This avoids catching file extensions
    // and unit-suffixed numbers like `1.5em`.
    const classMatches =
      stripped.match(/(?:^|[\s,>+~])(\.[a-zA-Z][\w-]*)/gm) ?? [];
    const userClasses = classMatches
      .map((s) => s.trim().match(/\.[a-zA-Z][\w-]*/)?.[0] ?? '')
      .filter((c) => c.length > 0)
      // ProseMirror's own class names appear in nested rules; those are
      // TipTap's namespace, not ours — allowlist them.
      .filter(
        (c) =>
          c !== '.ProseMirror' &&
          c !== '.is-editor-empty' &&
          // prosemirror-tables' selection class (set on the active <th>/<td>
          // by the table plugin). Used by our `.ProseMirror .selectedCell`
          // rule for the cell-focus accent.
          c !== '.selectedCell' &&
          // `@tiptap/extension-placeholder` sets `.is-empty` on the empty
          // first-current top-level node. Our placeholder hint rule keys
          // off this third-party class in the `.ProseMirror` scope.
          c !== '.is-empty' &&
          // `@tiptap/react`'s ReactRenderer wraps each NodeView in
          // `<div class="react-renderer node-<type>">`. Our placeholder
          // hint targets `.react-renderer.is-empty[data-placeholder]`.
          c !== '.react-renderer' &&
          // `tiptap-extension-global-drag-handle` renders the handle
          // with a fixed `.drag-handle` class (and toggles `.hide` to
          // dismiss it). We style both here without renaming — those
          // are the canonical hooks Novel and other community editors
          // also style.
          c !== '.drag-handle' &&
          c !== '.hide',
      );

    for (const cls of userClasses) {
      expect(cls.startsWith('.paper-')).toBe(true);
    }
  });

  it('@media (prefers-reduced-motion: reduce) collapses every motion-* token to 0ms', () => {
    const css = readFileSync(PAPER_CSS, 'utf8');
    // Pull out the @media block body. The regex is intentionally permissive
    // about whitespace + brace nesting (one inner `:root { ... }` block).
    const match = css.match(
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(match).toBeTruthy();
    const body = match?.[1] ?? '';
    // Each motion token resolves to 0ms inside this block.
    const TOKENS = [
      '--motion-chrome-fade-in',
      '--motion-chrome-fade-out',
      '--motion-slash-menu-open',
      '--motion-bubble-menu-open',
      '--motion-drop-indicator',
      '--motion-variant-chip-expand',
      '--motion-outline-slide',
      '--motion-preview-overlay-open',
      '--motion-preview-overlay-close',
      '--motion-footer-sheet-slide',
    ];
    for (const t of TOKENS) {
      // Match `--foo: 0ms;` with flexible whitespace.
      const re = new RegExp(`${t.replace(/-/g, '\\-')}\\s*:\\s*0ms\\s*;`);
      expect(body).toMatch(re);
    }
  });
});
