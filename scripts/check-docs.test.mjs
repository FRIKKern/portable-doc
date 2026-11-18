import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// The README timeline rule in check-docs, on small git repos with an origin/main ref.
const scripts = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check docs test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
fs.writeFileSync(path.join(tmp, 'gitconfig'), '[user]\n\tname = t\n\temail = t@example.invalid\n[init]\n\tdefaultBranch = main\n');
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(tmp, 'gitconfig'), GIT_CEILING_DIRECTORIES: path.dirname(tmp), GIT_TERMINAL_PROMPT: '0' };
let n = 0;

const readme = (timeline, intro = 'A doc format.') => `# synthetic\n\n${intro}\n\n<!-- timeline:start -->\n- **Today** · ${timeline}\n<!-- timeline:end -->\n`;
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { env, encoding: 'utf8' });
const commit = (root, message) => git(root, 'commit', '-qam', message);
const setReadme = (root, text) => fs.writeFileSync(path.join(root, 'README.md'), text);
const checkDocs = (root, ...args) => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-docs.mjs'), ...args], { cwd: root, env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};

/** A repo on main with origin/main at its one commit, and a branch "feat" checked out from it. */
function repo() {
  const root = path.join(tmp, `repo-${n++}`);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(scripts, 'check-docs.mjs'), path.join(root, 'scripts', 'check-docs.mjs'));
  setReadme(root, readme('1 change'));
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  commit(root, 'base');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(root, 'checkout', '-qb', 'feat');
  return root;
}

const RULE = /README\.md: the timeline block differs from origin\/main at [0-9a-f]{12}; the README timeline block is written on main only, by the housekeeping job/;

test('check-docs refuses a branch whose README timeline block differs from main\'s, and names the rule; the rest of the README is checked as before', () => {
  const root = repo();
  setReadme(root, readme('2 changes'));
  let r = checkDocs(root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, RULE);
  commit(root, 'edit the block');
  assert.match(checkDocs(root).out, RULE, 'committed or not');
  setReadme(root, readme('1 change', 'A doc format, [broken](gone.md).'));
  r = checkDocs(root);
  assert.equal(r.code, 1, r.out);
  assert.doesNotMatch(r.out, /timeline/);
  assert.match(r.out, /README\.md: broken link gone\.md/);
});

test('the same branch with main\'s timeline block passes, also after main refreshes its own block and the branch merges it', () => {
  const root = repo();
  setReadme(root, readme('1 change', 'A doc format, changed on the branch.'));
  commit(root, 'branch work');
  assert.equal(checkDocs(root).code, 0);
  git(root, 'checkout', '-q', 'main');
  setReadme(root, readme('5 changes'));
  commit(root, 'refresh the timeline');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(root, 'checkout', '-q', 'feat');
  let r = checkDocs(root);
  assert.equal(r.code, 0, `the branch keeps the block at its merge-base: ${r.out}`);
  git(root, 'merge', '-q', '--no-edit', 'origin/main');
  r = checkDocs(root);
  assert.equal(r.code, 0, r.out);
  assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /changed on the branch[\s\S]*5 changes/);
});

test('the housekeeping job\'s --timeline-from-job lets a freshly regenerated block pass on main, and skips only that rule', () => {
  const root = repo();
  git(root, 'checkout', '-q', 'main');
  setReadme(root, readme('3 changes'));
  assert.match(checkDocs(root).out, RULE, 'without the flag');
  const r = checkDocs(root, '--timeline-from-job');
  assert.equal(r.code, 0, r.out);
  setReadme(root, readme('3 changes', '[broken](gone.md)'));
  assert.match(checkDocs(root, '--timeline-from-job').out, /broken link gone\.md/);
  assert.match(fs.readFileSync(path.join(scripts, '..', '.github', 'workflows', 'housekeeping.yml'), 'utf8'), /node scripts\/check-docs\.mjs --timeline-from-job\n/);
});

test('a folder copy with no .git of its own passes and says the timeline rule is skipped, also inside another git repo; its links are still checked', () => {
  const outer = path.join(tmp, `outer-${n++}`);
  fs.mkdirSync(outer);
  git(outer, 'init', '-q');
  for (const root of [path.join(tmp, `plain-${n++}`), path.join(outer, 'download')]) {
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(scripts, 'check-docs.mjs'), path.join(root, 'scripts', 'check-docs.mjs'));
    setReadme(root, readme('9 changes'));
    fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'x', 'README.md'), '[gone](gone.md)\n');
    let r = checkDocs(root);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out, 'docs: not a git checkout of this repo, so the README timeline rule is skipped\ndocs ok: 1 files, README 7 lines\n');
    fs.mkdirSync(path.join(root, 'docs'));
    fs.writeFileSync(path.join(root, 'docs', 'x.md'), '[gone](gone.md)\n');
    r = checkDocs(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /docs\/x\.md: broken link gone\.md/);
  }
});

test('a git checkout fails and says why when origin/main does not resolve, with the fetch hint, or shares no commit with HEAD', () => {
  const root = repo();
  git(root, 'update-ref', '-d', 'refs/remotes/origin/main');
  let r = checkDocs(root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /README\.md: cannot check the timeline block: origin\/main does not resolve here \(git fetch origin main\)/);
  git(root, 'checkout', '-q', '--orphan', 'other');
  commit(root, 'unrelated');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(root, 'checkout', '-q', 'feat');
  r = checkDocs(root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /cannot check the timeline block: HEAD and origin\/main share no commit/);
});
