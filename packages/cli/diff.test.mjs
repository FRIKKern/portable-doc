import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main } from './index.js';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bin', 'portable-doc.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-doc diff-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const write = (value, name = `doc-${n++}.json`) => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  return file;
};
async function call(args, { tty = false } = {}) {
  const r = { stdout: '', stderr: '' };
  const io = { stdout: (t) => void (r.stdout += t), stderr: (t) => void (r.stderr += t), readStdin: async () => '', stdinIsTTY: false, stdoutIsTTY: tty };
  r.status = await main(args, io);
  return r;
}

const p = (id, text) => ({ id, type: 'paragraph', text });
const before = [{ id: 'h', type: 'heading', level: 2, text: 'Plans' }, p('p1', 'The quick brown fox jumps.'), p('p2', 'Stays put.'), p('m', 'Moves up.')];
const afterDoc = [p('m', 'Moves up.'), { id: 'h', type: 'heading', level: 2, text: 'Plans' }, p('p1', 'The quick red fox jumps.'), p('p2', 'Stays put.'), { id: 'c', type: 'callout', tone: 'info', text: 'New.' }];

test('diff reports a changed paragraph with its word diff, an added block and a moved block, and exits 1; equal docs exit 0', async () => {
  const [a, b] = [write(before), write(afterDoc)];
  const r = await call(['diff', a, b]);
  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(r.stdout.split('\n').slice(1), [
    '> paragraph m: moved [3] → [0]',
    '~ paragraph p1: text: The quick [-brown-]{+red+} fox jumps.',
    '+ callout c at [4]',
    '',
  ]);
  assert.match(r.stdout, /^.*doc-0\.json → .*doc-1\.json: 1 added, 0 removed, 1 moved, 1 changed\n/);
  const same = await call(['diff', a, write(JSON.parse(JSON.stringify(before)))]);
  assert.deepEqual([same.status, same.stdout], [0, '']);
});

test('field changes, removed blocks and envelope keys each get a line', async () => {
  const a = write({ title: 'Old', blocks: [{ id: 'h', type: 'heading', level: 2, text: 'Hi' }, { id: 'n', type: 'callout', tone: 'info', text: 'x' }, p('gone', 'Bye.')] });
  const b = write({ title: 'New', blocks: [{ id: 'h', type: 'heading', level: 3, text: 'Hi' }, { id: 'n', type: 'callout', tone: 'warn', text: 'x' }] });
  const r = await call(['diff', a, b]);
  assert.equal(r.status, 1);
  assert.deepEqual(r.stdout.split('\n').slice(1, -1), ['~ doc: title: Old → New', '~ heading h: level: 2 → 3', '~ callout n: tone: info → warn', '- paragraph gone at [2]']);
});

test('--json parses, is the same for docs whose keys are only reordered, and never carries color', async () => {
  const [a, b] = [write(before), write(afterDoc)];
  const r = await call(['diff', '--json', '--color', 'always', a, b]);
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stdout, /\u001b/);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.summary, { added: 1, removed: 0, moved: 1, changed: 1 });
  assert.deepEqual(out.changes.map((c) => [c.kind, c.type, c.id, c.from, c.to]), [['moved', 'paragraph', 'm', 3, 0], ['changed', 'paragraph', 'p1', 1, 2], ['added', 'callout', 'c', null, 4]]);
  assert.deepEqual(out.changes[1].fields, [{ path: 'text', words: [{ op: '=', text: 'The quick ' }, { op: '-', text: 'brown' }, { op: '+', text: 'red' }, { op: '=', text: ' fox jumps.' }] }]);
  const reordered = write(afterDoc.map((blk) => Object.fromEntries(Object.entries(blk).reverse())));
  const again = await call(['diff', '--json', a, reordered]);
  assert.equal(again.stdout.replace(reordered, b), r.stdout);
  assert.equal((await call(['diff', b, reordered])).status, 0);
});

