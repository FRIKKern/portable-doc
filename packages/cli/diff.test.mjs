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

test('field changes, marks in inline content, removed blocks and envelope keys each get a line', async () => {
  const a = write({ title: 'Old', blocks: [{ id: 'h', type: 'heading', level: 2, text: 'Hi' }, { id: 'n', type: 'callout', tone: 'info', text: 'x' }, { id: 'q', type: 'paragraph', content: [{ type: 'text', value: 'Say it plainly' }] }, p('gone', 'Bye.')] });
  const b = write({ title: 'New', blocks: [{ id: 'h', type: 'heading', level: 3, text: 'Hi' }, { id: 'n', type: 'callout', tone: 'warn', text: 'x' }, { id: 'q', type: 'paragraph', content: [{ type: 'text', value: 'Say it ' }, { type: 'text', value: 'plainly', marks: ['bold'] }] }] });
  const r = await call(['diff', a, b]);
  assert.equal(r.status, 1);
  assert.deepEqual(r.stdout.split('\n').slice(1, -1), ['~ doc: title: Old → New', '~ heading h: level: 2 → 3', '~ callout n: tone: info → warn', '~ paragraph q: content: Say it [-plainly-]{+**plainly**+}', '- paragraph gone at [3]']);
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
    assert.match(raw, /^~ paragraph x\\u001b\[2J: text: Plain \{\+\\u001b\]0;pwned\\u0007 \+\}words\{\+ \\u009b\+\} here\.$/m);
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

// A temp repo set up with the README's own lines for one driver, run through sh, with `npx` a stub for this bin.
function readmeRepo(driver) {
  const repo = path.join(tmp, `repo-${n++}`);
  const stub = path.join(tmp, `stub-${n++}`);
  fs.mkdirSync(repo);
  fs.mkdirSync(stub);
  fs.writeFileSync(path.join(stub, 'npx'), `#!/bin/sh\nshift\nexec '${process.execPath}' '${bin}' "$@"\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${stub}${path.delimiter}${process.env.PATH}`, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: write(''), GIT_CEILING_DIRECTORIES: tmp, GIT_PAGER: 'cat' };
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' });
  git('init', '-q');
  const readme = fs.readFileSync(path.join(path.dirname(bin), '..', 'README.md'), 'utf8');
  const lines = readme.split('\n').filter((l) => l.startsWith(`echo '*.pd.json diff=${driver}'`) || l.startsWith(`git config diff.${driver}.`));
  assert.equal(lines.length, 2, `README lines for ${driver}`);
  for (const line of lines) execFileSync('sh', ['-c', line], { cwd: repo, env });
  return { repo, env, git, diff: (...args) => spawnSync('git', ['-C', repo, 'diff', ...args], { env, encoding: 'utf8' }) };
}

test('the README external diff driver: seven arguments, a new file, a rename, a broken side, and always exit 0 so git goes on', () => {
  const { repo, git, diff } = readmeRepo('portable-doc');
  const put = (name, value) => fs.writeFileSync(path.join(repo, name), typeof value === 'string' ? value : JSON.stringify(value));
  put('notes.pd.json', before);
  put('old-name.pd.json', [p('r', 'Renamed only.')]);
  put('b-broken.pd.json', [p('k', 'Fine for now.')]);
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'one');
  put('notes.pd.json', JSON.stringify(afterDoc, null, 2));
  put('new.pd.json', [p('a', 'Hello.')]);
  put('b-broken.pd.json', '{"blocks": [');
  git('mv', 'old-name.pd.json', 'z-new-name.pd.json');
  git('add', '.');
  const r = diff('--cached');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^portable-doc diff a\/b-broken\.pd\.json b\/b-broken\.pd\.json: b\/b-broken\.pd\.json: bad JSON at line 1, column 13: the text ends too early\n/m);
  assert.match(r.stdout, /^portable-doc diff a\/new\.pd\.json b\/new\.pd\.json: 1 added, 0 removed, 0 moved, 0 changed\n\+ paragraph a at \[0\]\n/m);
  assert.match(r.stdout, /^portable-doc diff a\/notes\.pd\.json b\/notes\.pd\.json: 1 added, 0 removed, 1 moved, 1 changed\n> paragraph m: moved \[3\] → \[0\]\n/m);
  assert.match(r.stdout, /^portable-doc diff a\/old-name\.pd\.json b\/z-new-name\.pd\.json: the same blocks; only the JSON layout differs\n/m);
  const usage = spawnSync(process.execPath, [bin, 'diff', '--git', 'only', 'three', 'args'], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
});

test('the README textconv driver: git diffs the rendered text, and shows the raw file when it does not parse', () => {
  const { repo, git, diff } = readmeRepo('portable-doc-text');
  fs.writeFileSync(path.join(repo, 'notes.pd.json'), JSON.stringify(before));
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'one');
  fs.writeFileSync(path.join(repo, 'notes.pd.json'), JSON.stringify(afterDoc, null, 2));
  const r = diff();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^-The quick brown fox jumps\.\n\+The quick red fox jumps\.$/m);
  fs.writeFileSync(path.join(repo, 'notes.pd.json'), '{"blocks": [\n');
  const broken = diff();
  assert.equal(broken.status, 0, broken.stderr);
  assert.match(broken.stdout, /^\+\{"blocks": \[$/m);
});

test('a doc nested past the limit is refused with a clear message, and a string that reads as a number prints quoted', async () => {
  const deep = write(`{"blocks":[{"type":"paragraph","x":${'['.repeat(5000)}${']'.repeat(5000)}}]}`);
  const r = await call(['diff', write(before), deep]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /: nested deeper than 1000 levels\n$/);
  const quoted = await call(['diff', write([{ id: 'h', type: 'heading', level: '2', text: 'x' }]), write([{ id: 'h', type: 'heading', level: 2, text: 'x' }])]);
  assert.match(quoted.stdout, /^~ heading h: level: "2" → 2$/m);
});
