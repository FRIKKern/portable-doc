import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeDocument } from '@portable-doc/primitives';
import { tonePalette } from '@portable-doc/core';
import type { PortableDoc } from '@portable-doc/core';
import type { PdLinkNode, PdNode } from '@portable-doc/primitives';
import { renderEmail } from './render.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const welcome = JSON.parse(
  readFileSync(resolve(repoRoot, 'examples', 'welcome.json'), 'utf8'),
) as PortableDoc;
const incident = JSON.parse(
  readFileSync(resolve(repoRoot, 'examples', 'incident.json'), 'utf8'),
) as PortableDoc;

// ---------------------------------------------------------------------------
// 1–2. Snapshots — both fixtures
// ---------------------------------------------------------------------------

describe('renderEmail — snapshots', () => {
  it('welcome fixture', async () => {
    const out = await renderEmail(composeDocument(welcome));
    expect(out).toMatchSnapshot();
  });

  it('incident fixture', async () => {
    const out = await renderEmail(composeDocument(incident));
    expect(out).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// 3. Dark-mode head present
// ---------------------------------------------------------------------------

describe('renderEmail — dark mode', () => {
  it('emits color-scheme meta and prefers-color-scheme CSS', async () => {
    const out = await renderEmail(composeDocument(welcome));
    expect(out).toContain('color-scheme');
    expect(out).toContain('prefers-color-scheme');
    expect(out).toContain('data-ogsc');
    expect(out).toContain('pd-bg');
  });
});

// ---------------------------------------------------------------------------
// 4. VML primary button
// ---------------------------------------------------------------------------

describe('renderEmail — VML primary button', () => {
  it('emits MSO conditional comment + VML roundrect for primary action', async () => {
    const out = await renderEmail(composeDocument(welcome));
    expect(out).toContain('<!--[if mso]>');
    expect(out).toContain('<v:roundrect');
    expect(out).toContain('xmlns:v="urn:schemas-microsoft-com:vml"');
    expect(out).toContain('<w:anchorlock/>');
  });
});

// ---------------------------------------------------------------------------
// 5. NO VML on secondary button
// ---------------------------------------------------------------------------

describe('renderEmail — secondary button has no VML', () => {
  it('secondary-only fixture omits v:roundrect', async () => {
    const tree: PdNode = {
      kind: 'PdContainer',
      maxWidth: 600,
      children: [
        {
          kind: 'PdButton',
          href: 'https://example.com/x',
          label: 'Read more',
          priority: 'secondary',
        },
      ],
    };
    const out = await renderEmail(tree);
    expect(out).not.toContain('<v:roundrect');
    // Conditional MSO comments only appear via the primary path.
    expect(out).not.toContain('<!--[if mso]>');
  });
});

// ---------------------------------------------------------------------------
// 6. role="presentation" on layout tables
// ---------------------------------------------------------------------------

describe('renderEmail — a11y', () => {
  it('layout tables carry role="presentation"', async () => {
    const out = await renderEmail(composeDocument(welcome));
    expect(out).toMatch(/<table[^>]*role="presentation"/);
  });
});

// ---------------------------------------------------------------------------
// 7. Callout tone color
// ---------------------------------------------------------------------------

describe('renderEmail — callout tone colors', () => {
  it('danger callout includes danger.bg and danger.fg hex', async () => {
    const out = await renderEmail(composeDocument(incident));
    expect(out).toContain(tonePalette.danger.bg);
    expect(out).toContain(tonePalette.danger.fg);
  });
});

// ---------------------------------------------------------------------------
// 8. URL allowlist
// ---------------------------------------------------------------------------

describe('renderEmail — URL allowlist', () => {
  it('javascript: link href collapses to #', async () => {
    const tree: PdNode = {
      kind: 'PdContainer',
      maxWidth: 600,
      children: [
        ({
          kind: 'PdLink',
          href: 'javascript:alert(1)',
          children: ['x'],
        } satisfies PdLinkNode),
      ],
    };
    const out = await renderEmail(tree);
    expect(out).toContain('href="#"');
    expect(out).not.toContain('javascript:');
  });

  it('javascript: button href collapses to # (primary)', async () => {
    const tree: PdNode = {
      kind: 'PdContainer',
      maxWidth: 600,
      children: [
        {
          kind: 'PdButton',
          href: 'javascript:alert(1)',
          label: 'Click',
          priority: 'primary',
        },
      ],
    };
    const out = await renderEmail(tree);
    expect(out).not.toContain('javascript:');
  });
});

// ---------------------------------------------------------------------------
// 9. HTML escape in text
// ---------------------------------------------------------------------------

describe('renderEmail — HTML escaping', () => {
  it('escapes <script> in text content', async () => {
    const tree: PdNode = {
      kind: 'PdContainer',
      maxWidth: 600,
      children: [
        {
          kind: 'PdText',
          children: ['<script>alert("xss")</script>'],
        },
      ],
    };
    const out = await renderEmail(tree);
    expect(out).not.toContain('<script>alert');
    expect(out).toContain('&lt;script&gt;');
  });
});

// ---------------------------------------------------------------------------
// 10. Image alt
// ---------------------------------------------------------------------------

describe('renderEmail — image alt', () => {
  it('emits alt attribute on PdImage', async () => {
    const out = await renderEmail(composeDocument(incident));
    expect(out).toMatch(/alt="DB CPU graph showing failover spike"/);
  });
});

// ---------------------------------------------------------------------------
// 11. Preheader hidden div
// ---------------------------------------------------------------------------

describe('renderEmail — preheader', () => {
  it('preheader text appears in hidden div when option set', async () => {
    const sentinel = 'PREHEADER-SENTINEL-7Q3J';
    const out = await renderEmail(composeDocument(welcome), {
      preheader: sentinel,
    });
    expect(out).toContain(sentinel);
    expect(out).toContain('display:none');
  });

  it('preheader sentinel omitted when option unset', async () => {
    const sentinel = 'PREHEADER-SENTINEL-7Q3J';
    const out = await renderEmail(composeDocument(welcome));
    expect(out).not.toContain(sentinel);
  });
});

// ---------------------------------------------------------------------------
// 12. Determinism
// ---------------------------------------------------------------------------

describe('renderEmail — determinism', () => {
  it('renders identical output for identical input', async () => {
    const a = await renderEmail(composeDocument(welcome));
    const b = await renderEmail(composeDocument(welcome));
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// 13. Container width = 600
// ---------------------------------------------------------------------------

describe('renderEmail — container width', () => {
  it('output contains width="600" somewhere', async () => {
    const out = await renderEmail(composeDocument(welcome));
    expect(out).toContain('width="600"');
  });
});

// ---------------------------------------------------------------------------
// 14. Returns a Promise<string>
// ---------------------------------------------------------------------------

describe('renderEmail — async API', () => {
  it('returns a Promise resolving to a string', async () => {
    const p = renderEmail(composeDocument(welcome));
    expect(p).toBeInstanceOf(Promise);
    const out = await p;
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(100);
  });
});
