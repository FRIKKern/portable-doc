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
 * Dual embed: the exporter writes the envelope to BOTH `customXml/item1.xml`
 * AND `docProps/custom.xml` (chunked + base64 + sha256). Word and Pages
 * preserve customXml round-trips; Google Docs strips customXml on upload
 * but preserves docProps/custom.xml. The importer tries customXml first
 * (smaller, no decode overhead), falls back to custom.xml on miss/schema
 * failure.
 *
 * Returns `null` on the original failure modes — caller treats them all
 * the same (no envelope = fall back to "import as new", which is a later
 * task):
 *   1. The .docx lacks both `customXml/item1.xml` and the docProps
 *      fallback chunks (pre-feature export, or a doc not from Papir).
 *   2. Either part is present but its payload doesn't match the schema.
 *   3. The docProps fallback's sha256 doesn't match the recomputed digest.
 */

import JSZip from 'jszip';
import { envelopeSchema, type Envelope } from '@portable-doc/core';

const ENVELOPE_PART = 'customXml/item1.xml';
const CUSTOM_PROPS_PART = 'docProps/custom.xml';

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

  // Primary path: customXml/item1.xml. Smaller payload, no decode cost,
  // survives Word + Pages intact.
  const primary = await tryCustomXml(zip);
  if (primary) return primary;

  // Fallback: docProps/custom.xml chunks. Google Docs strips customXml on
  // upload but preserves docProps, so the envelope rides through there.
  const fallback = await tryDocPropsChunks(zip);
  return fallback;
}

async function tryCustomXml(zip: JSZip): Promise<Envelope | null> {
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

async function tryDocPropsChunks(zip: JSZip): Promise<Envelope | null> {
  const file = zip.file(CUSTOM_PROPS_PART);
  if (!file) return null;
  const xml = await file.async('string');

  // Extract a single property's text value by name. We treat the XML as
  // a regex-targetable string — the properties this exporter writes use
  // a single vt:lpwstr or vt:i4 child, no nested elements, so this is
  // robust against the formatting JSZip produces on round-trip.
  const propValue = (name: string): string | null => {
    const re = new RegExp(
      `<property[^>]*name="${name}"[^>]*>\\s*<vt:[^>]*>([\\s\\S]*?)</vt:[^>]*>\\s*</property>`,
    );
    const m = xml.match(re);
    return m && m[1] !== undefined ? decodeXml(m[1]) : null;
  };

  const countStr = propValue('papir-ast-count');
  const expectedSha = propValue('papir-ast-sha256');
  if (!countStr || !expectedSha) return null;
  const count = parseInt(countStr, 10);
  if (!Number.isFinite(count) || count <= 0) return null;

  let base64 = '';
  for (let i = 1; i <= count; i++) {
    const part = propValue(`papir-ast-${i}`);
    if (part === null) return null;
    base64 += part;
  }

  // Verify integrity before decoding — corrupt slices manifest as a
  // sha mismatch first, JSON-parse failure second.
  const actualSha = await sha256Prefix(base64);
  if (actualSha !== expectedSha) return null;

  let json: string;
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    json = new TextDecoder().decode(bytes);
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

function decodeXml(s: string): string {
  return s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

async function sha256Prefix(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 16; i++) {
    hex += arr[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}
