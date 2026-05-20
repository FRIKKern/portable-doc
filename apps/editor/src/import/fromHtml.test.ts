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
import exhaustiveFixture from '../../../../examples/exhaustive.json';
import withImagesFixture from '../../../../examples/with-images.json';

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

  it('round-trips the exhaustive fixture', async () => {
    // The envelope JSON sits in <head>; toHtmlBlob writes the full AST in
    // a <script type="application/portable-doc+json"> regardless of how the
    // rendered <body> represents each block — so every variant survives.
    const original = exhaustiveFixture as PortableDoc;
    const blob = await toHtmlBlob(original);
    const text = await blob.text();
    const envelope = await extractFromHtml(text);
    expect(envelope).not.toBeNull();
    expect(envelope!.ast).toEqual(original);
  });

  it('round-trips with-images fixture (all 3 images intact)', async () => {
    // The data: URI, the https URL, and the wide-aspect image all ride
    // back through the envelope verbatim — including width/height/alt.
    const original = withImagesFixture as PortableDoc;
    const blob = await toHtmlBlob(original);
    const text = await blob.text();
    const envelope = await extractFromHtml(text);
    expect(envelope).not.toBeNull();
    expect(envelope!.ast).toEqual(original);
    // Spot-check: the three image blocks made it across with full src.
    const ast = envelope!.ast as PortableDoc;
    const imgs = ast.blocks.filter((b) => b.type === 'image');
    expect(imgs).toHaveLength(3);
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
