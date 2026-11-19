// SPDX-License-Identifier: Apache-2.0
// `portable-doc preview`: one doc, rendered by @portable-doc/react, served on
// 127.0.0.1 and reloaded through server-sent events whenever its file changes.
// It serves the page, its stylesheet and the event stream, and nothing else.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '@portable-doc/validate';
import { explainError, shown } from './words.js';

const HOST = '127.0.0.1';
// How long stopping waits for open /events streams to take their end. Only a client that
// never reads uses it up; it is a deadline on that wait, not a measure of work.
export const CLOSE_GRACE_MS = 1000;

/**
 * The command's grace, from PORTABLE_DOC_CLOSE_GRACE_MS: CLOSE_GRACE_MS when it is unset or
 * empty, else a whole number of milliseconds, 0 or more. Anything else throws, naming it.
 */
export function closeGraceMs(env = process.env) {
  const value = env.PORTABLE_DOC_CLOSE_GRACE_MS ?? '';
  if (value === '') return CLOSE_GRACE_MS;
  if (/^\d+$/.test(value) && Number.isSafeInteger(Number(value))) return Number(value);
  throw new Error(`PORTABLE_DOC_CLOSE_GRACE_MS must be a whole number of milliseconds, 0 or more, not "${shown(value)}"`);
}
const DEFAULT_PORT = 4317;
const DEBOUNCE_MS = 120;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The stylesheet the built renderer ships: @portable-doc/react/paper-surface.css, i.e. its dist/paper-surface.css. */
function stylesheet() {
  try {
    return fs.readFileSync(fileURLToPath(import.meta.resolve('@portable-doc/react/paper-surface.css')));
  } catch {
    return null;
  }
}

/** The doc's problems as explain words, one list of lines per problem; [] when it is valid. */
function problemsOf(input) {
  if (input.failure) return [[`${input.name}: ${input.failure.message}`]];
  const result = validate(input.doc);
  return result.ok ? [] : result.errors.map((e) => explainError(e, input.doc));
}

function pageHtml({ title, problems, body, nonce }) {
  const reasons = problems.length
    ? `<section class="pd-problems" role="alert">
<h2>${problems.length === 1 ? '1 problem' : `${problems.length} problems`}, so this version is not shown</h2>
<ol>${problems.map((lines) => `<li>${lines.map((l) => `<p>${esc(l)}</p>`).join('')}</li>`).join('')}</ol>
<p>${body ? 'Below is the last version that rendered.' : 'Nothing has rendered yet.'}</p>
</section>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/paper-surface.css">
<style>
body { margin: 0; padding: 2rem 1rem; background: Canvas; color: CanvasText; }
main { max-width: 48rem; margin: 0 auto; }
.pd-problems { font: 15px/1.5 system-ui, sans-serif; border: 1px solid #c2410c; border-radius: 6px; padding: 0.5rem 1rem; margin-bottom: 2rem; }
.pd-problems h2 { font-size: 1rem; margin: 0.5rem 0; }
.pd-problems li p { margin: 0.25rem 0; overflow-wrap: anywhere; }
</style>
<script nonce="${nonce}">
const dark = matchMedia('(prefers-color-scheme: dark)');
const theme = () => { document.documentElement.dataset.theme = dark.matches ? 'dark' : 'light'; };
theme();
dark.addEventListener('change', theme);
new EventSource('/events').addEventListener('reload', () => location.reload());
</script>
</head>
<body>
<main>
${reasons}${body ?? ''}
</main>
</body>
</html>
`;
}

/**
 * Serve `file` until stopped. `deps` are the CLI's own `load` (read + parse,
 * with explain's words for a failure) and `renderHtml`, so the page says and
 * shows exactly what `explain` and `render --format html` do.
 * Resolves to { url, close({ graceMs }), waiting() } once it listens; `port` undefined tries 4317, then any free port.
 * `watch` is fs.watch, replaceable in tests.
 */
