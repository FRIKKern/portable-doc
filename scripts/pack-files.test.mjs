import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertPack } from './lib/npm-pack.mjs';

const packages = fileURLToPath(new URL('../packages/', import.meta.url));

// What each package that can be published packs: its runtime code, its types, its notices and
// its README, never a test or a script. A folder ending in `/` is the build's output.
const PACKS = {
  code: ['LICENSE', 'README.md', 'RELEASING.md', 'SOURCE.json', 'dist/', 'package.json', 'src/code-highlight.js', 'src/reader-code.js', 'src/reader-tabs.js'],
  editor: [
    'EMBED-CONTRACT.md', 'LICENSE', 'README.md', 'THIRD-PARTY-NOTICES.txt', 'contract.d.ts', 'dist/', 'host-profile/surface.json',
    'index.d.ts', 'package.json', 'third-party-notices.json',
  ],
  react: ['LICENSE', 'README.md', 'SOURCE.json', 'dist/', 'package.json'],
};

for (const [name, list] of Object.entries(PACKS)) {
  test(`packages/${name} packs exactly its own list`, () => assertPack(path.join(packages, name), list));
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
