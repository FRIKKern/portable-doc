import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeDocument } from '@portable-doc/primitives';
import { tonePalette } from '@portable-doc/core';
import type { PortableDoc } from '@portable-doc/core';
import type { PdLinkNode, PdNode } from '@portable-doc/primitives';
import { renderHtml } from './render.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/backend-web/src/static/ → repo root is ../../../..
const repoRoot = resolve(here, '../../../..');
const welcome = JSON.parse(
  readFileSync(resolve(repoRoot, 'examples', 'welcome.json'), 'utf8'),
) as PortableDoc;
const incident = JSON.parse(
  readFileSync(resolve(repoRoot, 'examples', 'incident.json'), 'utf8'),
) as PortableDoc;

// ---------------------------------------------------------------------------
// 1–3. Snapshots
// ---------------------------------------------------------------------------

describe('renderHtml — snapshots', () => {
  it('welcome fixture, default options', () => {
    const out = renderHtml(composeDocument(welcome));
    expect(out).toMatchSnapshot();
  });

  it('incident fixture, default options', () => {
    const out = renderHtml(composeDocument(incident));
    expect(out).toMatchSnapshot();
  });

  it('welcome fixture without doctype', () => {
    const out = renderHtml(composeDocument(welcome), { doctype: false });
    expect(out).not.toMatch(/<!doctype/i);
    expect(out).not.toMatch(/<html/);
    expect(out).not.toMatch(/<body/);
    expect(out).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// 4. HTML escaping of text leaves
// ---------------------------------------------------------------------------

describe('renderHtml — HTML escaping', () => {
  it('escapes < > & " \' in text leaves', () => {
    const tree: PdNode = {
      kind: 'PdContainer',
      maxWidth: 600,
      children: [
        {
          kind: 'PdText',
          children: ['<script>alert("xss" & \'pwn\')</script>'],
        },
      ],
    };
    const out = renderHtml(tree, { doctype: false });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('&amp;');
    expect(out).toContain('&quot;');
    expect(out).toContain('&#39;');
  });
});

// ---------------------------------------------------------------------------
// 5–9. URL allowlist
// ---------------------------------------------------------------------------

describe('renderHtml — URL allowlist', () => {
  const wrap = (href: string): PdNode => ({
    kind: 'PdContainer',
    maxWidth: 600,
    children: [
      ({ kind: 'PdLink', href, children: ['x'] } satisfies PdLinkNode),
    ],
  });

  it('javascript: URL collapses to #', () => {
    const out = renderHtml(wrap('javascript:alert(1)' as unknown as string), { doctype: false });
    expect(out).toContain('href="#"');
    expect(out).not.toContain('javascript:');
  });

  it('strips leading whitespace before checking scheme', () => {
    const out = renderHtml(wrap('\tjavascript:alert(1)'), { doctype: false });
    expect(out).toContain('href="#"');
    expect(out).not.toMatch(/href="[^"]*javascript:/);
  });

  it('data: URL collapses to #', () => {
    const out = renderHtml(wrap('data:text/html,<script>alert(1)</script>'), { doctype: false });
    expect(out).toContain('href="#"');
    expect(out).not.toContain('data:');
  });

  it('http URL is preserved', () => {
    const out = renderHtml(wrap('http://example.com/foo'), { doctype: false });
    expect(out).toContain('href="http://example.com/foo"');
  });

  it('https URL is preserved', () => {
    const out = renderHtml(wrap('https://example.com/foo'), { doctype: false });
    expect(out).toContain('href="https://example.com/foo"');
  });

  it('mailto URL is preserved', () => {
    const out = renderHtml(wrap('mailto:a@b.com'), { doctype: false });
    expect(out).toContain('href="mailto:a@b.com"');
  });

  it('tel URL is preserved', () => {
    const out = renderHtml(wrap('tel:+1234567890'), { doctype: false });
    expect(out).toContain('href="tel:+1234567890"');
  });
});

// ---------------------------------------------------------------------------
// 10. Attribute escaping
// ---------------------------------------------------------------------------

describe('renderHtml — attribute escaping', () => {
  it('escapes " and & in alt text', () => {
    const tree: PdNode = {
      kind: 'PdContainer',
      maxWidth: 600,
      children: [
        {
          kind: 'PdImage',
          src: 'https://example.com/x.png',
          alt: 'a "quoted" & ampersand',
          surfaces: ['web', 'native'],
        },
      ],
    };
    const out = renderHtml(tree, { doctype: false });
    expect(out).toContain('alt="a &quot;quoted&quot; &amp; ampersand"');
    expect(out).not.toContain('alt="a "quoted"');
  });

  it('escapes " in URL query strings (defense-in-depth)', () => {
    const tree: PdNode = {
      kind: 'PdContainer',
      maxWidth: 600,
      children: [
        ({
          kind: 'PdLink',
          href: 'https://example.com/?q="evil"',
          children: ['x'],
        } satisfies PdLinkNode),
      ],
    };
    const out = renderHtml(tree, { doctype: false });
    expect(out).toContain('&quot;evil&quot;');
    // No way to break out of the attribute.
    expect(out).not.toMatch(/href="https:\/\/example\.com\/\?q="evil"/);
  });
});

// ---------------------------------------------------------------------------
// 11. Determinism
// ---------------------------------------------------------------------------

describe('renderHtml — determinism', () => {
  it('renders identical output for identical input (welcome)', () => {
    const a = renderHtml(composeDocument(welcome));
    const b = renderHtml(composeDocument(welcome));
    expect(a).toBe(b);
  });

  it('renders identical output for identical input (incident)', () => {
    const a = renderHtml(composeDocument(incident));
    const b = renderHtml(composeDocument(incident));
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// 12. Tone palette resolution
// ---------------------------------------------------------------------------

describe('renderHtml — callout tone colors', () => {
  it('danger callout output contains tonePalette.danger.bg + fg hex', () => {
    const out = renderHtml(composeDocument(incident));
    expect(out).toContain(tonePalette.danger.bg);
    expect(out).toContain(tonePalette.danger.fg);
  });

  it('success callout output contains tonePalette.success.bg + fg hex', () => {
    const out = renderHtml(composeDocument(welcome));
    expect(out).toContain(tonePalette.success.bg);
    expect(out).toContain(tonePalette.success.fg);
  });
});

// ---------------------------------------------------------------------------
// 13. No OSC-8 / no terminal escapes — server output is HTML, not ANSI
// ---------------------------------------------------------------------------

describe('renderHtml — no terminal escapes', () => {
  it('uses <a> tags, not OSC-8', () => {
    const out = renderHtml(composeDocument(welcome));
    expect(out).toContain('<a href="https://example.com/workspace"');
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/\x1b\]8;;/);
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/\x1b\[/);
  });
});

// ---------------------------------------------------------------------------
// 14. Image rendering
// ---------------------------------------------------------------------------

describe('renderHtml — image', () => {
  it('emits both src and alt attributes for a PdImage', () => {
    const out = renderHtml(composeDocument(incident));
    expect(out).toContain('src="https://example.com/img/db-cpu.png"');
    expect(out).toContain('alt="DB CPU graph showing failover spike"');
  });
});

// ---------------------------------------------------------------------------
// 15. Inline-style only — no <style> blocks, no class attributes
// ---------------------------------------------------------------------------

describe('renderHtml — inline-style discipline', () => {
  it('output contains no <style> blocks', () => {
    const w = renderHtml(composeDocument(welcome));
    const i = renderHtml(composeDocument(incident));
    expect(w).not.toMatch(/<style[\s>]/i);
    expect(i).not.toMatch(/<style[\s>]/i);
  });

  it('output contains no class= selectors', () => {
    const w = renderHtml(composeDocument(welcome));
    const i = renderHtml(composeDocument(incident));
    expect(w).not.toMatch(/\sclass=/);
    expect(i).not.toMatch(/\sclass=/);
  });

  it('primary button has border-radius:0 to defeat user-agent default', () => {
    const out = renderHtml(composeDocument(welcome));
    expect(out).toMatch(/background:#4f46e5;[^"]*border-radius:0/);
  });
});

// ---------------------------------------------------------------------------
// 16. Doctype + body wrapping
// ---------------------------------------------------------------------------

describe('renderHtml — doctype wrapping', () => {
  it('default emits <!doctype html> + <html> + <body>', () => {
    const out = renderHtml(composeDocument(welcome));
    expect(out).toMatch(/^<!doctype html><html>/i);
    expect(out).toContain('<meta charset="utf-8">');
    expect(out).toContain('<body');
    expect(out).toMatch(/<\/body><\/html>$/i);
  });
});
