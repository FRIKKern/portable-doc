import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BARKPARK_PACK, BARKPARK_REPO, hashes, sha256 } from './lib/pack.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function stamp(packRoot) {
  const goldens = path.join(packRoot, 'goldens');
  const files = {};
  for (const [f, h] of Object.entries(hashes(packRoot))) if (f.startsWith('goldens/') && f !== 'goldens/stamp.json') files[f.slice(8)] = h;
  write(path.join(goldens, 'stamp.json'), `${JSON.stringify({ render_version: 'synthetic', files }, null, 2)}\n`);
}

function pack(packRoot, { blocks = 80, tag = 'a', locale = true } = {}) {
  write(path.join(packRoot, 'spec', 'blocks.schema.json'), `{"title":"synthetic ${tag}"}\n`);
  for (let i = 0; i < blocks; i++) write(path.join(packRoot, 'goldens', 'blocks', `b${i}.golden.json`), `{"block":${i},"tag":"${tag}"}\n`);
  if (locale) write(path.join(packRoot, 'goldens', 'locales', 'nb.golden.json'), `{"tag":"${tag}"}\n`);
  stamp(packRoot);
  return packRoot;
}

function source(root) {
  write(path.join(root, 'SOURCE.json'), JSON.stringify({ repo: BARKPARK_REPO, commit: 'a'.repeat(40), path: BARKPARK_PACK, files: hashes(root) }));
  return root;
}

function editSource(root, edit) {
  const file = path.join(root, 'SOURCE.json');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(value);
  write(file, JSON.stringify(value));
}

function repo(opts) {
  const dir = path.join(tmp, `repo-${n++}`);
  return source(pack(dir, opts));
}

function barkpark(opts) {
  const dir = path.join(tmp, `barkpark-${n++}`);
  pack(path.join(dir, BARKPARK_PACK), opts);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', `synthetic ${n}`);
  return dir;
}

function node(file, args, env = process.env) {
  const r = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', env });
  return { code: r.status, stdout: r.stdout, out: r.stdout + r.stderr };
}

const run = (script, ...args) => node(path.join(scripts, script), args);

const check = (root, ...args) => run('check-pack.mjs', '--root', root, ...args);

test('a whole pack written by the sync passes', () => {
  const r = check(repo());
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /pack ok: stamp [0-9a-f]{12}, 83 files/);
});

const mutants = {
  'a golden whose bytes differ from the stamp': [(root) => write(path.join(root, 'goldens/blocks/b3.golden.json'), '{}\n'), /goldens\/blocks\/b3.golden.json: sha256 differs from the stamp/],
  'a golden listed in the stamp but gone': [(root) => fs.rmSync(path.join(root, 'goldens/locales/nb.golden.json')), /goldens\/locales\/nb.golden.json: in the stamp, missing on disk/],
  'a golden the stamp does not list': [(root) => write(path.join(root, 'goldens/blocks/extra.golden.json'), '{}\n'), /goldens\/blocks\/extra.golden.json: not in the stamp/],
  'no stamp': [(root) => fs.rmSync(path.join(root, 'goldens/stamp.json')), /goldens\/stamp.json: missing/],
  'no schema': [(root) => fs.rmSync(path.join(root, 'spec/blocks.schema.json')), /spec\/blocks.schema.json: missing/],
  'an empty pack': [(root) => fs.rmSync(path.join(root, 'goldens'), { recursive: true }), /goldens\/blocks: 0 block goldens, need at least 80/],
  'a spec edited by hand': [(root) => write(path.join(root, 'spec/blocks.schema.json'), '{}\n'), /spec\/blocks.schema.json: edited by hand/],
  'no SOURCE.json': [(root) => fs.rmSync(path.join(root, 'SOURCE.json')), /SOURCE.json: missing/],
  'a null stamp that SOURCE.json agrees with': [(root) => { write(path.join(root, 'goldens/stamp.json'), 'null\n'); source(root); }, /goldens\/stamp.json: not an object with a files object/],
  'a stamp whose files is not an object': [(root) => { write(path.join(root, 'goldens/stamp.json'), '{"files":[]}\n'); source(root); }, /goldens\/stamp.json: not an object with a files object/],
  'a null SOURCE.json': [(root) => write(path.join(root, 'SOURCE.json'), 'null\n'), /SOURCE.json: not an object with a files object/],
  'a SOURCE.json whose files is not an object': [(root) => editSource(root, (s) => { s.files = 'all'; }), /SOURCE.json: not an object with a files object/],
  'a SOURCE.json with no repo': [(root) => editSource(root, (s) => { delete s.repo; }), /SOURCE.json: repo is undefined, not "FRIKKern\/barkpark"/],
  'a SOURCE.json naming another path': [(root) => editSource(root, (s) => { s.path = 'elsewhere'; }), /SOURCE.json: path is "elsewhere", not "api\/priv\/portable_doc"/],
  'a SOURCE.json commit that is not a full sha': [(root) => editSource(root, (s) => { s.commit = 'a'.repeat(12); }), /SOURCE.json: commit "aaaaaaaaaaaa" is not a full sha/],
};

