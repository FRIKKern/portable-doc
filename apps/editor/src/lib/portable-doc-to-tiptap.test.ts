/**
 * Pure-function specs for the PortableDoc -> TipTap-compatible HTML seed.
 * Verifies every block kind round-trips into the HTML shape TipTap's
 * StarterKit parser accepts. The Editor.test.tsx specs cover the live
 * editor mount; these tests prove the converter on its own.
 */
import { describe, expect, it } from 'vitest';
import type { PortableDoc } from '@portable-doc/core';
import { portableDocToTipTapHtml } from './portable-doc-to-tiptap.js';

const wrap = (blocks: PortableDoc['blocks']): PortableDoc => ({ version: 1, blocks });

describe('portableDocToTipTapHtml', () => {
  it('empty doc produces a single empty paragraph', () => {
    expect(portableDocToTipTapHtml(wrap([]))).toBe('<p></p>');
  });

  it('heading: <h{level}> respects level 1–3', () => {
    const html = portableDocToTipTapHtml(
      wrap([{ id: 'h', type: 'heading', level: 2, text: 'Hello' }]),
    );
    expect(html).toBe('<h2>Hello</h2>');
  });

  it('paragraph: inline marks compose as nested HTML', () => {
    const html = portableDocToTipTapHtml(
      wrap([
        {
          id: 'p',
          type: 'paragraph',
          content: [
            { type: 'text', value: 'plain ' },
            { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
            { type: 'text', value: ' and ' },
            { type: 'em', children: [{ type: 'text', value: 'italic' }] },
            { type: 'text', value: ' and ' },
            {
              type: 'link',
              href: 'https://example.com',
              children: [{ type: 'text', value: 'link' }],
            },
          ],
        },
      ]),
    );
    expect(html).toBe(
      '<p>plain <strong>bold</strong> and <em>italic</em> and <a href="https://example.com">link</a></p>',
    );
  });

  it('list: unordered list emits <ul><li><p>…</p></li>', () => {
    const html = portableDocToTipTapHtml(
      wrap([
        {
          id: 'l',
          type: 'list',
          ordered: false,
          items: [
            [{ type: 'text', value: 'one' }],
            [{ type: 'text', value: 'two' }],
          ],
        },
      ]),
    );
    expect(html).toBe('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
  });

  it('callout: blockquote with data-tone attribute (A2 hook for chrome)', () => {
    const html = portableDocToTipTapHtml(
      wrap([
        {
          id: 'c',
          type: 'callout',
          tone: 'success',
          title: 'Heads up',
          content: [{ type: 'text', value: 'body' }],
        },
      ]),
    );
    expect(html).toMatch(/^<blockquote data-tone="success">/);
    expect(html).toMatch(/Heads up/);
    expect(html).toMatch(/body/);
  });

  it('divider: <hr>', () => {
    expect(portableDocToTipTapHtml(wrap([{ id: 'd', type: 'divider' }]))).toBe('<hr>');
  });

  it('code: <pre><code class="language-…"> with HTML-escaped body', () => {
    const html = portableDocToTipTapHtml(
      wrap([{ id: 'c', type: 'code', lang: 'ts', value: 'const x = "<a>"' }]),
    );
    expect(html).toBe(
      '<pre><code class="language-ts">const x = &quot;&lt;a&gt;&quot;</code></pre>',
    );
  });

  it('section: title + recursively rendered nested blocks', () => {
    const html = portableDocToTipTapHtml(
      wrap([
        {
          id: 's',
          type: 'section',
          title: 'Inside',
          blocks: [
            { id: 'h', type: 'heading', level: 3, text: 'Deep' },
            {
              id: 'p',
              type: 'paragraph',
              content: [{ type: 'text', value: 'body' }],
            },
          ],
        },
      ]),
    );
    expect(html).toBe('<h2>Inside</h2><h3>Deep</h3><p>body</p>');
  });

  it('HTML-escapes special chars in heading text', () => {
    const html = portableDocToTipTapHtml(
      wrap([{ id: 'h', type: 'heading', level: 1, text: '<script>x' }]),
    );
    expect(html).toBe('<h1>&lt;script&gt;x</h1>');
  });
});
