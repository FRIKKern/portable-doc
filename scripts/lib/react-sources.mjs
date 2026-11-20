// SPDX-License-Identifier: Apache-2.0
// The one walk of React's source files that the source tests read: the number door scan, its plain
// search, the style formats test and the style sites test. Each takes its root as an argument, so a
// plant run points it at a temp copy outside the tree. A folder whose name starts with a dot, or a
// .ts or .tsx file whose does, is not skipped: the type checker's include leaves it out, so a source
// file there would be read by nobody. It is refused instead, by name, and every test that walks is
// red on it. Other dot files (an editor's or a file manager's) are neither read nor refused.
// A folder or source file git ignores (the root .gitignore's `dist/` matches one under src) is
// refused the same way: the type checker would read it here, but it never reaches another checkout,
// so a test could pass on a tree nobody else has. Git answers which paths it ignores, once per walk;
// a root outside a git checkout throws, saying so.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REACT_SRC = fileURLToPath(new URL('../../packages/react/src', import.meta.url));

/**
 * The .ts and .tsx files under root (no .d.ts), sorted, and each dot-named or git-ignored folder or
 * source file under it.
 * @param {string} [root]
 * @returns {{ files: string[], refused: string[] }}
 */
export function reactSources(root = REACT_SRC) {
  const files = [];
  const refused = [];
  const ignored = ignoredByGit(root);
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const source = /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts');
      if (e.name.startsWith('.') || ignored.has(p)) {
        if (e.isDirectory() || source) refused.push(p);
      } else if (e.isDirectory()) walk(p);
      else if (source) files.push(p);
    }
  };
  walk(root);
  return { files: files.sort(), refused: refused.sort() };
}

/**
 * The paths under root that git ignores, absolute; an ignored folder is listed once, not its files.
 * @param {string} root
 * @returns {Set<string>}
 */
function ignoredByGit(root) {
  const r = spawnSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], { cwd: root, encoding: 'utf8' });
  if (r.error) throw new Error(`this check needs git, and it could not run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`this check needs a git checkout; ${root} is not in one\n${r.stderr}`);
  return new Set(r.stdout.split('\0').filter(Boolean).map((p) => path.join(root, p.replace(/\/$/, ''))));
}
