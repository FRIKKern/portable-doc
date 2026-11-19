import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Timing tests measure CPU time (scripts/lib/cpu-budget.mjs), never the wall clock: the
// gate runs test files side by side, and on a loaded machine wall time measures the queue.
// A test may read the wall clock only to stop a wait that would otherwise hang, and says so
// with a `hang deadline` comment on that line or the line above. packages/editor is a
// synced copy of Barkpark's editor and is checked there.

const root = fileURLToPath(new URL('..', import.meta.url));
const CLOCK = /\b(?:Date\.now|performance\.now|process\.hrtime(?:\.bigint)?)\s*\(|new Date\(\s*\)\s*\.getTime\s*\(/;

/** 1-based numbers of the lines in `source` that read the wall clock without a `hang deadline` mark. */
export function unmarkedClockReads(source) {
  const lines = source.split('\n');
  return lines.flatMap((line, i) => (CLOCK.test(line) && !/hang deadline/.test(line) && !/hang deadline/.test(lines[i - 1] ?? '') ? [i + 1] : []));
}

/** Test files and test helpers outside packages/editor, node_modules and build output. */
function testFiles() {
  const out = [];
  const walk = (dir, inTests) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = path.relative(root, path.join(dir, entry.name));
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', '.git'].includes(entry.name) || rel === path.join('packages', 'editor')) continue;
        walk(path.join(dir, entry.name), inTests || entry.name === 'test' || entry.name === 'tests');
      } else if (/\.(?:mjs|cjs|js|ts|tsx)$/.test(entry.name) && (inTests || /\.test\.[a-z]+$/.test(entry.name))) out.push(rel);
    }
  };
  walk(path.join(root, 'packages'), false);
  walk(path.join(root, 'scripts'), false);
  return out.sort();
}

test('the guard finds a wall-clock read, and lets a marked hang deadline through', () => {
  assert.deepEqual(unmarkedClockReads('const t = performance.now();\nwork();\nassert.ok(performance.now() - t < 500);'), [1, 3]);
  assert.deepEqual(unmarkedClockReads('const started = Date.now();\nassert.ok(Date.now() - started < 5000);'), [1, 2]);
  assert.deepEqual(unmarkedClockReads('const t = process.hrtime.bigint();\nconst u = new Date().getTime();'), [1, 2]);
  assert.deepEqual(unmarkedClockReads('const end = Date.now() + 4000; // hang deadline\n// hang deadline: give up on a wait that never ends\nif (Date.now() > end) throw new Error();'), []);
  assert.deepEqual(unmarkedClockReads('const { user } = process.cpuUsage();\nsetTimeout(done, 50);'), []);
});

test('no test outside packages/editor reads the wall clock, except to stop a wait that would hang', () => {
  // This file's own samples are strings, checked by the test above.
  const files = testFiles().filter((file) => file !== path.join('scripts', 'wall-clock.test.mjs'));
  assert.ok(files.includes(path.join('packages', 'mcp', 'server.test.mjs')) && files.includes(path.join('packages', 'react', 'tests', 'PortableDoc.test.tsx')), 'the walk reaches the test files');
  const found = files.flatMap((file) => unmarkedClockReads(fs.readFileSync(path.join(root, file), 'utf8')).map((line) => `${file}:${line}`));
  assert.deepEqual(found, [], 'time with underBudget from scripts/lib/cpu-budget.mjs; mark a wait that only stops a hang with "hang deadline"');
});