test('blocks without ids match by type and content, in order, so an edit and a move are not shown as remove plus add', async () => {
  const a = write([{ type: 'paragraph', text: 'Alpha beta gamma.' }, { type: 'paragraph', text: 'One two three four.' }, { type: 'divider' }, { type: 'paragraph', text: 'Dropped entirely here.' }]);
  const b = write([{ type: 'paragraph', text: 'One two three five.' }, { type: 'divider' }, { type: 'paragraph', text: 'Alpha beta gamma.' }, { type: 'heading', level: 2, text: 'Dropped entirely here.' }]);
  const out = JSON.parse((await call(['diff', '--json', a, b])).stdout);
  assert.deepEqual(out.summary, { added: 1, removed: 1, moved: 1, changed: 1 });
  assert.deepEqual(out.changes.map((c) => [c.kind, c.type, c.from, c.to]), [['changed', 'paragraph', 1, 0], ['moved', 'paragraph', 0, 2], ['removed', 'paragraph', 3, null], ['added', 'heading', null, 3]]);
  const text = (await call(['diff', a, b])).stdout;
  assert.match(text, /^~ paragraph at \[0\]: text: One two three \[-four\.-\]\{\+five\.\+\}$/m);
});

test('doc text, ids and file names are escaped, so control characters never reach the terminal', async () => {
  const a = write([p('x\u001b[2J', 'Plain words here.')], 'a\u0007.json');
  const b = write([p('x\u001b[2J', 'Plain \u001b]0;pwned\u0007 words \u009b here.'), { type: 'callout', tone: '\u001b[31m', text: 'x' }]);
  for (const args of [['diff', a, b], ['diff', '--color', 'always', a, b]]) {
    const r = await call(args);
    const raw = r.stdout.replace(/\u001b\[\d+m/g, '');
    assert.doesNotMatch(raw, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/, args.join(' '));
    assert.match(raw, /^~ paragraph x\\u001b\[2J: text: Plain \{\+\\u001b\]0;pwned\\u0007 \+\}words \{\+\\u009b \+\}here\.$/m);
  }
});

test('color only on a TTY or with --color always; usage and read errors exit 2', async () => {
  const [a, b] = [write(before), write(afterDoc)];
  assert.doesNotMatch((await call(['diff', a, b])).stdout, /\u001b/);
  assert.match((await call(['diff', a, b], { tty: true })).stdout, /\u001b\[31m\[-brown-\]\u001b\[0m/);
  assert.doesNotMatch((await call(['diff', '--color=never', a, b], { tty: true })).stdout, /\u001b/);
  for (const args of [['diff', a], ['diff', a, path.join(tmp, 'missing.json')], ['diff', a, write('{')], ['diff', a, write('{"blocks":3}')], ['diff', '--color', 'pink', a, b]]) {
    const r = await call(args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /\S/);
  }
});

test('git runs it as an external diff driver: seven arguments, a new file against /dev/null, exit 0 so git goes on', () => {
  const repo = path.join(tmp, `repo-${n++}`);
  fs.mkdirSync(repo);
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: write(''), GIT_CEILING_DIRECTORIES: tmp, GIT_PAGER: 'cat' };
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'diff.portable-doc.command', `'${process.execPath}' '${bin}' diff --git`);
  fs.writeFileSync(path.join(repo, '.gitattributes'), '*.json diff=portable-doc\n');
  fs.writeFileSync(path.join(repo, 'notes.json'), JSON.stringify(before));
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'one');
  fs.writeFileSync(path.join(repo, 'notes.json'), JSON.stringify(afterDoc, null, 2));
  fs.writeFileSync(path.join(repo, 'new.json'), JSON.stringify([p('a', 'Hello.')]));
  git('add', 'new.json');
  const r = spawnSync('git', ['-C', repo, 'diff', 'HEAD'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^portable-doc diff a\/new\.json b\/new\.json: 1 added, 0 removed, 0 moved, 0 changed\n\+ paragraph a at \[0\]\n/m);
  assert.match(r.stdout, /^portable-doc diff a\/notes\.json b\/notes\.json: 1 added, 0 removed, 1 moved, 1 changed\n> paragraph m: moved \[3\] → \[0\]\n/m);
  const usage = spawnSync(process.execPath, [bin, 'diff', '--git', 'only', 'three', 'args'], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
});
