import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BARKPARK_PACK, BARKPARK_REPO, hashes, sha256 } from './lib/pack.mjs';
import { pack, write } from './lib/synthetic.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;

const blocked = path.join(tmp, 'blocked');
const gitConfig = [
  ['protocol.allow', 'never'],
  ['protocol.file.allow', 'always'],
  ...['http', 'https', 'ssh', 'git'].map((p) => [`protocol.${p}.allow`, 'never']),
  [`url.${blocked}/.pushInsteadOf`, 'https://github.com/'],
  [`url.${blocked}/.pushInsteadOf`, 'git@github.com:'],
];
gitConfig.forEach(([key, value], i) => {
  process.env[`GIT_CONFIG_KEY_${i}`] = key;
  process.env[`GIT_CONFIG_VALUE_${i}`] = value;
});
fs.writeFileSync(path.join(tmp, 'gitconfig'), '');
Object.assign(process.env, {
  GIT_CONFIG_COUNT: String(gitConfig.length),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: path.join(tmp, 'gitconfig'),
  GIT_CEILING_DIRECTORIES: path.dirname(tmp),
  GIT_TERMINAL_PROMPT: '0',
  GH_CONFIG_DIR: path.join(tmp, 'gh'),
});
for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete process.env[key];
process.chdir(tmp);

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

function editReport(root, renderer, edit) {
  const file = path.join(root, 'conformance', `${renderer}.json`);
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(value);
  write(file, `${JSON.stringify(value, null, 2)}\n`);
}

const resynced = (edit) => (root) => { edit(root); source(root); };

function scripted(dir) {
  fs.cpSync(scripts, path.join(dir, 'scripts'), { recursive: true, filter: (f) => !f.endsWith('.test.mjs') });
  return dir;
}

function repo(opts) {
  return source(pack(scripted(path.join(tmp, `repo-${n++}`)), opts));
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
  assert.ok(file.startsWith(tmp + path.sep), `refusing to run ${file}: outside the test dir`);
  const r = spawnSync(process.execPath, [file, ...args], { cwd: tmp, encoding: 'utf8', env });
  return { code: r.status, stdout: r.stdout, out: r.stdout + r.stderr };
}

const run = (root, script, ...args) => node(path.join(root, 'scripts', script), args);

const check = (root, ...args) => run(root, 'check-pack.mjs', ...args);

