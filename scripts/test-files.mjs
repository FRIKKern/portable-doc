// The test files the root test run collects: scripts/*.test.mjs and packages/<name>/*.test.mjs,
// except packages/editor. That folder is Barkpark's editor, copied by the sync (decision 0012),
// and its tests need its own install; Barkpark runs them.
// Prints the list, or with --run runs them with `node --test` and exits with its code.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tests = (dir) => (fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `${dir}/${f}`) : []);
const packages = fs.existsSync(path.join(root, 'packages'))
  ? fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'editor').map((e) => e.name).sort()
  : [];
const files = [...tests('scripts'), ...packages.flatMap((p) => tests(`packages/${p}`))];

if (process.argv.includes('--run')) {
  process.exitCode = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' }).status ?? 1;
} else console.log(files.join('\n'));
