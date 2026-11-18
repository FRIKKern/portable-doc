// Share links: the doc text in the URL hash as `#doc=<format>.<base64url>`.
// `deflate` is raw DEFLATE of the UTF-8 text (CompressionStream), `json` is the
// UTF-8 text itself. The shorter one wins; `json` when the browser cannot compress.
// A link opens at most MAX_DOC_BYTES of doc text, so a small link cannot unpack into
// a doc that freezes or crashes the tab. Errors are plain sentences for the status line.

const PREFIX = '#doc=';
export const MAX_DOC_BYTES = 2_000_000;
const SLICE = 1024; // compressed bytes fed per step; one step unpacks to about 1 MB at most

function toBase64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('This link is broken: it has characters a share link never has');
  if (Math.floor((text.length * 3) / 4) > MAX_DOC_BYTES) throw tooBig();
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
    size += step.value.length;
    if (size > MAX_DOC_BYTES) {
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
  if (bytes.length > MAX_DOC_BYTES) throw new Error(`This doc is too big to share (over ${MAX_DOC_BYTES / 1_000_000} MB)`);
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
