import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// check-links on small git repos. Links are written straight into the index, so the test
// needs none on disk and runs the same on every system.
const scripts = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check links test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CEILING_DIRECTORIES: path.dirname(tmp), GIT_TERMINAL_PROMPT: '0' };
let n = 0;

const git = (root, args, input) => execFileSync('git', ['-C', root, ...args], { env, encoding: 'utf8', input }).trim();
const add = (root, mode, file, content) => {
  const blob = git(root, ['hash-object', '-w', '--stdin'], content);
  git(root, ['update-index', '--add', '--cacheinfo', `${mode},${blob},${file}`]);
};

/** A git repo at `root` with check-links.mjs in scripts/, a link at each `file` to its target, and the `files` given. */
function repo({ links = {}, files = {}, root = path.join(tmp, `repo-${n++}`) } = {}) {
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(scripts, 'check-links.mjs'), path.join(root, 'scripts', 'check-links.mjs'));
  if (!fs.existsSync(path.join(root, '.git'))) git(root, ['init', '-q']);
  git(root, ['add', 'scripts']);
  for (const [file, content] of Object.entries(files)) add(root, '100644', file, content);
  for (const [file, target] of Object.entries(links)) add(root, '120000', file, target);
  return root;
}

const check = (root) => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-links.mjs')], { cwd: root, env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};

test('any committed symbolic link fails the check, named by its path', () => {
  let r = check(repo({ links: { node_modules: '/Users/someone/project/node_modules' } }));
  assert.equal(r.code, 1);
  assert.match(r.out, /"node_modules" is a committed symbolic link/);
  // Two links that each stay inside the repo, and together lead to its parent.
  r = check(repo({ links: { 'a/b/q': '../..', p: 'a/b/q/..' } }));
  assert.equal(r.code, 1);
  assert.match(r.out, /"a\/b\/q" is a committed symbolic link/);
  assert.match(r.out, /"p" is a committed symbolic link/);
});

test('a link still in HEAD is refused after `git rm --cached` takes it out of the index, and a conflicted link is named once', () => {
  const root = repo({ links: { 'docs/link': '../outside' }, files: { 'docs/a.md': 'a' } });
  git(root, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'with a link']);
  git(root, ['rm', '-q', '--cached', 'docs/link']);
  assert.equal(git(root, ['ls-files', 'docs/link']), '', 'the index holds no link');
  let r = check(root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /"docs\/link" is a committed symbolic link/);
  // The same link in the index's three conflict stages, and in HEAD: one line.
  const blob = git(root, ['hash-object', '-w', '--stdin'], 'x');
  git(root, ['update-index', '--index-info'], [1, 2, 3].map((stage) => `120000 ${blob} ${stage}\tdocs/link\n`).join(''));
  r = check(root);
  assert.equal(r.code, 1, r.out);
  assert.equal(r.out.match(/is a committed symbolic link/g).length, 1, r.out);
});

test('a name with a tab, a newline and a space reads whole', () => {
  const name = 'odd/a\tb\nc d';
  let r = check(repo({ links: { [name]: 'x' } }));
  assert.equal(r.code, 1);
  assert.ok(r.out.includes(JSON.stringify(name)), r.out);
  r = check(repo({ files: { [name]: 'text', 'odd/120000 x\ty': 'text' } }));
  assert.equal(r.code, 0, r.out);
});

test('this repo\'s own index passes, and importing the module runs nothing', async () => {
  const r = spawnSync(process.execPath, [path.join(scripts, 'check-links.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const before = process.exitCode;
  const { committedLinks } = await import('./check-links.mjs');
  assert.equal(process.exitCode, before);
  assert.deepEqual(committedLinks(path.join(scripts, '..')), []);
});

test('a copy inside another repo\'s checkout fails, as it cannot read this repo\'s index or HEAD', () => {
  const inner = path.join(repo(), 'inner');
  fs.mkdirSync(path.join(inner, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(scripts, 'check-links.mjs'), path.join(inner, 'scripts', 'check-links.mjs'));
  const r = check(inner);
  assert.equal(r.code, 1);
  assert.match(r.out, /not the top of its git checkout/);
});
