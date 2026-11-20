import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BARKPARK_EDITOR, EDITOR_DIR, editorHashes } from './lib/editor.mjs';
import { BARKPARK_PACK, BARKPARK_REPO, hashes } from './lib/pack.mjs';
import { editor, pack, write } from './lib/synthetic.mjs';
import { TREE_CHECK_LIMITS } from './test-files.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(scripts);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'editor sync test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;

function node(file, args, env = process.env) {
  assert.ok(file.startsWith(tmp + path.sep), `refusing to run ${file}: outside the test dir`);
  const r = spawnSync(process.execPath, [file, ...args], { cwd: tmp, encoding: 'utf8', env });
  return { code: r.status, out: r.stdout + r.stderr };
}

const check = (root, ...args) => node(path.join(root, 'scripts', 'check-pack.mjs'), args);

// This repo's own pack, editor copy and SOURCE.json, in a temp dir; with { git }, a git work tree with the root .gitignore.
function realCopy({ git = false } = {}) {
  const root = path.join(tmp, `real-${n++}`);
  fs.cpSync(scripts, path.join(root, 'scripts'), { recursive: true, filter: (f) => !f.endsWith('.test.mjs') });
  for (const p of ['spec', 'goldens', 'conformance', 'packages/editor', 'SOURCE.json', ...(git ? ['.gitignore'] : [])]) fs.cpSync(path.join(repoRoot, p), path.join(root, p), { recursive: true });
  if (git) execFileSync('git', ['init', '-q', root]);
  return root;
}

test('a one-byte hand edit to packages/editor fails the check, naming the file', () => {
  const root = realCopy();
  const clean = check(root);
  assert.equal(clean.code, 0, clean.out);
  const file = path.join(root, 'packages/editor/src/index.js');
  const bytes = fs.readFileSync(file);
  bytes[0] ^= 1;
  fs.writeFileSync(file, bytes);
  const r = check(root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^packages\/editor\/src\/index.js: edited by hand \(sha256 differs from SOURCE.json\)$/m);
});

// Synthetic repos: the pack and editor stand-ins from lib/synthetic.mjs, git kept to the test dir.
fs.writeFileSync(path.join(tmp, 'gitconfig'), '');
Object.assign(process.env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(tmp, 'gitconfig'), GIT_CEILING_DIRECTORIES: path.dirname(tmp), GIT_TERMINAL_PROMPT: '0' });

function repo() {
  const root = pack(path.join(tmp, `repo-${n++}`));
  fs.cpSync(scripts, path.join(root, 'scripts'), { recursive: true, filter: (f) => !f.endsWith('.test.mjs') });
  editor(path.join(root, EDITOR_DIR));
  write(path.join(root, 'SOURCE.json'), JSON.stringify({ repo: BARKPARK_REPO, commit: 'a'.repeat(40), path: BARKPARK_PACK, files: hashes(root), editor: { path: BARKPARK_EDITOR, files: editorHashes(root) } }));
  return root;
}

function barkpark({ editorTag = 'a', withEditor = true, extra = () => {} } = {}) {
  const dir = path.join(tmp, `barkpark-${n++}`);
  pack(path.join(dir, BARKPARK_PACK));
  if (withEditor) editor(path.join(dir, BARKPARK_EDITOR), { tag: editorTag });
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git('init', '-q');
  git('add', '.');
  extra(dir, git);
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'synthetic');
  return dir;
}

const sync = (root, bp) => node(path.join(root, 'scripts', 'sync-from-barkpark.mjs'), [bp]);
const recorded = (root) => JSON.parse(fs.readFileSync(path.join(root, 'SOURCE.json'), 'utf8')).editor;

const editSource = (edit) => (root) => {
  const file = path.join(root, 'SOURCE.json');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(value);
  write(file, JSON.stringify(value));
};

