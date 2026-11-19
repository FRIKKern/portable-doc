import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { preview, startPreview } from './preview.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, 'bin', 'portable-doc.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-doc-preview-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const heading = (text) => JSON.stringify({ blocks: [{ type: 'heading', level: 2, text }] });
let n = 0;
const docFile = (content) => {
  const file = path.join(tmp, `doc-${++n}.json`);
  fs.writeFileSync(file, content);
  return file;
};

/** Start `portable-doc preview <file> --port 0`; resolves to { url, child, exited } once it prints its URL. */
function start(file) {
  const child = spawn(process.execPath, [bin, 'preview', file, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  after(() => child.exitCode === null && child.kill('SIGKILL'));
  return new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(out)?.[0];
      if (url) resolve({ url, child, exited });
    });
    child.stderr.on('data', (d) => (out += d));
    exited.then(() => reject(new Error(`preview exited: ${out}`)));
  });
}

const page = async (url) => (await fetch(url)).text();

// Hang deadlines: long enough that no loaded machine reaches them doing the work, so they
// only stop a wait that would never end.
const HANG_MS = 30_000;

/** Open /events and resolve once an event named `name` arrives (or reject after `ms`). */
async function nextEvent(url, name, ms = HANG_MS) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  const res = await fetch(new URL('/events', url), { signal: ac.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body.getReader();
  const ready = (async () => {
    let seen = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`stream ended: ${seen}`);
      seen += Buffer.from(value).toString();
      if (seen.includes(`event: ${name}\n`)) return seen;
    }
  })();
  return {
    // Resolves when the event came; the stream is closed either way.
    event: ready.finally(() => {
      clearTimeout(timer);
      ac.abort();
    }),
  };
}

