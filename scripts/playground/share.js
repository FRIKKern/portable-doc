// Share links: the doc text in the URL hash as `#doc=<format>.<base64url>`.
// `deflate` is raw DEFLATE of the UTF-8 text (CompressionStream), `json` is the
// UTF-8 text itself. The shorter one wins; `json` when the browser cannot compress.
// A link opens at most MAX_DOC_BYTES of doc text, so a small link cannot unpack into
// a doc that freezes or crashes the tab. Errors are plain sentences for the status line.

const PREFIX = '#doc=';
// The shipped cap. build.mjs bakes it into the bundle as PLAYGROUND_DOC_CAP; a test build
// sets a smaller one, so every door of the page can be driven with small docs. Unbundled,
// as in node, nothing sets it and the cap is DOC_CAP_BYTES.
export const DOC_CAP_BYTES = 2_000_000;
export const MAX_DOC_BYTES = globalThis.PLAYGROUND_DOC_CAP ?? DOC_CAP_BYTES;

// The one size rule. utf8Length counts the UTF-8 bytes of a text as TextEncoder
// would make them (a lone surrogate is 3 bytes, as U+FFFD), without building them.
// byteSize also passes bytes and byte counts through. overCap is the only place a
// size meets a cap.
export function utf8Length(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
export const byteSize = (x) => (typeof x === 'string' ? utf8Length(x) : typeof x === 'number' ? x : x.byteLength);
export const overCap = (x, limit = MAX_DOC_BYTES) => byteSize(x) > limit;

const SLICE = 1024; // compressed bytes fed per step; one step unpacks to about 1 MB at most

function toBase64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('This link is broken: it has characters a share link never has');
  if (overCap(Math.floor((text.length * 3) / 4))) throw tooBig(); // base64: 4 characters carry 3 bytes
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function tooBig() {
  return new Error(`This link holds a doc too big to open (over ${MAX_DOC_BYTES / 1_000_000} MB)`);
}

function utf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('This link is damaged: its text is not valid UTF-8');
  }
}

async function compress(bytes) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
}

// Unpack in small steps and stop as soon as the output passes the cap. Feeding the
// compressed bytes one slice at a time keeps the stream from unpacking it all at once.
async function inflate(bytes) {
  let at = 0;
  const source = new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(at, (at += SLICE)));
    },
  });
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    let step;
    try {
      step = await reader.read();
    } catch {
      throw new Error('This link is damaged: its compressed doc does not unpack');
    }
    if (step.done) break;
    size += step.value.byteLength;
    if (overCap(size)) {
      reader.cancel().catch(() => {});
      throw tooBig();
    }
    chunks.push(step.value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function encodeShare(text, { compress: pack = typeof CompressionStream === 'function' } = {}) {
  const bytes = new TextEncoder().encode(text);
  if (overCap(bytes)) throw new Error(`This doc is too big to share (over ${MAX_DOC_BYTES / 1_000_000} MB)`);
  const plain = `${PREFIX}json.${toBase64url(bytes)}`;
  if (!pack) return plain;
  const packed = `${PREFIX}deflate.${toBase64url(await compress(bytes))}`;
  return packed.length < plain.length ? packed : plain;
}

// The doc text from a hash, null when the hash carries no doc. Throws on a broken link.
export async function decodeShare(hash) {
  if (!hash.startsWith(PREFIX)) return null;
  const [format, data = ''] = hash.slice(PREFIX.length).split(/\.(.*)/s);
  if (format !== 'json' && format !== 'deflate') throw new Error(`This link uses an unknown format "${format.slice(0, 20)}"`);
  const bytes = fromBase64url(data);
  if (format === 'json') return utf8(bytes);
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open compressed links');
  return utf8(await inflate(bytes));
}
