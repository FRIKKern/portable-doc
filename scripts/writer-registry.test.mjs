import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BUILT_ELSEWHERE, NOT_A_WRITER, WRITERS } from './lib/writers.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

// The module file a package.json `exports` value names for an import, or null for none.
const moduleOf = (value) => {
  if (typeof value === 'string') return /\.m?js$/.test(value) ? value : null;
  return value && typeof value === 'object' ? (moduleOf(value.import) ?? moduleOf(value.default)) : null;
};

/** Every function each package exports, as `<package> <export>`, and the problems met on the way. */
async function exportedFunctions() {
  const found = new Set();
  const problems = [];
  const elsewhere = new Set();
  for (const dir of fs.readdirSync(path.join(root, 'packages')).sort()) {
    const at = path.join(root, 'packages', dir, 'package.json');
    if (!fs.existsSync(at)) continue;
    const { name, exports = {} } = JSON.parse(fs.readFileSync(at, 'utf8'));
    for (const [entry, value] of Object.entries(exports)) {
      const file = moduleOf(value);
      if (!file) continue;
      const key = `${name} ${entry}`;
      let source = path.join(root, 'packages', dir, file);
      if (key in BUILT_ELSEWHERE) {
        elsewhere.add(key);
        if (!BUILT_ELSEWHERE[key].source) continue;
        source = path.join(root, BUILT_ELSEWHERE[key].source);
      } else if (!fs.existsSync(source)) {
        problems.push(`${key}: ${file} is not here to import; name it in BUILT_ELSEWHERE with why`);
        continue;
      }
      for (const [k, v] of Object.entries(await import(pathToFileURL(source).href))) if (typeof v === 'function') found.add(`${name} ${k}`);
    }
  }
  for (const key of Object.keys(BUILT_ELSEWHERE)) if (!elsewhere.has(key)) problems.push(`${key}: in BUILT_ELSEWHERE, but no package exports it`);
  return { found, problems };
}

test('every function a package exports is a writer in the registry, or named with why it is not one', async () => {
  const { found, problems } = await exportedFunctions();
  assert.deepEqual(problems, []);
  const writers = new Set(WRITERS.map((w) => `${w.package} ${w.export}`));
  assert.deepEqual([...found].filter((k) => !writers.has(k) && !(k in NOT_A_WRITER)), [], 'exported, but neither a writer in scripts/lib/writers.mjs nor in its NOT_A_WRITER');
  assert.deepEqual([...writers, ...Object.keys(NOT_A_WRITER)].filter((k) => !found.has(k)), [], 'named in scripts/lib/writers.mjs, but no package exports it');
  assert.deepEqual([...writers].filter((k) => k in NOT_A_WRITER), [], 'both a writer and not one');
});

test('each writer in the registry has its own name and writes a string of its kind', () => {
  assert.equal(new Set(WRITERS.map((w) => w.name)).size, WRITERS.length);
  const blocks = [{ type: 'paragraph', content: [{ type: 'text', value: 'one word' }] }];
  for (const w of WRITERS) {
    assert.ok(['markdown', 'text', 'html'].includes(w.writes), w.name);
    const { output } = w.write(blocks);
    assert.equal(typeof output, 'string', w.name);
    assert.match(output, /one word/, w.name);
  }
});
