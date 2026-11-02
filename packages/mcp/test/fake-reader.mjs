import fs from 'node:fs';
import http from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import { RENDER_PATH } from '../render.js';

const goldensDir = new URL('../../../goldens/blocks/', import.meta.url);
export const GOLDENS = fs.readdirSync(goldensDir).filter((f) => f.endsWith('.golden.json')).sort()
  .map((f) => JSON.parse(fs.readFileSync(new URL(f, goldensDir), 'utf8')));

export const FAKE_TOKEN = 'fake-reader-token';

const withoutId = ({ id, ...block }) => block;

export function readerHtml(blocks) {
  const parts = blocks.map((block) => GOLDENS.find((g) => isDeepStrictEqual(g.input, withoutId(block)))?.expectedHtml);
  return parts.includes(undefined) ? null : parts.join('');
}

export async function startFakeReader({ status, delayMs = 0, raw, token = FAKE_TOKEN } = {}) {
  const requests = [];
  const timers = new Set();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      const reply = (code, value) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(typeof value === 'string' ? value : JSON.stringify(value));
      };
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (req.headers.authorization !== `Bearer ${token}`) return reply(401, { error: { code: 'unauthorized', message: 'invalid ingest token' } });
        if (raw !== undefined) return reply(status ?? 200, raw);
        if (status) return reply(status, { error: { code: 'fake', message: `fake reader answers ${status}` } });
        if (req.method !== 'POST' || req.url !== RENDER_PATH) return reply(404, { error: { code: 'not_found' } });
        const html = readerHtml(JSON.parse(body).blocks);
        if (html === null) return reply(422, { error: { code: 'no_golden', message: 'the fake reader serves golden blocks only' } });
        reply(200, { html });
      }, delayMs);
      timers.add(timer);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => {
      timers.forEach(clearTimeout);
      server.closeAllConnections();
      server.close(resolve);
    }),
  };
}
