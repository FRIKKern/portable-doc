/**
 * Papir ← DOCX import (Goal B, P1).
 *
 * Counterpart to `toDocx.ts` — pulls the embedded envelope back out of a
 * .docx blob so a re-import reconstructs the original PortableDoc AST
 * losslessly. See:
 *   ~/docs/paperflow/specs/2026-05-19-envelope-spec.html
 *   ~/docs/paperflow/specs/2026-05-19-embed-locations.html
 *   ~/docs/paperflow/specs/2026-05-19-import-flow.html
 *
 * Returns `null` on three failure modes — caller treats them all the same
 * (no envelope = fall back to "import as new", which is a later task):
 *   1. The .docx lacks `customXml/item1.xml` (pre-feature export, or a
 *      document not produced by Papir).
 *   2. The customXml part is present but doesn't carry a CDATA payload
 *      in the shape the exporter writes.
 *   3. The CDATA payload doesn't pass envelopeSchema (corrupted, hand-
 *      edited, or produced by an incompatible future build).
 */

import JSZip from 'jszip';
import { envelopeSchema, type Envelope } from '@portable-doc/core';

const ENVELOPE_PART = 'customXml/item1.xml';

/** Extract the embedded envelope from a .docx Blob/ArrayBuffer. Returns
 *  null if no envelope is present or the payload fails schema validation. */
export async function extractFromDocx(
  buffer: ArrayBuffer,
): Promise<Envelope | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    // Not a valid ZIP — definitely not a .docx.
    return null;
  }
  const customXml = zip.file(ENVELOPE_PART);
  if (!customXml) return null;
  const xml = await customXml.async('string');
  const cdataMatch = xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (!cdataMatch || !cdataMatch[1]) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cdataMatch[1].trim());
  } catch {
    return null;
  }
  const result = envelopeSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