const waitFor = async (check, ms = HANG_MS) => {
  const end = Date.now() + ms; // hang deadline: only stops a wait that would never end
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out'); // hang deadline
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('preview serves the rendered doc, and a change to the file sends reload on /events', async () => {
  const file = docFile(heading('First draft'));
  const { url, child, exited } = await start(file);
  const html = await page(url);
  assert.match(html, /<link rel="stylesheet" href="\/paper-surface\.css">/);
  assert.match(html, /<div class="bp-paper-surface"><h2>First draft<\/h2><\/div>/);
  const { event } = await nextEvent(url, 'reload');
  // An editor that saves by writing a new file and renaming it over the old one.
  fs.writeFileSync(`${file}.tmp`, heading('Second draft'));
  fs.renameSync(`${file}.tmp`, file);
  await event;
  await waitFor(async () => (await page(url)).includes('<h2>Second draft</h2>'));
  child.kill('SIGINT');
  assert.deepEqual(await exited, { code: 0, signal: null });
});

test('a broken doc shows its reasons, escaped, in explain\'s words, above the last good render', async () => {
  const file = docFile(heading('Good version'));
  const { url, child, exited } = await start(file);
  const rewrite = async (content) => {
    const { event } = await nextEvent(url, 'reload');
    fs.writeFileSync(file, content);
    await event;
    return page(url);
  };
  const badJson = await rewrite('{\n  "blocks": [\n    {"type": nope}\n  ]\n}');
  assert.match(badJson, /bad JSON at line 3, column 14: unexpected &#34;n&#34;/);
  assert.match(badJson, /<h2>Good version<\/h2>/);
  const invalid = await rewrite(JSON.stringify({ blocks: [{ type: '<script>alert(1)</script>' }] }));
  assert.match(invalid, /unknown_block_type at \/blocks\/0\/type, in the &#60;script&#62;alert\(1\)&#60;\/script&#62; block at \/blocks\/0/);
  assert.match(invalid, /Refused when a block&#39;s type is not in the schema&#39;s type enum\./);
  assert.doesNotMatch(invalid, /<script>alert/);
  assert.match(invalid, /<h2>Good version<\/h2>/);
  child.kill('SIGINT');
  assert.equal((await exited).code, 0);
});

/** A raw request, so the path and Host go out exactly as written. */
const raw = (url, { method = 'GET', target, host }) =>
  new Promise((resolve, reject) => {
    const { port } = new URL(url);
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers: host ? { host } : {} }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });

test('only the page, its stylesheet and the event stream are served, on 127.0.0.1 alone', async () => {
  const file = docFile(heading('Fenced'));
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'secret');
  const { url, child, exited } = await start(file);
  const css = await fetch(new URL('/paper-surface.css', url));
  assert.deepEqual([css.status, css.headers.get('content-type'), (await css.text()).includes('.bp-paper-surface')], [200, 'text/css; charset=utf-8', true]);
  const targets = ['/../', '/..%2f', '/%2e%2e/', '/./', '//', '/secret.txt', '/../secret.txt', `/${path.basename(file)}`, '/index.html', '/paper-surface.css/..', '/events/', '/?x=1', 'http://127.0.0.1/'];
  for (const target of targets) assert.equal(await raw(url, { target }), 404, target);
  assert.equal(await raw(url, { method: 'POST', target: '/' }), 404);
  assert.equal(await raw(url, { target: '/', host: 'evil.example' }), 404, 'a foreign Host header');
  assert.equal(await raw(url, { target: '/' }), 200);
  // Bound to the IPv4 loopback alone: the same port on any other address refuses.
  const { port } = new URL(url);
  const others = ['::1', ...Object.values(os.networkInterfaces()).flat().filter((i) => !i.internal && i.family === 'IPv4').map((i) => i.address)];
  for (const host of others) {
    const refused = await new Promise((resolve) => {
      const req = http.get({ host, port, path: '/', timeout: 1000 }, (res) => (res.resume(), resolve(false)));
      req.on('error', () => resolve(true));
      req.on('timeout', () => (req.destroy(), resolve(true)));
    });
    assert.ok(refused, `${host}:${port} answered`);
  }
  child.kill('SIGINT');
  assert.equal((await exited).code, 0);
});

test('Ctrl-C closes the open event stream and the watcher, and the process exits by itself', async () => {
  const { url, child, exited } = await start(docFile(heading('Bye')));
  const res = await fetch(new URL('/events', url));
  const ended = res.text();
  child.kill('SIGINT');
  assert.deepEqual(await exited, { code: 0, signal: null });
  assert.match(await ended, /event: hello\n/);
});

test('preview refuses stdin, a missing file and a bad port, and says what to build without the renderer', async () => {
  // `blocked` specifiers fail to resolve, as when a package is not installed or not built.
  const run = (args, blocked = []) =>
    new Promise((resolve) => {
      const hooks = `export async function resolve(s, c, next) { if (${JSON.stringify(blocked)}.includes(s)) { const e = new Error('not found: ' + s); e.code = 'ERR_MODULE_NOT_FOUND'; throw e; } return next(s, c); }`;
      const register = `import { register } from 'node:module'; register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(hooks)}`)});`;
      const child = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(register)}`, bin, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      child.stderr.on('data', (d) => (err += d));
      child.on('exit', (code) => resolve({ code, err }));
    });
  for (const args of [['preview'], ['preview', '-'], ['preview', path.join(tmp, 'missing.json')], ['preview', docFile('[]'), '--port', 'x']]) {
    assert.equal((await run(args)).code, 2, args.join(' '));
  }
  const unbuilt = await run(['preview', docFile('[]'), '--port', '0'], ['@portable-doc/react']);
  assert.deepEqual([unbuilt.code, /run "npm run react:build"/.test(unbuilt.err)], [2, true], unbuilt.err);
});

// In process, with a stand-in doc and renderer: enough to reach the server and the watcher.
const fakes = { load: async (file) => ({ name: file, doc: { blocks: [] } }), renderHtml: async () => ({ html: '<p>Rendered.</p>' }), io: { stdout() {}, stderr() {} } };

