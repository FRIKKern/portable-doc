/**
 * fromMd — unit specs for the markdown round-trip extractor (Goal B P2).
 *
 * Coverage:
 *   1. Round-trip — encode envelope via ExportMenu's helper + inject into the
 *      serialized markdown, then extractFromMd recovers the AST verbatim.
 *   2. Markdown without the comment returns null (pre-feature export).
 *   3. Malformed base64 in the comment returns null.
 *   4. A schema-invalid envelope (valid base64 + gzip + JSON, but missing
 *      required fields) returns null.
 */
import { describe, expect, it } from 'vitest';
import type { PortableDoc } from '@portable-doc/core';
import {
  encodeEnvelopeComment,
  injectEnvelopeIntoMarkdown,
  serializeMarkdown,
} from '../ExportMenu.js';
import { extractFromMd } from './fromMd.js';

/** Gzip + base64-encode an arbitrary JSON string into the comment shape the
 *  extractor recognises. Used by the schema-invalid case so we can plant a
 *  payload that passes decode but fails envelopeSchema.safeParse. */
async function commentFromJson(json: string): Promise<string> {
  const gzipped = await new Response(
    new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer();
  const bytes = new Uint8Array(gzipped);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return `<!-- portable-doc-ast (gzip+base64): ${btoa(binary)} -->`;
}

describe('extractFromMd', () => {
  it('round-trips: encode + inject → extract recovers the AST verbatim', async () => {
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
      ],
    };
    const md = serializeMarkdown(original);
    const comment = await encodeEnvelopeComment(original);
    const withEnvelope = injectEnvelopeIntoMarkdown(md, comment);

    const envelope = await extractFromMd(withEnvelope);
    expect(envelope).not.toBeNull();
    expect(envelope!.ast).toEqual(original);
    expect(envelope!.version).toBe('1.0.0');
    expect(envelope!.exporter).toContain('papir');
  });

  it('returns null when the markdown has no envelope comment', async () => {
    const plain = '# Just a doc\n\nSome body text.\n';
    expect(await extractFromMd(plain)).toBeNull();
  });

  it('returns null when the base64 in the comment is malformed', async () => {
    // Replace the base64 with characters that match the regex shape but
    // decode to bytes that gzip can't open. The regex allows A-Za-z0-9+/= ;
    // a short run of '=' padding only is still regex-matchable but is not a
    // valid gzip stream once decoded.
    const corrupt = '# Title\n\n<!-- portable-doc-ast (gzip+base64): AAAAAAAA -->\n\nbody\n';
    expect(await extractFromMd(corrupt)).toBeNull();
  });

  it('returns null when the decoded envelope fails schema validation', async () => {
    // Valid base64 + valid gzip + valid JSON — but the payload is missing
    // required fields (exporter, exported_at, doc_uuid, ast). envelopeSchema
    // must reject it.
    const badJson = JSON.stringify({ version: 'not-semver' });
    const comment = await commentFromJson(badJson);
    const md = `# Title\n\n${comment}\n\nbody text\n`;
    expect(await extractFromMd(md)).toBeNull();
  });

  it('returns null when the gzip payload is truncated', async () => {
    // Take a valid envelope comment and chop the base64 in half — atob still
    // returns bytes (provided the trimmed length is divisible by 4), but the
    // gzip stream is truncated and DecompressionStream throws.
    const doc: PortableDoc = {
      version: 1,
      title: 'Truncation probe',
      blocks: [
        { id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'hi' }] },
      ],
    };
    const comment = await encodeEnvelopeComment(doc);
    const m = comment.match(/: ([A-Za-z0-9+/=]+) -->/);
    if (!m || !m[1]) throw new Error('test fixture: comment shape changed');
    const b64 = m[1];
    // Truncate to a multiple-of-4 length so atob itself still succeeds; the
    // gzip stream sees this as a truncated body.
    const truncated = b64.slice(0, Math.floor(b64.length / 4 / 2) * 4);
    const truncatedComment = `<!-- portable-doc-ast (gzip+base64): ${truncated} -->`;
    const md = `# Title\n\n${truncatedComment}\n\nbody\n`;
    expect(await extractFromMd(md)).toBeNull();
  });
});
