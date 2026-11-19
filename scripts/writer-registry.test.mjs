import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BUILT_ELSEWHERE, NOT_A_WRITER, WRITERS } from './lib/writers.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

// Every file a package.json `exports` value names, under any condition (import, require, node,
// default, nested ones). Code is a .js, .mjs or .cjs file; a stylesheet, JSON or types file is not.
const filesOf = (value) => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(filesOf) : []);
const isCode = (file) => /\.[cm]?js$/.test(file);

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
      const files = [...new Set(filesOf(value).filter(isCode))];
      if (!files.length) continue;
      const key = `${name} ${entry}`;
      let sources = files.map((file) => [file, path.join(root, 'packages', dir, file)]);
      if (key in BUILT_ELSEWHERE) {
        elsewhere.add(key);
        const { source } = BUILT_ELSEWHERE[key];
        sources = source ? [[source, path.join(root, source)]] : [];
      }
      for (const [file, at] of sources) {
        if (!fs.existsSync(at)) {
          problems.push(`${key}: ${file} is not here to read; name the entry in BUILT_ELSEWHERE with why`);
          continue;
        }
        try {
          for (const [k, v] of Object.entries(await import(pathToFileURL(at).href))) if (typeof v === 'function') found.add(`${name} ${k}`);
        } catch (error) {
          problems.push(`${key}: ${file} cannot be read: ${error.message.split('\n')[0]}`);
        }
      }
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

test('the registry holds these seven writers, each writing a string of its kind', () => {
  assert.deepEqual(WRITERS.map((w) => w.name), [
    'readable Markdown',
    'plain text',
    'round-trip Markdown',
    'HTML',
    'HTML with field and embed blocks',
    'editor export',
    'editor source',
  ]);
  const blocks = [{ type: 'paragraph', content: [{ type: 'text', value: 'one word' }] }];
  for (const w of WRITERS) {
    assert.ok(['markdown', 'text', 'html'].includes(w.writes), w.name);
    const { output } = w.write(blocks);
    assert.equal(typeof output, 'string', w.name);
    assert.match(output, /one word/, w.name);
  }
});
