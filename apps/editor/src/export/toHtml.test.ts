/**
 * toHtml — unit specs for the HTML export channel (Goal B, P2).
 *
 * Coverage:
 *   1. Returns a Blob with type `text/html` and size > 500 bytes.
 *   2. Emitted document contains the envelope <script> with
 *      id="papir-envelope" and the expected type attribute.
 *   3. Round-trip — export → extract recovers the AST verbatim.
 *   4. Walker handles one-of-every-major-block without throwing.
 *   5. Custom docUuid is honoured.
 */
import { describe, expect, it } from 'vitest';
import type { PortableDoc } from '@portable-doc/core';
import { toHtmlBlob, HTML_MIME } from './toHtml.js';
import { extractFromHtml } from '../import/fromHtml.js';

const TINY_DOC: PortableDoc = {
  version: 1,
  title: 'Hello',
  blocks: [
    { id: 'h1', type: 'heading', level: 1, text: 'Hi' },
    { id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'world' }] },
  ],
};

describe('toHtmlBlob', () => {
  it('returns a Blob with type text/html and size > 500 bytes', async () => {
    const blob = await toHtmlBlob(TINY_DOC);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe(HTML_MIME);
    expect(blob.size).toBeGreaterThan(500);
  });

  it('emits the envelope <script> with id="papir-envelope" and correct type', async () => {
    const blob = await toHtmlBlob(TINY_DOC);
    const text = await blob.text();
    expect(text).toContain('id="papir-envelope"');
    expect(text).toContain('type="application/portable-doc+json"');
    // Sanity: <title> precedes the envelope script in <head>.
    const titleIdx = text.indexOf('<title>');
    const envIdx = text.indexOf('id="papir-envelope"');
    expect(titleIdx).toBeGreaterThan(-1);
    expect(envIdx).toBeGreaterThan(titleIdx);
  });

  it('round-trips: export → extract recovers the AST verbatim', async () => {
    const original: PortableDoc = {
      version: 1,
      title: 'Round-trip demo',
      blocks: [
        { id: 'h1', type: 'heading', level: 2, text: 'Section' },
        {
          id: 'p1',
          type: 'paragraph',
          content: [
            { type: 'text', value: 'plain ' },
            { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
            { type: 'text', value: ' and ' },
            { type: 'em', children: [{ type: 'text', value: 'italic' }] },
          ],
        },
        {
          id: 'c1',
          type: 'callout',
          tone: 'info',
          title: 'Note',
          variant: { emphasis: 'subtle' },
          content: [{ type: 'text', value: 'a calm callout' }],
        },
        {
          id: 'l1',
          type: 'list',
          items: [
            [{ type: 'text', value: 'one' }],
            [{ type: 'text', value: 'two' }],
          ],
        },
        { id: 'k1', type: 'code', lang: 'ts', value: 'const x = 1;' },
        { id: 'd1', type: 'divider' },
      ],
    };
    const blob = await toHtmlBlob(original);
    const text = await blob.text();
    const envelope = await extractFromHtml(text);
    expect(envelope).not.toBeNull();
    expect(envelope!.ast).toEqual(original);
    expect(envelope!.version).toBe('1.0.0');
    expect(envelope!.exporter).toContain('papir');
  });

  it('handles a doc with one of every major block type without throwing', async () => {
    const doc: PortableDoc = {
      version: 1,
      title: 'All blocks',
      blocks: [
        { id: 'h1', type: 'heading', level: 1, text: 'Title' },
        { id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'body' }] },
        {
          id: 'l1',
          type: 'list',
          ordered: true,
          items: [[{ type: 'text', value: 'first' }]],
        },
        {
          id: 'c1',
          type: 'callout',
          tone: 'warning',
          content: [{ type: 'text', value: 'careful' }],
        },
        {
          id: 'a1',
          type: 'action',
          label: 'Open',
          href: 'https://example.org',
          priority: 'primary',
        },
        {
          id: 's1',
          type: 'section',
          title: 'Inner',
          blocks: [
            { id: 'sp1', type: 'paragraph', content: [{ type: 'text', value: 'nested' }] },
          ],
        },
        { id: 'd1', type: 'divider' },
        { id: 'k1', type: 'code', lang: 'js', value: 'console.log(1)' },
        {
          id: 'i1',
          type: 'image',
          src: 'https://example.org/x.png',
          alt: 'pic',
          surfaces: ['web', 'native'],
        },
        {
          id: 't1',
          type: 'table',
          rows: [
            [[{ type: 'text', value: 'h' }]],
            [[{ type: 'text', value: 'b' }]],
          ],
          surfaces: ['web', 'native'],
        },
      ],
    };
    const blob = await toHtmlBlob(doc);
    expect(blob.size).toBeGreaterThan(500);
    const text = await blob.text();
    // The walker should have emitted at least one of every primary element.
    expect(text).toContain('<h1');
    expect(text).toContain('<p>');
    expect(text).toContain('<ol>');
    expect(text).toContain('paper-callout');
    expect(text).toContain('paper-action');
    expect(text).toContain('<section class="paper-section">');
    expect(text).toContain('<hr>');
    expect(text).toContain('paper-code');
    expect(text).toContain('<img');
    expect(text).toContain('paper-table');
  });

  it('honours a caller-supplied docUuid', async () => {
    const docUuid = '11111111-2222-4333-8444-555555555555';
    const blob = await toHtmlBlob(TINY_DOC, { docUuid });
    const envelope = await extractFromHtml(await blob.text());
    expect(envelope).not.toBeNull();
    expect(envelope!.doc_uuid).toBe(docUuid);
  });
});
