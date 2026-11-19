// Each place a document's list once reached a spread into a call (see no-spread-into-call.test.mjs)
// writes or renders that list whole. A child on a 100 kB stack overflows on a spread of 20,000
// items, as the default stack does at about 115,000; there the write threw, or came out empty.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CASES } from './lib/huge-inputs.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const ITEMS = 20_000;

test('a small list comes through every case whole, so each mark is the right one', () => {
  for (const [name, run] of Object.entries(CASES)) {
    const [out, mark] = run(3);
    assert.ok(out.includes(mark) && out.includes('the paragraph after'), name);
  }
});

test(`a list of ${ITEMS.toLocaleString('en')} items comes through each place whole on a small stack`, () => {
  const script = `const { CASES, END } = await import('./lib/huge-inputs.mjs');
const seen = {};
for (const [name, run] of Object.entries(CASES)) {
  try {
    const [out, mark] = run(${ITEMS});
    seen[name] = out.includes(mark) && out.includes(END) ? 'whole' : 'cut';
  } catch (e) {
    seen[name] = e.constructor.name;
  }
}
console.log(JSON.stringify(seen));`;
  const run = spawnSync(process.execPath, ['--stack-size=100', '--input-type=module', '-e', script], { cwd: here, encoding: 'utf8' });
  const whole = Object.fromEntries(Object.keys(CASES).map((name) => [name, 'whole']));
  assert.deepEqual(JSON.parse(run.stdout || '{}'), whole, run.stderr);
});
