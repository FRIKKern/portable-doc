// Share links: the doc text in the URL hash as `#doc=<format>.<base64url>`.
// `deflate` is raw DEFLATE of the UTF-8 text (CompressionStream), `json` is the
// UTF-8 text itself. The shorter one wins; `json` when the browser cannot compress.

const PREFIX = '#doc=';

function toBase64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('the link is not valid base64url');
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function through(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function encodeShare(text, { compress = typeof CompressionStream === 'function' } = {}) {
  const bytes = new TextEncoder().encode(text);
  const plain = `${PREFIX}json.${toBase64url(bytes)}`;
  if (!compress) return plain;
  const packed = `${PREFIX}deflate.${toBase64url(await through(bytes, new CompressionStream('deflate-raw')))}`;
  return packed.length < plain.length ? packed : plain;
}

// The doc text from a hash, null when the hash carries no doc. Throws on a broken link.
export async function decodeShare(hash) {
  if (!hash.startsWith(PREFIX)) return null;
  const [format, data = ''] = hash.slice(PREFIX.length).split(/\.(.*)/s);
  const bytes = fromBase64url(data);
  if (format === 'json') return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (format !== 'deflate') throw new Error(`unknown link format "${format}"`);
  if (typeof DecompressionStream !== 'function') throw new Error('this browser cannot open compressed links');
  return new TextDecoder('utf-8', { fatal: true }).decode(await through(bytes, new DecompressionStream('deflate-raw')));
}
