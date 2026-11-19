// What `npm pack` puts in a package, and the check that it is exactly the package's own list.
// npm adds some files whatever `files` says (any readme.* at the root, package.json), so the
// check reads what npm would pack, never the `files` list alone.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** The paths `npm pack` would put in the package at `dir`, sorted. Packs nothing and runs no script. */
export function packedFiles(dir) {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out)[0].files.map((f) => f.path).sort();
}

// Names npm leaves out of any package.
const NEVER_PACKED = (name) => name === '.DS_Store' || name.startsWith('._') || name === '.git' || name === 'node_modules';

/** Every file under `dir`/`folder`, as package paths; none when the folder is not there. */
function filesUnder(dir, folder) {
  const at = path.join(dir, folder);
  if (!fs.existsSync(at)) return [];
  return fs
    .readdirSync(at, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && !NEVER_PACKED(e.name))
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'));
}

/**
 * Fail unless the package at `dir` packs exactly `expected`. Each entry is a file's path in the
 * package, or a folder ending in `/` that a build writes (`dist/`): every file in it as the
 * build left it, and nothing when it is not built.
 */
export function assertPack(dir, expected) {
  const want = expected.flatMap((p) => (p.endsWith('/') ? filesUnder(dir, p) : [p])).sort();
  assert.deepEqual(packedFiles(dir), want, `${path.basename(dir)}: npm would pack other files than its own list`);
}

// ── what a build may leave in dist ──

// The type file TypeScript reads for a file of this name: `x.js` → `x.d.ts`, `x.mjs` → `x.d.mts`, `x.cjs` → `x.d.cts`.
const typeFile = (file) => file.replace(/\.(m|c)?js$/, (_, m = '') => `.d.${m}ts`);

/** Every path string in package.json's `exports`, `main` and `types`, through any conditions. */
function entryPaths(manifest) {
  const out = [];
  const walk = (v) => (typeof v === 'string' ? out.push(v) : v && typeof v === 'object' && Object.values(v).forEach(walk));
  walk([manifest.exports, manifest.main, manifest.types, manifest.module]);
  return out.map((p) => path.posix.normalize(p));
}

/**
 * The files the build may leave in `folder`: each entry package.json names there, the type file
 * of each such JavaScript entry, the files a type file imports by a relative path (as their
 * type files), and a source map of any of these.
 */
export function distAllowed(dir, folder = 'dist') {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const allowed = new Set();
  const todo = [];
  const add = (file) => {
    if (allowed.has(file)) return;
    allowed.add(file);
    allowed.add(`${file}.map`);
    if (/\.d\.[mc]?ts$/.test(file)) todo.push(file);
    else if (/\.[mc]?js$/.test(file)) add(typeFile(file));
  };
  for (const p of entryPaths(manifest)) if (p.startsWith(`${folder}/`)) add(p);
  while (todo.length) {
    const file = todo.pop();
    if (!fs.existsSync(path.join(dir, file))) continue;
    for (const [, spec] of fs.readFileSync(path.join(dir, file), 'utf8').matchAll(/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      add(typeFile(path.posix.join(path.posix.dirname(file), spec)));
    }
  }
  return allowed;
}

/**
 * Fail on a file in the package's built `folder` that is not an entry, its type file or a map
 * (distAllowed). Returns false, checking nothing, when the folder is not there.
 */
export function assertDist(dir, folder = 'dist') {
  if (!fs.existsSync(path.join(dir, folder))) return false;
  const allowed = distAllowed(dir, folder);
  const stray = filesUnder(dir, `${folder}/`).filter((f) => !allowed.has(f)).sort();
  assert.deepEqual(stray, [], `${path.basename(dir)}: ${folder} holds files that are not an export entry, its type file or its map`);
  return true;
}
