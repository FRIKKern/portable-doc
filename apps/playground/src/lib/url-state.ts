/**
 * URL state — paperflow-owned, zero deps.
 *
 * Encodes the JSON paste-box content into a URL-safe base64 of the gzipped
 * bytes via the native `CompressionStream` API (Node 18+, all evergreen
 * browsers — same surface jsdom 29 inherits from Node globals). No `pako`,
 * no LZ-string, no base91 cleverness.
 *
 * The 2000-char threshold (per grill q7) is the email-paste danger zone —
 * Twitter/Slack/Discord all happily eat much longer URLs, but Outlook and
 * Gmail clients have been observed to truncate around 2 kB. Warn, don't
 * block — the user might be sharing a Slack link and not care.
 */

export const URL_WARN_THRESHOLD = 2000;

export async function encodeDoc(json: string): Promise<string> {
  const compressed = await pipeThroughTransform(
    new TextEncoder().encode(json),
    new CompressionStream('gzip'),
  );
  return bytesToUrlSafeB64(compressed);
}

export async function decodeDoc(encoded: string): Promise<string | null> {
  try {
    const bytes = urlSafeB64ToBytes(encoded);
    const out = await pipeThroughTransform(bytes, new DecompressionStream('gzip'));
    return new TextDecoder().decode(out);
  } catch {
    return null;
  }
}

/**
 * Pipe a single Uint8Array chunk through a transform stream and concatenate
 * the result. Avoids `Blob.stream()` (missing in jsdom 29) by going directly
 * to the writer/reader pair.
 *
 * `transform` is typed loosely: the spec for `CompressionStream` accepts
 * `BufferSource` on the write side and emits `Uint8Array` on the read side,
 * but the lib.dom.d.ts shape is awkward to express generically. Cast at the
 * call boundary and trust the runtime.
 */
async function pipeThroughTransform(
  input: Uint8Array,
  transform: { writable: WritableStream<BufferSource>; readable: ReadableStream<Uint8Array> },
): Promise<Uint8Array> {
  // Cast through `any`: the writable side's signature
  // (`BufferSource = ArrayBufferView<ArrayBuffer>`) excludes
  // `Uint8Array<ArrayBufferLike>` after TS 5.7. Runtime is a plain Uint8Array
  // — the cast is safe.
  const writer = (transform.writable as unknown as WritableStream<unknown>).getWriter();
  void writer.write(input);
  void writer.close();
  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export function buildShareUrl(encoded: string, base?: string): string {
  const u = new URL(base ?? window.location.href);
  u.searchParams.set('doc', encoded);
  return u.toString();
}

function bytesToUrlSafeB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function urlSafeB64ToBytes(encoded: string): Uint8Array {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
