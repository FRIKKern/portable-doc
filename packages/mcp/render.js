export const RENDER_PATH = '/v1/plugins/bulldocs/render';
export const MAX_HTML_BYTES = 8 * 1024 * 1024;

export function readerUrl(base) {
  if (!base) return { error: 'render needs BARKPARK_URL, the Barkpark base URL whose reader renders the doc' };
  let url;
  try {
    url = new URL(base);
  } catch {
    return { error: `BARKPARK_URL ${JSON.stringify(base)} is not a URL` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: `BARKPARK_URL must be http or https, got ${url.protocol}` };
  return { url: `${url.origin}${url.pathname.replace(/\/+$/, '')}${RENDER_PATH}` };
}

async function readCapped(response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > MAX_HTML_BYTES) throw new Error(`the reader answered more than ${MAX_HTML_BYTES} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function render(doc, { base, token, timeoutMs }) {
  const target = readerUrl(base);
  if (target.error) return { ok: false, error: target.error };
  if (!token) return { ok: false, error: 'render needs BARKPARK_TOKEN, a Barkpark ingest token or admin API token' };
  const body = JSON.stringify({ blocks: Array.isArray(doc) ? doc : doc.blocks });
  try {
    const response = await fetch(target.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await readCapped(response);
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    if (!response.ok) return { ok: false, error: `the reader answered ${response.status}: ${text.slice(0, 500)}` };
    if (typeof parsed?.html !== 'string') return { ok: false, error: `the reader answered ${response.status} without an html string` };
    return { ok: true, html: parsed.html };
  } catch (e) {
    const reason = e.name === 'TimeoutError' ? `no answer within ${timeoutMs} ms` : e.cause?.message ?? e.message;
    return { ok: false, error: `the reader at ${target.url} failed: ${reason}` };
  }
}
