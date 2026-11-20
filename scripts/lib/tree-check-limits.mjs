// SPDX-License-Identifier: Apache-2.0
// What the root test run's tree check (scripts/test-files.mjs --run) does not see. Kept apart from
// the runner, which is only a script, so a test can import the list.

/**
 * What the tree check does not see, each with a plant: the body of a test that does exactly that,
 * run from scripts/ in a git repository holding this repository's .gitignore. editor-sync.test.mjs
 * runs each plant and shows the run passing on it, and that each path in `stays` is there after the
 * run. When the check learns to see a case, its plant turns red and its row leaves this list.
 */
export const TREE_CHECK_LIMITS = Object.freeze([
  {
    limit: 'a file made and removed inside the run',
    plant: "const f = new URL('../made.txt', import.meta.url); fs.writeFileSync(f, 'x'); fs.rmSync(f);",
    stays: [],
  },
  {
    limit: 'a path git ignores outside a walked source root',
    plant: "fs.mkdirSync(new URL('../dist/', import.meta.url)); fs.writeFileSync(new URL('../dist/x.js', import.meta.url), 'x');",
    stays: ['dist/x.js'],
  },
  {
    limit: 'an empty new folder',
    plant: "fs.mkdirSync(new URL('../empty/', import.meta.url));",
    stays: ['empty'],
  },
]);
