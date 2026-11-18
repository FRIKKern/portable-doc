import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

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

/** Open /events and resolve once an event named `name` arrives (or reject after `ms`). */
async function nextEvent(url, name, ms = 4000) {
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

const waitFor = async (check, ms = 4000) => {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
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
