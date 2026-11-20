// The test files the root test run collects: scripts/*.test.mjs and packages/<name>/*.test.mjs,
// except packages/editor. That folder is Barkpark's editor, copied by the sync (decision 0012),
// and its tests need its own install; Barkpark runs them.
// Prints the list, or with --run runs them with `node --test` and exits with its code. A run must
// leave the tree as it found it: each path git reports (changed or untracked) is read before and
// after, and a path the run added, changed or removed fails it by name. A tree with edits of its own
// (a sync, a branch at work) can still run; only what the tests did counts. What the check cannot
// see is listed below as TREE_CHECK_LIMITS.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What the tree check does not see, each with a plant: the body of a test that does exactly that,
 * run from scripts/ in a git repository holding this repository's .gitignore. editor-sync.test.mjs
 * runs each plant and shows the run passing on it, and that each path in `stays` is there after the
 * run. When the check learns to see a case, its plant turns red and its row leaves this list.
 */
export const TREE_CHECK_LIMITS = Object.freeze([
  {
    limit: 'a file made and removed inside the run',
    plant: "const f = new URL('../made.txt', import.meta.url); fs.writeFileSync(f, 'x'); fs.rmSync(f);",
    stays: [],
  },
  {
    limit: 'a path git ignores outside a walked source root',
    plant: "fs.mkdirSync(new URL('../dist/', import.meta.url)); fs.writeFileSync(new URL('../dist/x.js', import.meta.url), 'x');",
    stays: ['dist/x.js'],
  },
  {
    limit: 'an empty new folder',
    plant: "fs.mkdirSync(new URL('../empty/', import.meta.url));",
    stays: ['empty'],
  },
]);

const root = fileURLToPath(new URL('..', import.meta.url));
const tests = (dir) => (fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `${dir}/${f}`) : []);
const packages = fs.existsSync(path.join(root, 'packages'))
  ? fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'editor').map((e) => e.name).sort()
  : [];
const files = [...tests('scripts'), ...packages.flatMap((p) => tests(`packages/${p}`))];

/** Each path git reports as changed or untracked, with a hash of its bytes ('gone' when deleted). */
function treeState() {
  const r = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`test-files: git status failed, so the run cannot check it leaves the tree as it found it\n${r.stderr}`);
    process.exit(1);
  }
  const state = new Map();
  const entries = r.stdout.split('\0').filter(Boolean);
  for (let i = 0; i < entries.length; i++) {
    const p = entries[i].slice(3);
    if (/^[RC]/.test(entries[i])) i++; // a rename's second entry is its old path
    const f = path.join(root, p);
    state.set(p, fs.existsSync(f) && fs.statSync(f).isFile() ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : 'gone');
  }
  return state;
}

// Run as a script, not when a test imports TREE_CHECK_LIMITS.
const asScript = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
// An empty list would let `node --test` discover every test file, packages/editor included.
if (asScript && !files.length) {
  console.error('test-files: no test files found under scripts/ or packages/');
  process.exit(1);
}
if (!asScript) {
  // Imported for its data: nothing runs.
} else if (process.argv.includes('--run')) {
  const before = treeState();
  process.exitCode = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' }).status ?? 1;
  const after = treeState();
  const left = [...new Set([...before.keys(), ...after.keys()])].filter((p) => before.get(p) !== after.get(p)).sort();
  if (left.length) {
    console.error(`test-files: the run left the tree changed:\n${left.map((p) => `  ${p}`).join('\n')}`);
    process.exitCode = 1;
  }
} else console.log(files.join('\n'));
