/**
 * Papir ← Markdown import (Goal B, P2).
 *
 * Counterpart to the markdown export path in ExportMenu — pulls the embedded
 * envelope back out of a .md file so a re-import reconstructs the original
 * PortableDoc AST losslessly. See:
 *   ~/docs/paperflow/specs/2026-05-19-envelope-spec.html
 *   ~/docs/paperflow/specs/2026-05-19-embed-locations.html
 *
 * Embed shape (P2 of embedded-roundtrip-ast): the envelope rides on a single
 * HTML comment immediately after the title line. gzip + base64 keeps the
 * comment short enough that typical markdown renderers ignore it without any
 * fuss; CommonMark treats `<!-- … -->` as raw HTML and emits nothing.
 *
 *     # Title
 *
 *     <!-- portable-doc-ast (gzip+base64): H4sIAAAAAAAA... -->
 *
 *     body content...
 *
 * Returns `null` on every recoverable failure mode — caller treats them all
 * the same (no envelope = fall back to "import as new"):
 *   1. No comment present (pre-feature export, or any non-Papir .md).
 *   2. Base64 in the comment is malformed.
 *   3. Gunzip fails (truncation, wrong codec, garbled bytes).
 *   4. JSON parse fails or the payload doesn't match the envelope schema.
 */

import { envelopeSchema, type Envelope } from '@portable-doc/core';

const ENVELOPE_RE = /<!-- portable-doc-ast \(gzip\+base64\): ([A-Za-z0-9+/=]+) -->/;

/** Extract the embedded envelope from a Markdown string. Returns null if no
 *  envelope is present or the payload fails to decode / parse / validate. */
export async function extractFromMd(text: string): Promise<Envelope | null> {
  const match = text.match(ENVELOPE_RE);
  if (!match || !match[1]) return null;
  const b64 = match[1];

  let bytes: Uint8Array;
  try {
    const binary = atob(b64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return null;
  }

  let json: string;
  try {
    // Cast through ArrayBuffer to side-step TS's strict BlobPart constraint
    // on Uint8Array<ArrayBufferLike> — at runtime the typed array is a
    // valid BlobPart everywhere we run.
    json = await new Response(
      new Blob([bytes.buffer as ArrayBuffer])
        .stream()
        .pipeThrough(new DecompressionStream('gzip')),
    ).text();
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const result = envelopeSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
