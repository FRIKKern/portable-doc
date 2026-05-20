/**
 * Papir ← HTML import (Goal B P2, embedded-roundtrip-ast).
 *
 * Counterpart to `toHtml.ts` — pulls the embedded envelope back out of an
 * HTML document so a re-import reconstructs the original PortableDoc AST
 * losslessly. See:
 *   ~/docs/paperflow/specs/2026-05-19-envelope-spec.html
 *   ~/docs/paperflow/specs/2026-05-19-embed-locations.html
 *
 * Embed shape: a single `<script type="application/portable-doc+json"
 * id="papir-envelope">` block in `<head>`, after `<title>` and before any
 * user-visible script. The script's textContent is the envelope JSON.
 *
 * Returns `null` on the original failure modes — caller treats them all
 * the same (no envelope = fall back to "import as new", which is a later
 * task):
 *   1. No script tag with the expected type attribute is present.
 *   2. The script's text content is not valid JSON.
 *   3. The parsed payload doesn't match envelopeSchema.
 */

import { envelopeSchema, type Envelope } from '@portable-doc/core';

const ENVELOPE_SCRIPT_TYPE = 'application/portable-doc+json';

/** Extract the embedded envelope from an HTML string. Returns null if no
 *  envelope is present or the payload fails schema validation. */
export async function extractFromHtml(text: string): Promise<Envelope | null> {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, 'text/html');
  } catch {
    return null;
  }

  const script = doc.querySelector(
    `script[type="${ENVELOPE_SCRIPT_TYPE}"]`,
  );
  if (!script) return null;

  const raw = script.textContent;
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const result = envelopeSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