const mutants = {
  'a file the sync did not write': [(root) => write(path.join(root, EDITOR_DIR, 'src/extra.js'), '\n'), /^packages\/editor\/src\/extra.js: not written by the sync \(absent from SOURCE.json\)$/m],
  'a recorded file gone from disk': [(root) => fs.rmSync(path.join(root, EDITOR_DIR, 'package.json')), /^packages\/editor\/package.json: in SOURCE.json, missing on disk$/m],
  'a SOURCE.json with no editor section': [editSource((s) => { delete s.editor; }), /^SOURCE.json: no editor section with a files object$/m],
  'an editor section naming another path': [editSource((s) => { s.editor.path = 'elsewhere'; }), /^SOURCE.json: editor.path is "elsewhere", not "api\/assets\/paper-editor"$/m],
  'an empty editor, recorded as empty': [(root) => { fs.rmSync(path.join(root, EDITOR_DIR), { recursive: true }); editSource((s) => { s.editor.files = {}; })(root); }, /^SOURCE.json: editor.files is empty; the sync copies packages\/editor from Barkpark$/m],
};

for (const [name, [mutate, message]] of Object.entries(mutants)) {
  test(`check fails on ${name}`, () => {
    const root = repo();
    const clean = check(root);
    assert.equal(clean.code, 0, clean.out);
    mutate(root);
    const r = check(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, message);
  });
}

test('sync copies only the files Barkpark tracks and does not ignore, and drops ones it no longer has', () => {
  const root = repo();
  write(path.join(root, EDITOR_DIR, 'src/old.js'), 'gone in Barkpark\n');
  const bp = barkpark({
    editorTag: 'b',
    extra: (dir, git) => {
      const at = (f) => path.join(dir, BARKPARK_EDITOR, f);
      write(at('dist/forced.js'), 'built\n');
      git('add', '-f', at('dist/forced.js'));
      write(at('node_modules/dep/index.js'), 'dep\n');
      write(at('scratch.txt'), 'untracked\n');
    },
  });
  const r = sync(root, bp);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(Object.keys(editorHashes(root)), ['.gitignore', 'package.json', 'src/index.js']);
  assert.deepEqual(recorded(root), { path: BARKPARK_EDITOR, files: editorHashes(root) });
  assert.equal(fs.readFileSync(path.join(root, EDITOR_DIR, 'src/index.js'), 'utf8'), "export const tag = 'b';\n");
  assert.match(check(root, '--against', bp).out, /editor 3 files, same as Barkpark\n$/);
});

