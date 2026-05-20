/**
 * fromHtml — unit specs for the HTML envelope extractor (Goal B, P2).
 *
 * Coverage:
 *   1. Round-trip — produced by toHtmlBlob, recovers original AST.
 *   2. Returns null when no envelope <script> tag is present.
 *   3. Returns null when the script's body is malformed JSON.
 *   4. Returns null when the parsed payload fails envelopeSchema.
 *   5. Returns null when the body is empty.
 *   6. Returns null when the script has the wrong type attribute.
 */
import { describe, expect, it } from 'vitest';
import type { PortableDoc } from '@portable-doc/core';
import { toHtmlBlob } from '../export/toHtml.js';
import { extractFromHtml } from './fromHtml.js';

const SAMPLE_DOC: PortableDoc = {
  version: 1,
  title: 'Extractor probe',
  blocks: [
    { id: 'h1', type: 'heading', level: 2, text: 'Hi' },
    { id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'body' }] },
  ],
};

describe('extractFromHtml', () => {
  it('round-trips: export → extract recovers the AST verbatim', async () => {
    const blob = await toHtmlBlob(SAMPLE_DOC);
    const text = await blob.text();
    const envelope = await extractFromHtml(text);
    expect(envelope).not.toBeNull();
    expect(envelope!.ast).toEqual(SAMPLE_DOC);
  });

  it('returns null when no envelope <script> tag is present', async () => {
    const html =
      '<!doctype html><html><head><title>nope</title></head>' +
      '<body><p>hello</p></body></html>';
    expect(await extractFromHtml(html)).toBeNull();
  });

  it('returns null when the script body is malformed JSON', async () => {
    const html =
      '<!doctype html><html><head><title>x</title>' +
      '<script type="application/portable-doc+json" id="papir-envelope">' +
      '{not valid json,,}' +
      '</script></head><body></body></html>';
    expect(await extractFromHtml(html)).toBeNull();
  });

  it('returns null when the parsed payload fails envelopeSchema', async () => {
    const html =
      '<!doctype html><html><head><title>x</title>' +
      '<script type="application/portable-doc+json" id="papir-envelope">' +
      JSON.stringify({ version: 'not-semver', exporter: 'x' }) +
      '</script></head><body></body></html>';
    expect(await extractFromHtml(html)).toBeNull();
  });

  it('returns null when the script body is empty', async () => {
    const html =
      '<!doctype html><html><head><title>x</title>' +
      '<script type="application/portable-doc+json" id="papir-envelope"></script>' +
      '</head><body></body></html>';
    expect(await extractFromHtml(html)).toBeNull();
  });

  it('returns null when the script has the wrong type attribute', async () => {
    // A regular text/javascript script that happens to look like JSON
    // should NOT be misinterpreted as an envelope.
    const html =
      '<!doctype html><html><head><title>x</title>' +
      '<script type="application/json" id="papir-envelope">' +
      JSON.stringify({
        version: '1.0.0',
        exporter: 'papir@0.4.x',
        exported_at: new Date().toISOString(),
        doc_uuid: '11111111-2222-4333-8444-555555555555',
        ast: {},
      }) +
      '</script></head><body></body></html>';
    expect(await extractFromHtml(html)).toBeNull();
  });
});
