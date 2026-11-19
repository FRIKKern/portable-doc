import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertDist, assertPack } from './lib/npm-pack.mjs';

const packages = fileURLToPath(new URL('../packages/', import.meta.url));

// What each package that can be published packs: its runtime code, its types, its notices and
// its README, never a test or a script. A folder ending in `/` is the build's output.
const PACKS = {
  code: ['LICENSE', 'README.md', 'SOURCE.json', 'dist/', 'package.json', 'src/code-highlight.js', 'src/reader-code.js', 'src/reader-tabs.js'],
  editor: [
    'EMBED-CONTRACT.md', 'LICENSE', 'README.md', 'THIRD-PARTY-NOTICES.txt', 'contract.d.ts', 'dist/', 'host-profile/surface.json',
    'index.d.ts', 'package.json', 'third-party-notices.json',
  ],
  react: ['LICENSE', 'README.md', 'SOURCE.json', 'dist/', 'package.json'],
};

for (const [name, list] of Object.entries(PACKS)) {
  test(`packages/${name} packs exactly its own list`, () => assertPack(path.join(packages, name), list));
}

// `dist/` above packs whatever the build left, so each built dist is checked against its kinds:
// the files package.json exports, their type files and maps. Run `npm run build` in a package
// first to check its dist; with no dist, the test says it checked nothing. The editor's dist is
// not built in this repo (it comes from the editor's own source), so it is checked only where one
// is present.
for (const name of Object.keys(PACKS)) {
  test(`packages/${name} dist, when built, holds only its export entries, their type files and their maps`, (t) => {
    if (!assertDist(path.join(packages, name))) {
      t.diagnostic(`packages/${name}/dist is not built, so it was not checked${name === 'editor' ? ': the editor\'s dist is not built in this repo' : ''}`);
    }
  });
}

test('every package that is not private has a files list and its list here; every list here is such a package', () => {
  const manifest = (name) => JSON.parse(fs.readFileSync(path.join(packages, name, 'package.json'), 'utf8'));
  const publishable = fs
    .readdirSync(packages, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(packages, e.name, 'package.json')))
    .map((e) => e.name)
    .filter((name) => manifest(name).private !== true)
    .sort();
  for (const name of publishable) {
    const { files } = manifest(name);
    assert.ok(Array.isArray(files) && files.length > 0, `packages/${name} can be published and has no files list`);
  }
  assert.deepEqual(Object.keys(PACKS).sort(), publishable, 'a package that can be published needs its list in PACKS, and only those');
});
