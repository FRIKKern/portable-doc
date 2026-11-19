import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertPack } from '../../scripts/lib/npm-pack.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));

// The package is private, but its pack is checked as the published ones are (scripts/pack-files.test.mjs).
test('the package holds its runtime code, its types and its README, and no script', () => {
  const runtime = fs.readdirSync(here).filter((f) => f.endsWith('.js'));
  assertPack(here, ['README.md', 'index.d.ts', 'package.json', ...runtime]);
});