test('a watcher error shows on the page as a problem, and the server stays up', async () => {
  const watcher = Object.assign(new EventEmitter(), { close() {} });
  const session = await startPreview({ ...fakes, file: docFile(heading('Watched')), port: 0, watch: () => watcher });
  try {
    const { event } = await nextEvent(session.url, 'reload');
    watcher.emit('error', Object.assign(new Error('EPERM: operation not permitted, watch'), { code: 'EPERM' }));
    await event;
    const html = await page(session.url);
    assert.match(html, /1 problem, so this version is not shown/);
    assert.match(html, /changes are no longer watched \(EPERM: operation not permitted, watch\)/);
    assert.match(html, /<p>Rendered\.<\/p>/, 'the last render stays');
  } finally {
    await session.close();
  }
});

test("the page's CSP forbids framing it: frame-ancestors 'none'", async () => {
  const session = await startPreview({ ...fakes, file: docFile(heading('Framed')), port: 0 });
  try {
    const csp = (await fetch(session.url)).headers.get('content-security-policy');
    assert.match(csp, /(^|; )frame-ancestors 'none'(;|$)/);
  } finally {
    await session.close();
  }
});

test('when the default port and the fallback both fail, the message names the default port, not undefined', async () => {
  let err = '';
  const io = { stdout() {}, stderr: (t) => void (err += t) };
  const start = async () => {
    throw Object.assign(new Error('listen EACCES: permission denied'), { code: 'EACCES' });
  };
  const code = await preview([docFile(heading('Busy'))], {}, io, { ...fakes, UsageError: Error, start });
  assert.equal(code, 2);
  assert.equal(err, 'portable-doc preview: cannot listen on 127.0.0.1:4317 or on any free port: listen EACCES: permission denied\n');
});

/** GET /events on a raw request; resolves once `hello` is in, to { res, text(), outcome }. */
function openStream(url) {
  return new Promise((resolve, reject) => {
    http.get(new URL('/events', url), (res) => {
      let text = '';
      const outcome = new Promise((done) => {
        res.on('end', () => done('end'));
        res.on('aborted', () => done('aborted'));
        res.on('error', (error) => done(`error ${error.code}`));
        res.on('close', () => setImmediate(() => done('closed without an end')));
      });
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (!text) resolve({ res, text: () => text, outcome });
        text += chunk;
      });
    }).on('error', reject);
  });
}

// Each watcher error sends one reload. EVENTS is more than the socket buffers between server
// and client hold (about 20,000 on macOS loopback, measured), so a paused stream's end waits
// behind data the server has not sent yet. The never-reads test below fails if they hold it all.
const EVENTS = 40_000;

test('stopping the server ends each open /events stream cleanly, even one far behind on reading: it gets every event, then the end', async () => {
  const watcher = Object.assign(new EventEmitter(), { close() {} });
  const session = await startPreview({ ...fakes, file: docFile(heading('Stops')), port: 0, watch: () => watcher });
  const reading = await openStream(session.url);
  const behind = await openStream(session.url);
  behind.res.pause();
  const events = EVENTS;
  for (let i = 0; i < events; i++) watcher.emit('error', new Error('gone'));
  // The grace is a hang deadline here: the paused stream drains as fast as the machine allows.
  const closed = session.close({ graceMs: HANG_MS });
  behind.res.resume();
  await closed;
  for (const stream of [reading, behind]) {
    assert.equal(await stream.outcome, 'end');
    assert.equal(stream.text().split('event: reload\n').length - 1, events);
  }
});

test('a client that never reads cannot hold the stop: close() cuts it once the grace is up', async () => {
  const watcher = Object.assign(new EventEmitter(), { close() {} });
  const session = await startPreview({ ...fakes, file: docFile(heading('Stuck')), port: 0, watch: () => watcher });
  const stuck = await openStream(session.url);
  stuck.res.pause();
  for (let i = 0; i < EVENTS; i++) watcher.emit('error', new Error('gone'));
  // The stuck stream's end can never be sent, so close() returns only because the grace ran out.
  await session.close({ graceMs: 20 });
  stuck.res.resume();
  // Were the socket buffers to hold all EVENTS, the end would go out and this would be 'end'.
  assert.equal(await stuck.outcome, 'aborted');
});
