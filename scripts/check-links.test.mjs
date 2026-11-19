import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// check-links on small git repos with planted links: written straight into the index, so the
// test needs no link on disk and runs the same on every system.
const scripts = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check links test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CEILING_DIRECTORIES: path.dirname(tmp), GIT_TERMINAL_PROMPT: '0' };
let n = 0;

const git = (root, args, input) => execFileSync('git', ['-C', root, ...args], { env, encoding: 'utf8', input }).trim();

/** A repo holding check-links.mjs and a link at each `file` to its `target`. */
function repo(links) {
  const root = path.join(tmp, `repo-${n++}`);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(scripts, 'check-links.mjs'), path.join(root, 'scripts', 'check-links.mjs'));
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  for (const [file, target] of Object.entries(links)) {
    const blob = git(root, ['hash-object', '-w', '--stdin'], target);
    git(root, ['update-index', '--add', '--cacheinfo', `120000,${blob},${file}`]);
  }
  return root;
}

const check = (root) => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-links.mjs')], { cwd: root, env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};

test('a committed link to an absolute path, or one that climbs out of the repo, is refused', () => {
  for (const [file, target] of [
    ['node_modules', '/Users/someone/project/node_modules'],
    ['packages/text/shared', '../../../elsewhere'],
    ['up', '..'],
    ['win', 'C:\\project\\node_modules'],
  ]) {
    const { code, out } = check(repo({ [file]: target }));
    assert.equal(code, 1, `${file} -> ${target}`);
    assert.match(out, new RegExp(`${file}: a committed link to .*; its target is (an absolute path|outside the repo)`));
  }
});

test('a relative link that stays inside the repo passes', () => {
  const { code, out } = check(repo({ 'packages/text/README-link.md': '../../README.md', 'docs/here': './a/../b' }));
  assert.equal(code, 0, out);
});
