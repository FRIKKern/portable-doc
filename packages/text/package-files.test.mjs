import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

// npm adds some files whatever `files` says, such as any readme.* at the root, so the test
// reads what npm would pack rather than the list.
test('the package holds its runtime code, its types and its README, and no script', () => {
  const [{ files }] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const runtime = fs.readdirSync(here).filter((f) => f.endsWith('.js'));
  assert.deepEqual(files.map((f) => f.path).sort(), ['README.md', 'index.d.ts', 'package.json', ...runtime].sort());
});
