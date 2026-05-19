/**
 * Round-trip envelope schema (Goal B, P1).
 *
 * The .docx round-trip channel stashes the original PortableDoc AST as an
 * invisible JSON payload inside the exported .docx so that a re-import
 * reconstructs the source losslessly — every variant, every nested block,
 * every inline mark intact. The envelope is the wrapper around that AST.
 *
 * Shape locked in `~/docs/paperflow/specs/2026-05-19-envelope-spec.html`:
 *   version       — semver tracking the envelope shape itself (not the AST)
 *   exporter      — identifier of the producing build (used for diagnostics)
 *   exported_at   — ISO-8601 timestamp of export
 *   doc_uuid      — stable identifier for the source document
 *   ast           — the PortableDoc AST as-of export
 *
 * The `ast` field is intentionally `z.unknown()`: the round-trip path must
 * tolerate envelopes produced by older catalog schemas, and re-validation
 * against the current `portableDocSchema` is the caller's responsibility
 * (it lives in `validateDoc()` and runs after the editor swaps content in).
 */

import { z } from 'zod';

export const ENVELOPE_VERSION = '1.0.0';

export const envelopeSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  exporter: z.string(),
  exported_at: z.string().datetime(),
  doc_uuid: z.string().uuid(),
  // PortableDoc — keep loose so envelopes from older / newer catalog schemas
  // still parse; downstream callers re-run `validateDoc` after import.
  ast: z.unknown(),
});

export type Envelope = z.infer<typeof envelopeSchema>;

/** Build an envelope for the current export. */
export function buildEnvelope(ast: unknown, doc_uuid: string): Envelope {
  return {
    version: ENVELOPE_VERSION,
    exporter: 'papir@0.4.x',
    exported_at: new Date().toISOString(),
    doc_uuid,
    ast,
  };
}

/** UUID v4 generator using crypto.randomUUID. Available on the global
 *  `crypto` object in modern browsers and Node ≥ 19. */
export function generateDocUuid(): string {
  return crypto.randomUUID();
}
