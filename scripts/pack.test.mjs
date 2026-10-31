import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { BARKPARK_PACK, hashes, sha256 } from './lib/pack.mjs';

const scripts = path.dirname(new URL(import.meta.url).pathname);
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
  write(path.join(root, 'SOURCE.json'), JSON.stringify({ files: hashes(root) }));
  return root;
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
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'synthetic');
  return dir;
}

function run(script, ...args) {
  const r = spawnSync(process.execPath, [path.join(scripts, script), ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

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