for (const [name, [mutate, message]] of Object.entries(mutants)) {
  test(`check fails on ${name}`, () => {
    const root = repo();
    mutate(root);
    const r = check(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, message);
  });
}

test('check fails on fewer than 80 block goldens, even when the stamp agrees', () => {
  const r = check(repo({ blocks: 79 }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /goldens\/blocks: 79 block goldens, need at least 80/);
});

test('--against passes when the pack matches Barkpark and fails when Barkpark moved', () => {
  const root = repo();
  assert.equal(check(root, '--against', barkpark()).code, 0);
  const r = check(root, '--against', barkpark({ tag: 'b', blocks: 81 }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /goldens\/blocks\/b3.golden.json: stale, changed in Barkpark/);
  assert.match(r.out, /goldens\/blocks\/b80.golden.json: stale, added in Barkpark/);
});

test('--against fails when the Barkpark path holds no pack', () => {
  const r = check(repo(), '--against', path.join(tmp, 'nowhere'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /stale, removed in Barkpark/);
});

test('sync copies Barkpark, records the commit, and names old and new stamp', () => {
  const root = repo();
  const bp = barkpark({ tag: 'b', blocks: 81, locale: false });
  const commit = execFileSync('git', ['-C', bp, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const oldStamp = sha256(path.join(root, 'goldens/stamp.json')).slice(0, 12);
  const body = path.join(tmp, `body-${n++}.md`);
  const r = run('sync-from-barkpark.mjs', bp, '--root', root, '--pr-body', body);
  assert.equal(r.code, 0, r.out);
  const newStamp = sha256(path.join(root, 'goldens/stamp.json')).slice(0, 12);
  assert.notEqual(newStamp, oldStamp);
  assert.equal(r.out.trim(), `Sync from Barkpark ${commit.slice(0, 12)}: stamp ${oldStamp} → ${newStamp}`);
  assert.deepEqual(hashes(root), hashes(path.join(bp, BARKPARK_PACK)));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'SOURCE.json'), 'utf8')).commit, commit);
  const text = fs.readFileSync(body, 'utf8');
  assert.match(text, new RegExp(`Old stamp \\| \`${oldStamp}\``));
  assert.match(text, new RegExp(`New stamp \\| \`${newStamp}\``));
  assert.match(text, /### Added\n- `goldens\/blocks\/b80.golden.json`\n\n### Changed/);
  assert.match(text, /### Changed\n(- .*\n)*- `spec\/blocks.schema.json`/);
  assert.match(text, /### Removed\n- `goldens\/locales\/nb.golden.json`\n/);
  assert.equal(fs.existsSync(path.join(root, 'goldens/locales/nb.golden.json')), false);
  assert.equal(check(root, '--against', bp).code, 0);
});

test('sync refuses a broken Barkpark pack and leaves the repo as it was', () => {
  const root = repo();
  const bp = barkpark({ tag: 'b' });
  fs.rmSync(path.join(bp, BARKPARK_PACK, 'spec/blocks.schema.json'));
  const before = hashes(root);
  const r = run('sync-from-barkpark.mjs', bp, '--root', root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /nothing copied/);
  assert.deepEqual(hashes(root), before);
});

test('a first sync into an empty repo says none for what did not change', () => {
  const root = path.join(tmp, `empty-${n++}`);
  fs.mkdirSync(root);
  const body = path.join(tmp, `body-${n++}.md`);
  const r = run('sync-from-barkpark.mjs', barkpark(), '--root', root, '--pr-body', body);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /: stamp none → [0-9a-f]{12}\n$/);
  assert.match(fs.readFileSync(body, 'utf8'), /### Added\n(- `.+`\n){83}\n### Changed\n- none\n\n### Removed\n- none\n$/);
  assert.equal(check(root).code, 0);
});

test('the scripts find the repo root in a path with a space', () => {
  const root = path.join(tmp, 'sp ace', `repo-${n++}`);
  fs.cpSync(scripts, path.join(root, 'scripts'), { recursive: true });
  write(path.join(root, 'README.md'), '# synthetic\n');
  execFileSync('git', ['init', '-q', root]);
  assert.equal(node(path.join(root, 'scripts/sync-from-barkpark.mjs'), [barkpark()]).code, 0);
  assert.equal(fs.existsSync(path.join(root, 'goldens/stamp.json')), true);
  const r = node(path.join(root, 'scripts/check-pack.mjs'), []);
  assert.equal(r.code, 0, r.out);
  const docs = node(path.join(root, 'scripts/check-docs.mjs'), []);
  assert.equal(docs.code, 0, docs.out);
});

function ghStub() {
  const dir = path.join(tmp, `gh-${n++}`);
  const gh = path.join(dir, 'bin', 'gh');
  write(gh, `#!/bin/sh
echo "$*" >> "${dir}/log"
case "$1 $2" in
  "pr list") cat "${dir}/open" 2>/dev/null || true ;;
  "pr create") echo 7 > "${dir}/open"; echo https://example.test/pull/7 ;;
  "pr edit") echo "https://example.test/pull/$3" ;;
esac
`);
  fs.chmodSync(gh, 0o755);
  return {
    env: { ...process.env, PATH: `${path.dirname(gh)}${path.delimiter}${process.env.PATH}` },
    log: () => (fs.existsSync(`${dir}/log`) ? fs.readFileSync(`${dir}/log`, 'utf8') : ''),
  };
}

function clone() {
  const remote = path.join(tmp, `remote-${n++}.git`);
  execFileSync('git', ['init', '-q', '--bare', remote]);
  const work = repo();
  const git = (...args) => execFileSync('git', ['-C', work, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@example.com');
  git('add', '.');
  git('commit', '-qm', 'main');
  git('remote', 'add', 'origin', remote);
  git('push', '-q', 'origin', 'main');
  const head = () => execFileSync('git', ['-C', remote, 'rev-parse', 'refs/heads/sync/barkpark'], { encoding: 'utf8' }).trim();
  return { work, git, head };
}

function workflowRun(c, bp, gh) {
  c.git('switch', '-q', '-f', 'main');
  c.git('clean', '-fdq');
  const title = path.join(tmp, `title-${n++}`);
  const body = path.join(tmp, `body-${n++}.md`);
  const sync = run('sync-from-barkpark.mjs', bp, '--root', c.work, '--pr-body', body);
  assert.equal(sync.code, 0, sync.out);
  fs.writeFileSync(title, sync.stdout);
  return { title: sync.stdout.trim(), ...node(path.join(scripts, 'sync-pr.mjs'), [title, body, '--root', c.work], gh.env) };
}

test('sync-pr opens one PR on main, pushes nothing while that PR already carries the pack, and updates it when the pack changes', () => {
  const c = clone();
  const gh = ghStub();
  const first = workflowRun(c, barkpark({ tag: 'b' }), gh);
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /opened https:\/\/example.test\/pull\/7: Sync from Barkpark/);
  assert.match(gh.log(), /^pr create --head sync\/barkpark --base main --title Sync from Barkpark /m);
  const pushed = c.head();

  const same = workflowRun(c, barkpark({ tag: 'b' }), gh);
  assert.equal(same.code, 0, same.out);
  assert.notEqual(same.title, first.title);
  assert.match(same.out, /sync PR #7 already carries this pack: nothing pushed/);
  assert.equal(c.head(), pushed);
  assert.doesNotMatch(gh.log(), /^pr edit/m);

  const moved = workflowRun(c, barkpark({ tag: 'c' }), gh);
  assert.equal(moved.code, 0, moved.out);
  assert.match(moved.out, /updated https:\/\/example.test\/pull\/7: Sync from Barkpark/);
  assert.notEqual(c.head(), pushed);
  assert.match(gh.log(), /^pr edit 7 --title Sync from Barkpark /m);
  assert.equal(gh.log().match(/^pr create/gm).length, 1);
});