test('a whole pack written by the sync passes', () => {
  const r = check(repo());
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /pack ok: stamp [0-9a-f]{12}, 85 files, 2 conformance reports/);
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
  'a stamp that is not JSON': [(root) => { write(path.join(root, 'goldens/stamp.json'), '{'); source(root); }, /goldens\/stamp.json: unreadable \(/],
  'a null SOURCE.json': [(root) => write(path.join(root, 'SOURCE.json'), 'null\n'), /SOURCE.json: not an object with a files object/],
  'a SOURCE.json whose files is not an object': [(root) => editSource(root, (s) => { s.files = 'all'; }), /SOURCE.json: not an object with a files object/],
  'a SOURCE.json with no repo': [(root) => editSource(root, (s) => { delete s.repo; }), /SOURCE.json: repo is undefined, not "FRIKKern\/barkpark"/],
  'a SOURCE.json naming another path': [(root) => editSource(root, (s) => { s.path = 'elsewhere'; }), /SOURCE.json: path is "elsewhere", not "api\/priv\/portable_doc"/],
  'a SOURCE.json commit that is not a full sha': [(root) => editSource(root, (s) => { s.commit = 'a'.repeat(12); }), /SOURCE.json: commit "aaaaaaaaaaaa" is not a full sha/],
  'a SOURCE.json commit with text before the sha': [(root) => editSource(root, (s) => { s.commit = `v${'a'.repeat(40)}`; }), /SOURCE.json: commit "va{40}" is not a full sha/],
  'a report whose pack_stamp is not the pack\'s, even when SOURCE.json agrees': [resynced((root) => editReport(root, 'text-b', (r) => { r.pack_stamp = 'c'.repeat(64); })), /conformance\/text-b.json: pack_stamp c{64} is not the sha256 of goldens\/stamp.json, [0-9a-f]{64}/],
  'a report whose pack_stamp shares only the first 12 characters with the pack\'s': [resynced((root) => editReport(root, 'text-b', (r) => { r.pack_stamp = r.pack_stamp.slice(0, 12) + (r.pack_stamp[12] === '0' ? '1' : '0') + r.pack_stamp.slice(13); })), /conformance\/text-b.json: pack_stamp [0-9a-f]{64} is not the sha256/],
  'a report whose compare is neither dom nor text': [resynced((root) => editReport(root, 'ref', (r) => { r.compare = 'pixels'; })), /conformance\/ref.json: compare is "pixels", not dom or text/],
  'a report with no row for a pack type, even when SOURCE.json agrees': [resynced((root) => editReport(root, 'ref', (r) => { r.rows = r.rows.filter((row) => row.type !== 'b7'); })), /conformance\/ref.json: no row for pack type b7/],
  'a report row that is not a pack type': [resynced((root) => editReport(root, 'ref', (r) => { r.rows.push({ type: 'gone', status: 'pass' }); })), /conformance\/ref.json: row "gone" is not a pack type/],
  'a report with two rows for one type': [resynced((root) => editReport(root, 'ref', (r) => { r.rows.push({ type: 'b3', status: 'pass' }); })), /conformance\/ref.json: b3 has more than one row/],
  'a report row with an unknown status': [resynced((root) => editReport(root, 'ref', (r) => { r.rows[4].status = 'green'; })), /conformance\/ref.json: b4 has status "green"/],
  'a report named for another renderer': [resynced((root) => editReport(root, 'text-b', (r) => { r.renderer = 'ref'; })), /conformance\/text-b.json: renderer is "ref", not "text-b"/],
  'a report that is not JSON': [resynced((root) => write(path.join(root, 'conformance/ref.json'), '{')), /conformance\/ref.json: unreadable \(/],
  'a report with no rows array': [resynced((root) => write(path.join(root, 'conformance/ref.json'), '{"rows":{}}\n')), /conformance\/ref.json: not an object with a rows array/],
  'no conformance reports at all, even when SOURCE.json agrees': [resynced((root) => fs.rmSync(path.join(root, 'conformance'), { recursive: true })), /conformance: no reports/],
  'a report edited by hand': [(root) => editReport(root, 'text-b', (r) => { r.rows[2].status = 'fail'; }), /conformance\/text-b.json: edited by hand/],
  'a conformance file the sync did not write': [(root) => write(path.join(root, 'conformance/extra.md'), 'x\n'), /conformance\/extra.md: not written by the sync/],
  'a SOURCE.json commit with text after the sha': [(root) => editSource(root, (s) => { s.commit = `${'a'.repeat(40)}v`; }), /SOURCE.json: commit "a{40}v" is not a full sha/],
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

test('only goldens/blocks/*.golden.json are pack types, and only conformance/*.json are reports', () => {
  const root = scripted(path.join(tmp, `extras-${n++}`));
  write(path.join(root, 'goldens/blocks/README.txt'), 'not a golden\n');
  write(path.join(root, 'goldens/blocks/b1.golden.json.orig'), '{}\n');
  write(path.join(root, 'conformance/CONFORMANCE.md'), '# notes\n');
  write(path.join(root, 'conformance/fixtures/sample.json'), '{"rows":[]}\n');
  source(pack(root));
  const r = check(root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /, 2 conformance reports\n$/);
});

test('check fails on fewer than 80 block goldens, even when the stamp agrees', () => {
  const r = check(repo({ blocks: 79 }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /goldens\/blocks: 79 block goldens, need at least 80/);
});

test('--against passes when the pack matches Barkpark and fails when Barkpark moved', () => {
  const root = repo();
  assert.match(check(root, '--against', barkpark()).out, /^pack ok: stamp [0-9a-f]{12}, 85 files, 2 conformance reports, same as Barkpark\n$/);
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
  const r = run(root, 'sync-from-barkpark.mjs', bp, '--pr-body', body);
  assert.equal(r.code, 0, r.out);
  const newStamp = sha256(path.join(root, 'goldens/stamp.json')).slice(0, 12);
  assert.notEqual(newStamp, oldStamp);
  assert.equal(r.out.trim(), `Sync from Barkpark ${commit.slice(0, 12)}: stamp ${oldStamp} → ${newStamp}`);
  assert.deepEqual(hashes(root), hashes(path.join(bp, BARKPARK_PACK)));
  assert.ok('conformance/ref.json' in JSON.parse(fs.readFileSync(path.join(root, 'SOURCE.json'), 'utf8')).files);
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
  const r = run(root, 'sync-from-barkpark.mjs', bp);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /nothing copied/);
  assert.deepEqual(hashes(root), before);
});

test('sync refuses a Barkpark pack whose reports are stale or short, and leaves the repo as it was', () => {
  const root = repo();
  const bp = barkpark({ tag: 'b' });
  const packRoot = path.join(bp, BARKPARK_PACK);
  editReport(packRoot, 'text-b', (r) => { r.pack_stamp = 'c'.repeat(64); r.rows.pop(); });
  const before = hashes(root);
  const r = run(root, 'sync-from-barkpark.mjs', bp);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /nothing copied/);
  assert.match(r.out, /conformance\/text-b.json: pack_stamp c{64} is not/);
  assert.match(r.out, /conformance\/text-b.json: no row for pack type b79/);
  assert.deepEqual(hashes(root), before);
});

test('a first sync into an empty repo says none for what did not change', () => {
  const root = scripted(path.join(tmp, `empty-${n++}`));
  const body = path.join(tmp, `body-${n++}.md`);
  const r = run(root, 'sync-from-barkpark.mjs', barkpark(), '--pr-body', body);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /: stamp none → [0-9a-f]{12}\n$/);
  assert.match(fs.readFileSync(body, 'utf8'), /### Added\n(- `.+`\n){85}\n### Changed\n- none\n\n### Removed\n- none\n$/);
  assert.equal(check(root).code, 0);
});

test('every test runs its scripts from a path with a space, and check-docs finds its repo root there too', () => {
  assert.match(tmp, / /);
  const root = repo();
  write(path.join(root, 'README.md'), '# synthetic\n');
  execFileSync('git', ['init', '-q', root]);
  fs.copyFileSync(path.join(scripts, 'check-docs.mjs'), path.join(root, 'scripts/check-docs.mjs'));
  const r = run(root, 'check-docs.mjs');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /docs ok: 1 files, README 1 lines/);
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
    close: () => fs.rmSync(`${dir}/open`),
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
  const sync = run(c.work, 'sync-from-barkpark.mjs', bp, '--pr-body', body);
  assert.equal(sync.code, 0, sync.out);
  fs.writeFileSync(title, sync.stdout);
  return { title: sync.stdout.trim(), ...node(path.join(c.work, 'scripts/sync-pr.mjs'), [title, body], gh.env) };
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

test('the tests run with no credentials, no gh token, git confined to the test dir, and GitHub push URLs sent to a blocked dir', () => {
  assert.equal(process.cwd(), fs.realpathSync(tmp));
  assert.equal(process.env.GH_TOKEN, undefined);
  assert.equal(process.env.GITHUB_TOKEN, undefined);
  const c = clone();
  assert.equal(spawnSync('git', ['-C', c.work, 'config', '--get', 'credential.helper']).status, 1);
  for (const [url, pushUrl] of [['https://github.com/FRIKKern/portable-doc', `${blocked}/FRIKKern/portable-doc`], ['git@github.com:FRIKKern/portable-doc.git', `${blocked}/FRIKKern/portable-doc.git`]]) {
    c.git('remote', 'set-url', 'origin', url);
    assert.equal(c.git('remote', 'get-url', '--push', 'origin'), pushUrl);
  }
  const loose = path.join(tmp, `loose-${n++}`);
  fs.mkdirSync(loose);
  assert.notEqual(spawnSync('git', ['-C', loose, 'rev-parse', '--show-toplevel']).status, 0);
});

test('nothing the tests run can push to a network remote: git refuses https and ssh before it connects', () => {
  const c = clone();
  for (const [url, transport] of [['https://example.invalid/portable-doc.git', 'https'], ['git@example.invalid:portable-doc.git', 'ssh']]) {
    c.git('remote', 'set-url', 'origin', url);
    const r = spawnSync('git', ['-C', c.work, 'push', 'origin', 'HEAD:refs/heads/sync/barkpark'], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, new RegExp(`transport '${transport}' not allowed`));
  }
});

test('the test harness refuses to run a script that lives outside the test dir', () => {
  assert.throws(() => node(path.join(scripts, 'check-pack.mjs'), []), /refusing to run .*: outside the test dir/);
});

function prFiles(c) {
  const title = path.join(tmp, `title-${n++}`);
  const body = path.join(tmp, `body-${n++}.md`);
  fs.writeFileSync(title, 'Sync from Barkpark test\n');
  fs.writeFileSync(body, 'body\n');
  return [title, body];
}

test('sync-pr refuses to run, and touches nothing, when its root is not the top of a git repo', () => {
  const c = clone();
  const nested = scripted(path.join(c.work, 'nested'));
  const inside = node(path.join(nested, 'scripts/sync-pr.mjs'), prFiles(c), ghStub().env);
  assert.equal(inside.code, 1, inside.out);
  assert.match(inside.out, /nested\/ is not the top of a git repo \(git says .*repo-\d+\); nothing done/);
  assert.equal(c.git('branch', '--show-current'), 'main');
  assert.equal(c.git('rev-list', '--count', 'HEAD'), '1');
  const loose = node(path.join(repo(), 'scripts/sync-pr.mjs'), prFiles(c), ghStub().env);
  assert.equal(loose.code, 1, loose.out);
  assert.match(loose.out, /is not the top of a git repo \(git says no repo\); nothing done/);
});

for (const [name, opts] of [['a spec-only', { tag: 'b', specTag: 's' }], ['a goldens-only', { tag: 'g', specTag: 'b' }], ['a conformance-only', { tag: 'b', status: (renderer, type) => ({ status: type === 'b5' ? 'fail' : 'pass' }) }]]) {
  test(`sync-pr pushes and edits the open PR on ${name} change`, () => {
    const c = clone();
    const gh = ghStub();
    assert.equal(workflowRun(c, barkpark({ tag: 'b' }), gh).code, 0);
    const pushed = c.head();
    const r = workflowRun(c, barkpark(opts), gh);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /updated https:\/\/example.test\/pull\/7/);
    assert.notEqual(c.head(), pushed);
    assert.match(gh.log(), /^pr edit 7 /m);
  });
}

test('sync-pr opens a new PR when the old one was closed, even if its branch carries the pack', () => {
  const c = clone();
  const gh = ghStub();
  assert.equal(workflowRun(c, barkpark({ tag: 'b' }), gh).code, 0);
  gh.close();
  const r = workflowRun(c, barkpark({ tag: 'b' }), gh);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /opened https:\/\/example.test\/pull\/7/);
  assert.equal(gh.log().match(/^pr create/gm).length, 2);
});