export async function startPreview({ file, port, load, renderHtml, io, watch = fs.watch }) {
  const css = stylesheet();
  const state = { title: path.basename(file), problems: [], body: null, version: 0 };
  const clients = new Set();

  const reload = () => {
    state.version++;
    for (const res of clients) res.write(`event: reload\ndata: ${state.version}\n\n`);
  };

  let running = null;
  let again = false;
  async function refresh() {
    if (running) return void (again = true);
    running = (async () => {
      do {
        again = false;
        const input = await load(file, io);
        const problems = problemsOf(input);
        if (!problems.length) {
          try {
            const r = await renderHtml(input.doc);
            if (r.html) state.body = r.html;
            else problems.push([r.missing]);
          } catch (error) {
            problems.push([`${state.title}: the renderer failed: ${shown(error?.message ?? error)}`]);
          }
        }
        state.problems = problems;
        reload();
      } while (again);
    })();
    try {
      await running;
    } finally {
      running = null;
    }
  }
  await refresh();

  // Watch the directory, not the file: an editor that saves by renaming a new
  // file over the old one replaces the inode a file watch would hold.
  let timer = null;
  const base = path.basename(file);
  const watcher = watch(path.dirname(path.resolve(file)), (_event, name) => {
    if (name !== null && name !== undefined && String(name) !== base) return;
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), DEBOUNCE_MS);
  });
  // A watch that fails (on Windows, deleting the watched folder) is a problem
  // on the page, as a deleted file is; the server keeps serving the last render.
  watcher.on('error', (error) => {
    clearTimeout(timer);
    state.problems = [[`${state.title}: changes are no longer watched (${shown(error?.message ?? error)}); restart preview to follow them`]];
    reload();
  });

  const server = http.createServer((req, res) => {
    const send = (status, type, body, extra = {}) => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    // Only the three paths, spelled exactly, for GET or HEAD from this host.
    const { port: own } = server.address();
    const hostOk = req.headers.host === `${HOST}:${own}` || req.headers.host === `localhost:${own}`;
    if (!hostOk || (req.method !== 'GET' && req.method !== 'HEAD')) return send(404, 'text/plain; charset=utf-8', 'Not found\n');
    if (req.url === '/') {
      const nonce = crypto.randomBytes(16).toString('base64');
      const csp = `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src * data: blob:; media-src *; frame-src *; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
      return send(200, 'text/html; charset=utf-8', pageHtml({ ...state, nonce }), { 'content-security-policy': csp });
    }
    if (req.url === '/paper-surface.css') return send(200, 'text/css; charset=utf-8', css);
    if (req.url === '/events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`retry: 1000\nevent: hello\ndata: ${state.version}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return undefined;
    }
    return send(404, 'text/plain; charset=utf-8', 'Not found\n');
  });

  await new Promise((resolve, reject) => {
    const listen = (p) => {
      server.once('error', (error) => {
        // The default port is busy: take any free one instead.
        if (error.code === 'EADDRINUSE' && port === undefined && p !== 0) return listen(0);
        reject(error);
      });
      server.listen(p, HOST, () => {
        server.removeAllListeners('error');
        server.on('error', (error) => io.stderr(`portable-doc preview: ${shown(error.message)}\n`));
        resolve();
      });
    };
    listen(port ?? DEFAULT_PORT);
  }).catch((error) => {
    watcher.close();
    throw error;
  });

  // Stop listening, end every open stream and wait until each end is sent, so a tab sees the
  // stream finish, not a cut. A client that never reads is cut after `graceMs`.
  const close = ({ graceMs = CLOSE_GRACE_MS } = {}) =>
    new Promise((resolve) => {
      clearTimeout(timer);
      watcher.close();
      server.close(() => resolve());
      const ended = [...clients].map((res) => new Promise((done) => {
        res.once('finish', done);
        res.once('close', done);
        res.end();
      }));
      clients.clear();
      const deadline = setTimeout(() => server.closeAllConnections(), graceMs);
      // Every end is sent: any socket still open (a browser keeps one idle) can go now.
      Promise.all(ended).then(() => {
        clearTimeout(deadline);
        server.closeAllConnections();
      });
    });
  // How many open /events streams have writes held back, waiting on a client that reads
  // slower than the server sends: their socket buffers are full.
  const waiting = () => [...clients].filter((res) => res.writableNeedDrain).length;
  return { url: `http://${HOST}:${server.address().port}/`, close, waiting };
}

function openBrowser(url, io) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => io.stderr(`portable-doc: could not run ${cmd}; open ${url} yourself\n`));
  child.unref();
}

/** The `preview` command. Runs until SIGINT or SIGTERM, then resolves to its exit code. */
export async function preview(files, opts, io, { load, renderHtml, UsageError, start = startPreview }) {
  if (files.length !== 1 || files[0] === '-') throw new UsageError('give one doc file; preview watches it, so stdin will not do');
  let port;
  if (opts.port !== undefined) {
    port = Number(opts.port);
    if (!/^\d+$/.test(opts.port) || port > 65535) throw new UsageError(`--port must be 0 to 65535, not "${shown(opts.port)}"`);
  }
  const [file] = files;
  let graceMs;
  try {
    graceMs = closeGraceMs();
  } catch (error) {
    return io.stderr(`portable-doc preview: ${error.message}\n`), 2;
  }
  const probe = await renderHtml([]);
  if (probe.missing || stylesheet() === null) return io.stderr(`portable-doc: ${probe.missing ?? 'html needs @portable-doc/react built; run "npm run react:build" in the repo'}\n`), 2;
  const first = await load(file, io);
  if (first.failure?.kind === 'read') return io.stderr(`${first.name}: ${first.failure.message}\n`), 2;

  let session;
  try {
    session = await start({ file, port, load, renderHtml, io });
  } catch (error) {
    const where = port === undefined ? `${HOST}:${DEFAULT_PORT} or on any free port` : `${HOST}:${port}`;
    return io.stderr(`portable-doc preview: cannot listen on ${where}: ${shown(error.message)}\n`), 2;
  }
  io.stdout(`Previewing ${shown(file)} at ${session.url} (Ctrl-C stops)\n`);
  if (opts.open) openBrowser(session.url, io);
  await new Promise((resolve) => {
    const stop = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      resolve();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
  await session.close({ graceMs });
  return 0;
}
