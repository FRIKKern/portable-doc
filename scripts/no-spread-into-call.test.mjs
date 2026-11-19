// No shipped code spreads an array into a call or a `new`: past about 115,000 items (fewer on a
// smaller stack) the arguments overflow the stack, and a long enough document decides the length.
// The rule has no exceptions; a fixed-size spread is written as a loop like any other.
//
// The scan reads every folder under packages/, found from disk, so a new package is scanned the
// day it lands. It leaves out only packages/editor, which is written only by the sync from
// Barkpark's paper editor; its spreads are fixed there. Inside a package it leaves out what is not
// shipped: tests, test folders, the two text test helpers, build output (dist/, built from the
// scanned src/) and installed modules.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// The TypeScript parser reads .js and .ts alike; React's build installs it.
const ts = createRequire(path.join(root, 'packages/react/package.json'))('typescript');

const SOURCE = /\.(?:[cm]?js|tsx?)$/;
const NOT_SHIPPED = [
  /\.test\.[cm]?[jt]sx?$/,
  /\.d\.[cm]?ts$/,
  /\/(?:test|tests|dist|node_modules)\//,
  /^packages\/text\/(?:block-forms|golden-reads)\.mjs$/,
];

/** Every file under `dir`, as paths from `base`. */
const walk = (base, dir) =>
  fs.readdirSync(path.join(base, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(base, `${dir}/${e.name}`) : [`${dir}/${e.name}`]));

/** The package folders under `base`/packages but the editor, read from disk. */
const packagesIn = (base) =>
  fs.readdirSync(path.join(base, 'packages'), { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'editor').map((e) => e.name).sort();

/** The shipped source files of every package under `base`, as paths from `base`. */
function shippedSources(base = root) {
  return packagesIn(base)
    .flatMap((name) => walk(base, `packages/${name}`))
    .filter((f) => SOURCE.test(f) && !NOT_SHIPPED.some((re) => re.test(`${f}`)))
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

test('the scan reads every package folder but the editor, and finds a spread in a call or a new', () => {
  const files = shippedSources();
  for (const name of packagesIn(root)) assert.ok(files.some((f) => f.startsWith(`packages/${name}/`)), name);
  assert.ok(!files.some((f) => f.startsWith('packages/editor/') || NOT_SHIPPED.some((re) => re.test(f))));
  assert.deepEqual(spreadsIntoCalls('a.ts', 'f(...a);\nnew C(1, ...b);\nconst c = [...a, ...b];\nconst d = { ...a };\n'), [
    'a.ts:1: f(...a)',
    'a.ts:2: new C(1, ...b)',
  ]);
});

test('a spread in a package folder the scan has never seen turns it red; one in the editor does not', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'spread-scan-'));
  try {
    const plant = { 'packages/a-new-package/src/index.js': 'export const zz = Math.max(...[1]);\n', 'packages/validate/index.js': 'export const zz = Math.max(...[1]);\n', 'packages/editor/src/index.js': 'export const zz = Math.max(...[1]);\n', 'packages/validate/index.test.mjs': 'f(...[1]);\n' };
    for (const [f, source] of Object.entries(plant)) {
      fs.mkdirSync(path.dirname(path.join(base, f)), { recursive: true });
      fs.writeFileSync(path.join(base, f), source);
    }
    const found = shippedSources(base).flatMap((f) => spreadsIntoCalls(f, fs.readFileSync(path.join(base, f), 'utf8')));
    assert.deepEqual(found, ['packages/a-new-package/src/index.js:1: Math.max(...[1])', 'packages/validate/index.js:1: Math.max(...[1])']);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('no shipped code spreads an array into a call or a new', () => {
  const found = shippedSources().flatMap((f) => spreadsIntoCalls(f, fs.readFileSync(path.join(root, f), 'utf8')));
  assert.deepEqual(found, []);
});
