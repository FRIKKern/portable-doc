import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeBlock, composeDocument } from '@portable-doc/primitives';
import type { Block, PortableDoc } from '@portable-doc/core';
import { renderBlockHtml, renderHtml } from './render.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/backend-web/src/static/ → repo root is ../../../..
const repoRoot = resolve(here, '../../../..');
const welcome = JSON.parse(
  readFileSync(resolve(repoRoot, 'examples', 'welcome.json'), 'utf8'),
) as PortableDoc;

// ---------------------------------------------------------------------------
// 1. Per-block-type output: contains the block's HTML, not the document chrome
// ---------------------------------------------------------------------------

describe('renderBlockHtml — bare fragment, no document chrome', () => {
  const heading: Block = {
    id: 'h',
    type: 'heading',
    level: 1,
    text: 'Hello',
  };
  const paragraph: Block = {
    id: 'p',
    type: 'paragraph',
    content: [{ type: 'text', value: 'A plain paragraph.' }],
  };
  const list: Block = {
    id: 'l',
    type: 'list',
    ordered: false,
    items: [[{ type: 'text', value: 'one' }], [{ type: 'text', value: 'two' }]],
  };
  const callout: Block = {
    id: 'c',
    type: 'callout',
    tone: 'success',
    title: 'Done',
    content: [{ type: 'text', value: 'All good.' }],
  };
  const action: Block = {
    id: 'a',
    type: 'action',
    label: 'Open',
    href: 'https://example.com/x',
    priority: 'primary',
  };
  const divider: Block = { id: 'd', type: 'divider' };
  const code: Block = { id: 'co', type: 'code', value: 'const x = 1;' };
  const image: Block = {
    id: 'i',
    type: 'image',
    src: 'https://example.com/x.png',
    alt: 'pic',
    surfaces: ['web', 'native'],
  };
  const table: Block = {
    id: 't',
    type: 'table',
    rows: [[[{ type: 'text', value: 'cell' }]]],
    surfaces: ['web', 'native'],
  };
  const section: Block = {
    id: 's',
    type: 'section',
    title: 'Sub',
    blocks: [paragraph],
  };

  const cases: Array<{ name: string; block: Block; contains: string }> = [
    { name: 'heading', block: heading, contains: 'Hello' },
    { name: 'paragraph', block: paragraph, contains: 'A plain paragraph.' },
    { name: 'list', block: list, contains: 'one' },
    { name: 'callout', block: callout, contains: 'All good.' },
    { name: 'action', block: action, contains: 'href="https://example.com/x"' },
    { name: 'divider', block: divider, contains: '<hr' },
    { name: 'code', block: code, contains: 'const x = 1;' },
    { name: 'image', block: image, contains: 'src="https://example.com/x.png"' },
    { name: 'table', block: table, contains: '<table' },
    { name: 'section', block: section, contains: 'A plain paragraph.' },
  ];

  for (const { name, block, contains } of cases) {
    it(`${name}: contains the block HTML but no container div / doctype / html / body`, () => {
      const out = renderBlockHtml(block);
      expect(out).toContain(contains);
      // No document chrome.
      expect(out).not.toMatch(/<!doctype/i);
      expect(out).not.toMatch(/<html/i);
      expect(out).not.toMatch(/<body/i);
      // No container wrapper — composeDocument's PdContainer emits this exact
      // `max-width:Npx;margin:0 auto` signature; a bare block must not.
      expect(out).not.toMatch(/max-width:\d+px;margin:0 auto/);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Equivalence with renderHtml(composeBlock(block), { doctype: false })
// ---------------------------------------------------------------------------

describe('renderBlockHtml — equivalence to composeBlock + doctype:false', () => {
  it('matches renderHtml(composeBlock(block), { doctype: false }) for every welcome block', () => {
    for (const block of welcome.blocks) {
      const viaBlockHtml = renderBlockHtml(block);
      const viaCompose = renderHtml(composeBlock(block), { doctype: false });
      expect(viaBlockHtml).toBe(viaCompose);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Byte-match: each block's fragment is a substring of the full-doc render
// ---------------------------------------------------------------------------

describe('renderBlockHtml — byte-matches the fragment inside full-doc renderHtml', () => {
  it('every top-level welcome block fragment appears verbatim in the full document', () => {
    const full = renderHtml(composeDocument(welcome));
    for (const block of welcome.blocks) {
      const fragment = renderBlockHtml(block);
      expect(full).toContain(fragment);
    }
  });

  it('concatenated block fragments equal the full document body (chrome stripped)', () => {
    const full = renderHtml(composeDocument(welcome));
    // Strip the doctype/html/body chrome and the single container <div>…</div>
    // that composeDocument adds, leaving just the joined block fragments.
    const containerOpen = full.indexOf('>', full.indexOf('<div style="max-width:'));
    const bodyInner = full.slice(
      containerOpen + 1,
      full.lastIndexOf('</div></body></html>'),
    );
    const joined = welcome.blocks.map((b) => renderBlockHtml(b)).join('');
    expect(bodyInner).toBe(joined);
  });
});

// ---------------------------------------------------------------------------
// 4. Escape edge cases — block output escapes, no document chrome leaks
// ---------------------------------------------------------------------------

describe('renderBlockHtml — escape edge cases', () => {
  it('escapes < > & " \' in a paragraph text leaf', () => {
    const block: Block = {
      id: 'x',
      type: 'paragraph',
      content: [{ type: 'text', value: '<script>alert("xss" & \'pwn\')</script>' }],
    };
    const out = renderBlockHtml(block);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('&amp;');
    expect(out).toContain('&quot;');
    expect(out).toContain('&#39;');
  });

  it('escapes " and & in image alt attribute', () => {
    const block: Block = {
      id: 'x',
      type: 'image',
      src: 'https://example.com/x.png',
      alt: 'a "quoted" & ampersand',
      surfaces: ['web', 'native'],
    };
    const out = renderBlockHtml(block);
    expect(out).toContain('alt="a &quot;quoted&quot; &amp; ampersand"');
    expect(out).not.toContain('alt="a "quoted"');
  });

  it('collapses a javascript: action href to #', () => {
    const block: Block = {
      id: 'x',
      type: 'action',
      label: 'Click',
      href: 'javascript:alert(1)' as unknown as string,
      priority: 'secondary',
    };
    const out = renderBlockHtml(block);
    expect(out).toContain('href="#"');
    expect(out).not.toContain('javascript:');
  });

  it('passes opts through (containerWidth) without re-adding doctype', () => {
    const block: Block = { id: 'd', type: 'divider' };
    const out = renderBlockHtml(block, { containerWidth: 320, doctype: true });
    // doctype:false is forced internally regardless of caller-supplied doctype.
    expect(out).not.toMatch(/<!doctype/i);
    expect(out).toMatch(/^<hr/);
  });
});