test('sync refuses a Barkpark with no editor and leaves the repo as it was', () => {
  const root = repo();
  const before = editorHashes(root);
  const r = sync(root, barkpark({ withEditor: false }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /nothing copied:\napi\/assets\/paper-editor: no tracked files/);
  assert.deepEqual(editorHashes(root), before);
  assert.deepEqual(recorded(root).files, before);
});

test('--against fails, naming the file, when Barkpark changed the editor', () => {
  const r = check(repo(), '--against', barkpark({ editorTag: 'b' }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^packages\/editor\/src\/index.js: stale, changed in Barkpark$/m);
});

test('files git ignores under packages/editor, such as .DS_Store and node_modules, do not fail the check', () => {
  const root = realCopy({ git: true });
  write(path.join(root, EDITOR_DIR, '.DS_Store'), 'finder\n');
  write(path.join(root, EDITOR_DIR, 'src/.DS_Store'), 'finder\n');
  write(path.join(root, EDITOR_DIR, 'node_modules/dep/index.js'), 'dep\n');
  const r = check(root);
  assert.equal(r.code, 0, r.out);
  write(path.join(root, EDITOR_DIR, 'src/extra.js'), 'not ignored\n');
  assert.match(check(root).out, /^packages\/editor\/src\/extra.js: not written by the sync/m);
});

test('a symlink under packages/editor fails the check, naming it, in a git work tree or not', () => {
  for (const root of [realCopy({ git: true }), realCopy()]) {
    fs.symlinkSync('index.js', path.join(root, EDITOR_DIR, 'src/link.js'));
    const r = check(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^packages\/editor\/src\/link.js: a symlink; the sync writes regular files only$/m);
  }
});

test('a symlinked directory under packages/editor is named once, and its contents are not listed', () => {
  const root = realCopy();
  fs.symlinkSync('src', path.join(root, EDITOR_DIR, 'linked-src'));
  const r = check(root);
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(r.out.trim().split('\n').filter((l) => l.includes('linked-src')), ['packages/editor/linked-src: a symlink; the sync writes regular files only']);
});

test('a committed file under packages/editor that a .gitignore matches still fails the check, naming it', () => {
  const root = realCopy({ git: true });
  write(path.join(root, EDITOR_DIR, 'dist/bp-paper-editor.bundle.js'), 'built\n');
  assert.equal(check(root).code, 0, 'untracked build output is a local leftover');
  execFileSync('git', ['-C', root, 'add', '-f', `${EDITOR_DIR}/dist/bp-paper-editor.bundle.js`]);
  const r = check(root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^packages\/editor\/dist\/bp-paper-editor.bundle.js: not written by the sync \(absent from SOURCE.json\)$/m);
});

test('a global gitignore does not change what the sync copies: only the repo\'s own .gitignore files count', () => {
  const excludes = path.join(tmp, `global-ignore-${n++}`);
  const config = path.join(tmp, `global-config-${n++}`);
  write(excludes, '*.js\npackage.json\n');
  write(config, `[core]\n\texcludesFile = ${excludes}\n`);
  const root = repo();
  const r = node(path.join(root, 'scripts', 'sync-from-barkpark.mjs'), [barkpark({ editorTag: 'b' })], { ...process.env, GIT_CONFIG_GLOBAL: config });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(Object.keys(recorded(root).files), ['.gitignore', 'package.json', 'src/index.js']);
});

test('the root test run collects no test file from packages/editor', () => {
  const root = path.join(tmp, `tests-${n++}`);
  fs.cpSync(scripts, path.join(root, 'scripts'), { recursive: true });
  for (const f of ['packages/text/a.test.mjs', 'packages/editor/b.test.mjs', 'packages/editor/src/c.test.mjs']) write(path.join(root, f), '\n');
  const r = node(path.join(root, 'scripts', 'test-files.mjs'), []);
  assert.equal(r.code, 0, r.out);
  const files = r.out.trim().split('\n');
  assert.ok(files.includes('packages/text/a.test.mjs') && files.includes('scripts/editor-sync.test.mjs'), r.out);
  assert.deepEqual(files.filter((f) => f.startsWith('packages/editor/')), []);
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  for (const s of ['test', 'check']) assert.match(pkg.scripts[s], /node scripts\/test-files.mjs --run/, s);
});

test('the root test run fails when it finds no test file, in list mode and with --run, so node --test never discovers everything', () => {
  const root = path.join(tmp, `no-tests-${n++}`);
  write(path.join(root, 'scripts', 'test-files.mjs'), fs.readFileSync(path.join(scripts, 'test-files.mjs'), 'utf8'));
  write(path.join(root, EDITOR_DIR, 'only.test.mjs'), "throw new Error('an editor test ran');\n");
  for (const args of [[], ['--run']]) {
    const r = node(path.join(root, 'scripts', 'test-files.mjs'), args);
    assert.equal(r.code, 1, args.join(' ') || 'list');
    assert.equal(r.out, 'test-files: no test files found under scripts/ or packages/\n');
  }
});

test('a test run that leaves a file in the tree, or changes one, fails naming it; edits made before the run do not count', () => {
  const root = path.join(tmp, `left-${n++}`);
  write(path.join(root, 'scripts', 'test-files.mjs'), fs.readFileSync(path.join(scripts, 'test-files.mjs'), 'utf8'));
  write(path.join(root, 'scripts', 'clean.test.mjs'), "import { test } from 'node:test';\ntest('clean', () => {});\n");
  execFileSync('git', ['init', '-q', root]);
  write(path.join(root, 'mine.txt'), 'an edit of my own\n');
  write(path.join(root, 'touched.txt'), 'before\n');
  // The inner `node --test` must not see this run's own test context, or it skips its files.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const clean = node(path.join(root, 'scripts', 'test-files.mjs'), ['--run'], env);
  assert.equal(clean.code, 0, clean.out);
  write(
    path.join(root, 'scripts', 'leaves.test.mjs'),
    "import fs from 'node:fs';\nimport { test } from 'node:test';\ntest('leaves', () => { fs.writeFileSync(new URL('../src/left.ts', import.meta.url), ''); fs.writeFileSync(new URL('../touched.txt', import.meta.url), 'after\\n'); });\n",
  );
  fs.mkdirSync(path.join(root, 'src'));
  const r = node(path.join(root, 'scripts', 'test-files.mjs'), ['--run'], env);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /test-files: the run left the tree changed:\n {2}src\/left\.ts\n {2}touched\.txt\n/);
  assert.doesNotMatch(r.out, /mine\.txt/);
});

test('each listed limit of the tree check is real: its plant runs and the run still passes', () => {
  assert.deepEqual(TREE_CHECK_LIMITS.map((l) => l.limit), ['a file made and removed inside the run', 'a path git ignores outside a walked source root', 'an empty new folder']);
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  for (const { limit, plant, stays } of TREE_CHECK_LIMITS) {
    const root = path.join(tmp, `limit-${n++}`);
    write(path.join(root, 'scripts', 'test-files.mjs'), fs.readFileSync(path.join(scripts, 'test-files.mjs'), 'utf8'));
    write(path.join(root, '.gitignore'), fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8'));
    write(path.join(root, 'scripts', 'plant.test.mjs'), `import fs from 'node:fs';\nimport { test } from 'node:test';\ntest('plant', () => { ${plant} });\n`);
    execFileSync('git', ['init', '-q', root]);
    const r = node(path.join(root, 'scripts', 'test-files.mjs'), ['--run'], env);
    assert.equal(r.code, 0, `${limit}: the check saw it, so this row leaves the list\n${r.out}`);
    assert.match(r.out, /^# pass 1$/m, `${limit}: the plant did not run\n${r.out}`);
    for (const p of stays) assert.ok(fs.existsSync(path.join(root, p)), `${limit}: the plant left no ${p}`);
  }
});

// check-docs compares the README timeline with origin/main's, so its repo needs a commit and that ref.
function asMain(root) {
  for (const args of [['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'docs'], ['update-ref', 'refs/remotes/origin/main', 'HEAD']]) execFileSync('git', ['-C', root, ...args]);
}

test('an editor Markdown file whose link leaves the folder does not fail check-docs: it is Barkpark\'s text', () => {
  const root = path.join(tmp, `docs-${n++}`);
  write(path.join(root, 'scripts/check-docs.mjs'), fs.readFileSync(path.join(scripts, 'check-docs.mjs'), 'utf8'));
  write(path.join(root, 'README.md'), '# synthetic\n<!-- timeline:start -->\n<!-- timeline:end -->\n');
  write(path.join(root, EDITOR_DIR, 'README.md'), 'See [the app](../../../api/app.md).\n');
  execFileSync('git', ['init', '-q', root]);
  asMain(root);
  const r = node(path.join(root, 'scripts', 'check-docs.mjs'), []);
  assert.equal(r.code, 0, r.out);
  write(path.join(root, 'docs/x.md'), 'See [gone](gone.md).\n');
  assert.match(node(path.join(root, 'scripts', 'check-docs.mjs'), []).out, /docs\/x.md: broken link gone.md/);
});
