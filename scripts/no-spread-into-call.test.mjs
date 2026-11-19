// No shipped code spreads an array into a call or a `new`: past about 115,000 items (fewer on a
// smaller stack) the arguments overflow the stack, and a long enough document decides the length.
// The rule has no exceptions; a fixed-size spread is written as a loop like any other.
//
// The scan reads all the shipped code but packages/editor, which is written only by the sync from
// Barkpark's paper editor; its spreads are fixed there. Tests and test helpers are not shipped, so
// they stay out by path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// The TypeScript parser reads .js and .ts alike; React's build installs it.
const ts = createRequire(path.join(root, 'packages/react/package.json'))('typescript');

const walk = (dir) =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
const isTest = (f) => /\.test\.[cm]?[jt]sx?$/.test(f) || f.startsWith('packages/mcp/test/');

/** The shipped source files, as paths from the repo root. */
function shippedSources() {
  return [
    // The text package ships its *.js; its *.mjs files are test helpers.
    ...walk('packages/text').filter((f) => /^packages\/text\/[^/]+\.js$/.test(f)),
    ...walk('packages/react/src').filter((f) => /\.tsx?$/.test(f)),
    ...walk('packages/code/src').filter((f) => /\.m?js$/.test(f)),
    ...walk('packages/cli').filter((f) => /\.m?js$/.test(f)),
    ...walk('packages/mcp').filter((f) => /\.m?js$/.test(f)),
  ]
    .filter((f) => !isTest(f) && !f.includes('/node_modules/'))
    .sort();
}

/** Each call or `new` in a source that spreads an argument, as "file:line: code". */
function spreadsIntoCalls(file, source) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const found = [];
  const visit = (node) => {
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && (node.arguments ?? []).some(ts.isSpreadElement)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      found.push(`${file}:${line}: ${node.getText(sf).replace(/\s+/g, ' ').slice(0, 100)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

test('the scan reads every shipped package but the editor, and finds a spread in a call or a new', () => {
  const files = shippedSources();
  for (const dir of ['packages/text/', 'packages/react/src/', 'packages/code/src/', 'packages/cli/', 'packages/mcp/'])
    assert.ok(files.some((f) => f.startsWith(dir)), dir);
  assert.ok(!files.some((f) => f.startsWith('packages/editor/') || isTest(f) || (f.endsWith('.mjs') && f.startsWith('packages/text/'))));
  assert.deepEqual(spreadsIntoCalls('a.ts', 'f(...a);\nnew C(1, ...b);\nconst c = [...a, ...b];\nconst d = { ...a };\n'), [
    'a.ts:1: f(...a)',
    'a.ts:2: new C(1, ...b)',
  ]);
});

test('no shipped code spreads an array into a call or a new', () => {
  const found = shippedSources().flatMap((f) => spreadsIntoCalls(f, fs.readFileSync(path.join(root, f), 'utf8')));
  assert.deepEqual(found, []);
});
