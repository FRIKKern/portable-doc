import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { describeType, generateDocsSite } from './generate-docs-site.mjs';

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

test('every schema block type gets a page: its fields, its golden and every renderer\'s result', () => {
  const out = path.join(tmp, 'blocks');
  const result = generateDocsSite(out);
  const definitions = JSON.parse(fs.readFileSync(path.join(root, 'spec', 'blocks.schema.json'))).definitions;
  const types = Object.keys(definitions.blocks).sort();
  assert.ok(types.length >= 80, `${types.length} types`);
  assert.equal(result.blocks, types.length);
  assert.deepEqual(fs.readdirSync(path.join(out, 'blocks')).sort(), types.map((type) => `${type}.html`).sort());
  const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  const reports = fs.readdirSync(path.join(root, 'conformance')).filter((file) => file.endsWith('.json')).map((file) => JSON.parse(fs.readFileSync(path.join(root, 'conformance', file))));
  assert.ok(reports.length >= 6, `${reports.length} reports`);
  const build = JSON.parse(fs.readFileSync(path.join(out, 'build-manifest.json')));
  const known = new Set(build.blocks.flatMap((block) => block.unresolvedLocalReferences));
  for (const type of types) {
    const file = path.join(out, 'blocks', `${type}.html`);
    const html = fs.readFileSync(file, 'utf8');
    assert.ok(index.includes(`href="blocks/${type}.html"`), `index: no link to ${type}`);
    for (const field of Object.keys(definitions.blocks[type].properties).filter((name) => name !== 'type')) assert.ok(html.includes(`<td><code>${field}</code></td>`), `${type}: no field ${field}`);
    const goldenFile = path.join(root, 'goldens', 'blocks', `${type}.golden.json`);
    if (fs.existsSync(goldenFile)) {
      assert.ok(html.includes(JSON.parse(fs.readFileSync(goldenFile)).expectedHtml), `${type}: golden is not the exact bytes`);
      for (const report of reports) {
        const row = report.rows.find((candidate) => candidate.type === type);
        assert.ok(row, `${report.renderer}: no row for ${type}`);
        assert.ok(html.includes(`<td>${row.status}${row.via ? ` (${row.via})` : ''}</td>`) && html.includes(`<td>${report.renderer}`), `${type}: no result from ${report.renderer}`);
      }
    } else {
      assert.equal(type, 'master-ref', 'only master-ref has no golden today');
      assert.match(html, /The pack holds no golden/);
    }
    for (const target of localLinks(file)) {
      if (target.startsWith('/')) assert.ok(known.has(target), `${type}: ${target} is not in the build manifest`);
      else assert.ok(fs.existsSync(path.resolve(path.dirname(file), target.split('#')[0])), `${type}: missing ${target}`);
    }
  }
  for (const name of ['paper-surface.css', 'code-tokens.css']) assert.deepEqual(fs.readFileSync(path.join(out, 'css', name)), fs.readFileSync(path.join(root, 'goldens', 'css', name)));
});

test('describeType says what a schema node takes', () => {
  for (const [node, words] of [
    [{ type: 'string' }, 'string'],
    [{ type: ['string', 'number'] }, 'string or number'],
    [{ type: 'integer', minimum: 1, maximum: 6 }, 'integer from 1 to 6'],
    [{ anyOf: [{ type: 'integer', minimum: 1, maximum: 6 }, { enum: ['1', '2'] }] }, 'integer from 1 to 6 or "1" | "2"'],
    [{ type: 'array', items: { $ref: '#' } }, 'array of block'],
    [{ type: 'array', items: { $ref: '#/definitions/inline' } }, 'array of inline'],
    [{ type: 'object', properties: { b: {}, a: {} } }, 'object with a, b'],
    [{ const: 'x' }, '"x"'],
    [{}, 'any'],
  ]) assert.equal(describeType(node), words);
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
