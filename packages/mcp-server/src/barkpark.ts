/**
 * Optional Barkpark forwarding for block-op tools (Wave 4, plan step T4.5).
 *
 * When an agent authors a paper with `doc_append_block` (and any sibling
 * block-op tool), the LOCAL apply happens first and is the source of truth for
 * the tool result. If — and only if — a Barkpark target is fully configured
 * (a paper slug + an ingest URL + an ingest token), the applied
 * {@link DocPatchOp} is then POSTed to Barkpark's block-ops endpoint so the op
 * streams into the live LiveView paper with no reload.
 *
 *   POST <origin>/v1/paperflow/papers/<slug>/ops
 *   Authorization: Bearer <BARKPARK_INGEST_TOKEN>
 *   body: the DocPatchOp itself, e.g. {"op":"append-block","block":{…}}
 *   ⇒ { ok, slug, op, rev, block_id, fragment_html, position }
 *
 * Everything here is purely additive and defensive:
 *   - No target configured  → no network call, behaviour identical to before.
 *   - Forwarding failure     → logged + reported in the tool result, but the
 *                              local apply still succeeds. We NEVER throw
 *                              because Barkpark was unreachable.
 *
 * KNOWN BOUNDARY (do not try to solve here): this streams blocks only for
 * papers AUTHORED AS portable-doc blocks via these tools. HTML-authored papers
 * (whole-file saves through paperflow's event-on-save) keep using the
 * whole-HTML POST path — there is no HTML→portable-doc-blocks parser, so
 * per-block streaming does not apply to them.
 */
import type { DocPatchOp } from '@portable-doc/core';

/** Env var holding the Barkpark ingest base URL (e.g. https://host/v1/paperflow/papers). */
export const BARKPARK_INGEST_URL_ENV = 'BARKPARK_INGEST_URL';
/** Env var holding the bearer token for Barkpark ingest. */
export const BARKPARK_INGEST_TOKEN_ENV = 'BARKPARK_INGEST_TOKEN';

/**
 * A fully-resolved Barkpark forwarding target: a paper slug, the derived
 * block-ops endpoint URL, and the bearer token. Produced by
 * {@link resolveBarkparkTarget} only when all three inputs are present.
 */
export interface BarkparkTarget {
  slug: string;
  opsUrl: string;
  token: string;
}

/** Reported back in the tool result so the caller sees what forwarding did. */
export type BarkparkForwardResult =
  | { forwarded: true; rev?: number; blockId?: string; position?: number }
  | { forwarded: false; reason: 'not-configured' }
  | { forwarded: false; reason: 'error'; error: string };

/**
 * Derive the per-paper block-ops endpoint URL from the Barkpark ingest base
 * URL and a paper slug. THE single place URL derivation lives.
 *
 * The ingest URL is expected to point at the papers collection, e.g.
 * `https://barkpark.example/v1/paperflow/papers`. The ops endpoint for a paper
 * is that collection URL plus `/<slug>/ops`:
 *
 *   https://barkpark.example/v1/paperflow/papers
 *     → https://barkpark.example/v1/paperflow/papers/<slug>/ops
 *
 * To stay robust against a trailing slash, or an ingest URL that already
 * includes a `/papers` segment elsewhere, we anchor on the FINAL `/papers`
 * segment of the path and replace everything from there with
 * `/papers/<slug>/ops`. If the path has no `/papers` segment at all we fall
 * back to building `<origin>/v1/paperflow/papers/<slug>/ops`.
 */
export function deriveOpsUrl(ingestUrl: string, slug: string): string {
  const u = new URL(ingestUrl);
  const encSlug = encodeURIComponent(slug);

  // Normalise the path (drop any trailing slash for matching) and locate the
  // last `/papers` segment.
  const path = u.pathname.replace(/\/+$/, '');
  const segments = path.split('/'); // e.g. ['', 'v1', 'paperflow', 'papers']
  const papersIdx = segments.lastIndexOf('papers');

  if (papersIdx >= 0) {
    // Keep everything up to and including `papers`, then append `<slug>/ops`.
    const base = segments.slice(0, papersIdx + 1).join('/');
    u.pathname = `${base}/${encSlug}/ops`;
  } else {
    // No `/papers` in the ingest path — build the canonical path from origin.
    u.pathname = `/v1/paperflow/papers/${encSlug}/ops`;
  }
  // Forwarding posts to a fixed endpoint; never carry query/hash through.
  u.search = '';
  u.hash = '';
  return u.toString();
}

/**
 * Resolve a Barkpark forwarding target from an optional slug plus env config.
 * Returns `null` (no target — local-only behaviour) unless ALL of slug, ingest
 * URL, and ingest token are present and non-empty. Never throws on a malformed
 * URL — a bad ingest URL resolves to `null` so forwarding is simply skipped.
 */
export function resolveBarkparkTarget(
  slug: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): BarkparkTarget | null {
  const trimmedSlug = slug?.trim();
  const ingestUrl = env[BARKPARK_INGEST_URL_ENV]?.trim();
  const token = env[BARKPARK_INGEST_TOKEN_ENV]?.trim();
  if (!trimmedSlug || !ingestUrl || !token) return null;

  let opsUrl: string;
  try {
    opsUrl = deriveOpsUrl(ingestUrl, trimmedSlug);
  } catch {
    // Malformed ingest URL — treat as no target rather than crashing the tool.
    return null;
  }
  return { slug: trimmedSlug, opsUrl, token };
}

/** Minimal shape of the Barkpark ops endpoint's success body. */
interface BarkparkOpsResponse {
  ok?: boolean;
  rev?: number;
  block_id?: string;
  position?: number;
}

/**
 * POST a single {@link DocPatchOp} to the resolved Barkpark ops endpoint with
 * the bearer header. DEFENSIVE by contract: a network error or non-2xx status
 * is captured and returned as `{ forwarded:false, reason:'error', error }` —
 * this function NEVER throws. The caller has already applied the op locally; a
 * forwarding failure must never undo or fail that local apply.
 *
 * `fetchImpl` is injectable so tests can stub the network without globals.
 */
export async function forwardOp(
  target: BarkparkTarget,
  op: DocPatchOp,
  fetchImpl: typeof fetch = fetch,
): Promise<BarkparkForwardResult> {
  try {
    const res = await fetchImpl(target.opsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${target.token}`,
      },
      body: JSON.stringify(op),
    });

    if (!res.ok) {
      const detail = await safeReadBodySnippet(res);
      const msg = `Barkpark forward failed: ${res.status} ${res.statusText}${
        detail ? ` — ${detail}` : ''
      }`;
      // eslint-disable-next-line no-console
      console.error(msg);
      return { forwarded: false, reason: 'error', error: msg };
    }

    const body = (await safeReadJson(res)) as BarkparkOpsResponse | null;
    return {
      forwarded: true,
      rev: body?.rev,
      blockId: body?.block_id,
      position: body?.position,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const msg = `Barkpark forward error: ${error}`;
    // eslint-disable-next-line no-console
    console.error(msg);
    return { forwarded: false, reason: 'error', error: msg };
  }
}

/** Read a short body snippet for error context; swallows any read failure. */
async function safeReadBodySnippet(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 200);
  } catch {
    return '';
  }
}

/** Parse a JSON body, returning `null` (never throwing) on any failure. */
async function safeReadJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
