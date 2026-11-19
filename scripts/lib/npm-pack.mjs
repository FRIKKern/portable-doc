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
