import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { reactSources } from './lib/react-sources.mjs';

// The one walk of React's source (scripts/lib/react-sources.mjs) reads .ts and .tsx files and
// refuses, by name, a dot-named folder or source file (the type checker would leave it out, so it
// would be read by nobody) and one git ignores (only this checkout would have it). The plant trees
// are temp folders outside the repository, each its own git repository with this one's .gitignore.

const repoIgnore = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
// Git kept to the temp folder: no config of this machine's, and no repository above it.
const gitEnv = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CEILING_DIRECTORIES: fs.realpathSync(os.tmpdir()) };

test('the source walk reads .ts and .tsx files and refuses a dot-named or git-ignored folder or source file by name', () => {
  // As in this repository: the walk's root is a folder inside the git repository, not its top.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-sources-'));
  const root = path.join(repo, 'src');
  try {
    execFileSync('git', ['init', '-q', repo], { env: { ...process.env, ...gitEnv } });
    fs.writeFileSync(path.join(repo, '.gitignore'), `${repoIgnore}*.local.ts\n`);
    const plant = {
      'a.ts': '',
      'blocks/b.tsx': '',
      'blocks/c.d.ts': '',
      'notes.md': '',
      '.DS_Store': '',
      '.hidden.ts': '',
      '.plant/d.ts': "styleOf('width', n)\n",
      'blocks/.deep/e.tsx': '',
      'dist/f.ts': '',
      'blocks/g.local.ts': '',
      'blocks/h.local.md': '',
    };
    for (const [f, text] of Object.entries(plant)) {
      fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      fs.writeFileSync(path.join(root, f), text);
    }
    const saved = Object.fromEntries(Object.keys(gitEnv).map((k) => [k, process.env[k]]));
    Object.assign(process.env, gitEnv);
    let found;
    try {
      found = reactSources(root);
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    const { files, refused } = found;
    const rel = (list) => list.map((f) => path.relative(root, f));
    assert.deepEqual(rel(files), ['a.ts', 'blocks/b.tsx']);
    assert.deepEqual(rel(refused), ['.hidden.ts', '.plant', 'blocks/.deep', 'blocks/g.local.ts', 'dist']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a root outside any git checkout throws, saying the check needs one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-no-git-'));
  const saved = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir());
  try {
    fs.writeFileSync(path.join(root, 'a.ts'), '');
    assert.throws(() => reactSources(root), (e) => e instanceof Error && e.message.startsWith(`this check needs a git checkout; ${root} is not in one\n`) && /not a git repository/.test(e.message));
  } finally {
    if (saved === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = saved;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("React's source holds no dot-named or git-ignored folder or source file", () => {
  assert.deepEqual(reactSources().refused, []);
  assert.ok(reactSources().files.length > 0, 'no source files');
});
