import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { reactSources } from './lib/react-sources.mjs';

// The one walk of React's source (scripts/lib/react-sources.mjs) reads .ts and .tsx files and
// refuses, by name, a dot-named folder or source file: the type checker would leave it out, so a
// source file there would be read by nobody. The plant tree is a temp folder outside the repository.

test('the source walk reads .ts and .tsx files and refuses a dot-named folder or source file by name', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-sources-'));
  try {
    const plant = {
      'a.ts': '',
      'blocks/b.tsx': '',
      'blocks/c.d.ts': '',
      'notes.md': '',
      '.DS_Store': '',
      '.hidden.ts': '',
      '.plant/d.ts': "styleOf('width', n)\n",
      'blocks/.deep/e.tsx': '',
    };
    for (const [f, text] of Object.entries(plant)) {
      fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      fs.writeFileSync(path.join(root, f), text);
    }
    const { files, refused } = reactSources(root);
    const rel = (list) => list.map((f) => path.relative(root, f));
    assert.deepEqual(rel(files), ['a.ts', 'blocks/b.tsx']);
    assert.deepEqual(rel(refused), ['.hidden.ts', '.plant', 'blocks/.deep']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("React's source holds no dot-named folder or source file", () => {
  assert.deepEqual(reactSources().refused, []);
  assert.ok(reactSources().files.length > 0, 'no source files');
});
