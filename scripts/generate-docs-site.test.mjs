import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { generateDocsSite } from './generate-docs-site.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-doc-site-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function tree(dir) {
  return Object.fromEntries(fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => {
    const file = path.join(entry.parentPath, entry.name);
    return [path.relative(dir, file).split(path.sep).join('/'), createHash('sha256').update(fs.readFileSync(file)).digest('hex')];
  }).sort(([a], [b]) => a.localeCompare(b)));
}

function localLinks(file) {
  return [...fs.readFileSync(file, 'utf8').matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((target) => !/^(?:https?:|#)/.test(target));
}

test('the site is deterministic, linked and carries exact synced evidence', () => {
  const out = path.join(tmp, 'site');
  const first = generateDocsSite(out);
  const firstTree = tree(out);
  assert.deepEqual(tree(out), firstTree);
  assert.deepEqual(generateDocsSite(out), first);
  assert.deepEqual(tree(out), firstTree);
  const stamp = createHash('sha256').update(fs.readFileSync(path.join(root, 'goldens', 'stamp.json'))).digest('hex');
  const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.equal(first.stamp, stamp);
  assert.match(index, new RegExp(stamp));
  assert.match(index, new RegExp(JSON.parse(fs.readFileSync(path.join(root, 'SOURCE.json'))).commit));
  assert.deepEqual([first.fixtures, first.hosts], [4, 7]);
  for (const file of ['index.html', 'spec.html']) {
    for (const target of localLinks(path.join(out, file))) {
      assert.ok(fs.existsSync(path.resolve(out, target.split('#')[0])), `${file}: missing ${target}`);
    }
  }
  for (const name of ['light-en', 'dark-en', 'light-nb-NO', 'dark-nb-NO']) {
    assert.deepEqual(fs.readFileSync(path.join(out, 'fixtures', `${name}.html`)), fs.readFileSync(path.join(root, 'goldens', 'pages', `${name}.html`)));
  }
  const build = JSON.parse(fs.readFileSync(path.join(out, 'build-manifest.json')));
  assert.equal(build.packStamp, stamp);
  assert.equal(build.hosts.length, 7);
  const unresolved = [...new Set(build.fixtures.flatMap((fixture) => fixture.unresolvedLocalReferences))].sort();
  assert.deepEqual(unresolved, [
    '/assets/asciinema-player.css',
    '/assets/asciinema-player.min.js',
    '/assets/bp-graph.js',
    '/assets/bp-modal-focus.js',
    '/assets/bp-paper-code.js',
    '/assets/bp-paper-mermaid.js',
    '/assets/phoenix.js',
    '/assets/phoenix_live_view.js',
    '/fonts/SourceSerif4Variable-Italic.woff2',
    '/fonts/SourceSerif4Variable-Roman.woff2',
    '/papers/example-authoring-guide',
  ]);
});

test('the generator rejects repository and filesystem roots as output', () => {
  const packageHash = createHash('sha256').update(fs.readFileSync(path.join(root, 'package.json'))).digest('hex');
  assert.throws(() => generateDocsSite(root), /contains the repository/);
  assert.throws(() => generateDocsSite(path.dirname(root)), /contains the repository/);
  assert.throws(() => generateDocsSite(path.parse(root).root), /contains the repository/);
  assert.throws(() => generateDocsSite(path.join(root, 'scripts', 'site')), /repository output must be/);
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, 'package.json'))).digest('hex'), packageHash);
});

test('existing and symlinked destinations fail closed without touching their files', () => {
  const occupied = path.join(tmp, 'occupied');
  fs.mkdirSync(occupied);
  fs.writeFileSync(path.join(occupied, 'sentinel.txt'), 'keep me\n');
  assert.throws(() => generateDocsSite(occupied), /without an ownership marker/);
  assert.equal(fs.readFileSync(path.join(occupied, 'sentinel.txt'), 'utf8'), 'keep me\n');

  const target = path.join(tmp, 'symlink-target');
  const link = path.join(tmp, 'symlink-output');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'sentinel.txt'), 'still here\n');
  fs.symlinkSync(target, link);
  assert.throws(() => generateDocsSite(link), /symlinked output path/);
  assert.equal(fs.readFileSync(path.join(target, 'sentinel.txt'), 'utf8'), 'still here\n');

  const parentTarget = path.join(tmp, 'parent-target');
  const parentLink = path.join(tmp, 'parent-link');
  fs.mkdirSync(parentTarget);
  fs.writeFileSync(path.join(parentTarget, 'sentinel.txt'), 'parent kept\n');
  fs.symlinkSync(parentTarget, parentLink);
  assert.throws(() => generateDocsSite(path.join(parentLink, 'site')), /symlinked output path/);
  assert.equal(fs.readFileSync(path.join(parentTarget, 'sentinel.txt'), 'utf8'), 'parent kept\n');
  assert.deepEqual(fs.readdirSync(tmp).filter((name) => name.startsWith('.portable-doc-docs-site-')), []);
});

test('an owned output rejects extra or modified files and preserves them', () => {
  const out = path.join(tmp, 'owned');
  generateDocsSite(out);
  fs.writeFileSync(path.join(out, 'sentinel.txt'), 'unrelated\n');
  assert.throws(() => generateDocsSite(out), /unowned or missing files/);
  assert.equal(fs.readFileSync(path.join(out, 'sentinel.txt'), 'utf8'), 'unrelated\n');

  fs.rmSync(path.join(out, 'sentinel.txt'));
  fs.appendFileSync(path.join(out, 'index.html'), 'changed');
  assert.throws(() => generateDocsSite(out), /generated output was modified/);
  assert.match(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), /changed$/);
  assert.deepEqual(fs.readdirSync(tmp).filter((name) => name.startsWith('.portable-doc-docs-site-')), []);
});

test('a mid-generation failure preserves the owned output and removes staging', () => {
  const out = path.join(tmp, 'mid-generation');
  generateDocsSite(out);
  const before = tree(out);
  const stagingBefore = fs.readdirSync(tmp).filter((name) => name.startsWith('.portable-doc-docs-site-')).sort();
  const copyFileSync = fs.copyFileSync;
  let copies = 0;
  fs.copyFileSync = (...args) => {
    copies += 1;
    if (copies === 2) throw new Error('planted mid-generation copy failure');
    return copyFileSync(...args);
  };
  try {
    assert.throws(() => generateDocsSite(out), /planted mid-generation copy failure/);
  } finally {
    fs.copyFileSync = copyFileSync;
  }
  assert.equal(copies, 2);
  assert.deepEqual(tree(out), before);
  assert.deepEqual(fs.readdirSync(tmp).filter((name) => name.startsWith('.portable-doc-docs-site-')).sort(), stagingBefore);
});
