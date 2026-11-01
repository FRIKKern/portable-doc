import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RENDERERS, pack, report } from './lib/synthetic.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heatmap test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;

const renderers = [...RENDERERS, { renderer: 'dom-a', compare: 'dom' }];
const spec = { definitions: { blocks: { b0: { 'x-tier': 'element' }, b1: { 'x-tier': 'element' }, b2: { 'x-tier': 'section' }, b3: { 'x-tier': 'widget' } } } };
const STATUS = { 'dom-a:b0': { status: 'fail' }, 'dom-a:b1': { status: 'missing' }, 'text-b:b2': { status: 'unchecked' }, 'dom-a:b3': { status: 'pass', via: 'host-paint' } };
const status = (renderer, type) => STATUS[`${renderer}:${type}`] ?? { status: 'pass' };

function repo(opts = {}) {
  const root = path.join(tmp, `repo-${n++}`);
  fs.cpSync(scripts, path.join(root, 'scripts'), { recursive: true, filter: (f) => !f.endsWith('.test.mjs') });
  return pack(root, { spec, renderers, status, ...opts });
}

function draw(root) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'generate-heatmap.mjs')], { cwd: tmp, encoding: 'utf8' });
  const file = path.join(root, 'docs/images/conformance.svg');
  return { code: r.status, out: r.stdout + r.stderr, svg: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null };
}

const cells = (svg, type) => [...svg.match(new RegExp(`<g data-type="${type}">.*?</g>`))[0].matchAll(/class="c-(\w+)"/g)].map((m) => m[1]);

test('the heatmap is the same bytes for the same reports, and changes when a report does', () => {
  const root = repo();
  const first = draw(root);
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /wrote docs\/images\/conformance.svg: 80 types × 3 renderers/);
  assert.equal(draw(root).svg, first.svg);
  assert.equal(draw(repo()).svg, first.svg);
  const changed = repo({ status: (renderer, type) => (type === 'b40' ? { status: 'fail' } : status(renderer, type)) });
  assert.notEqual(draw(changed).svg, first.svg);
});

test('every pack type is one row and every renderer a column in every panel, reference first', () => {
  const { svg } = draw(repo());
  for (let i = 0; i < 80; i++) assert.equal(svg.match(new RegExp(`<g data-type="b${i}">`, 'g'))?.length, 1, `b${i}`);
  const heads = [...svg.matchAll(/data-renderer="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(heads, ['ref', 'dom-a', 'text-b', 'ref', 'dom-a', 'text-b', 'ref', 'dom-a', 'text-b']);
  for (const r of renderers) assert.match(svg, new RegExp(`<g data-total="${r.renderer}">`));
  assert.match(svg, /<g data-total="ref">.*· reference/s);
  assert.equal(svg.match(/class="ref"\/>/g).length, 4);
});

test('each status has its own colour class and glyph, and host-paint cells carry a mark', () => {
  const { svg } = draw(repo());
  assert.deepEqual(cells(svg, 'b0'), ['pass', 'fail', 'pass']);
  assert.deepEqual(cells(svg, 'b1'), ['pass', 'missing', 'pass']);
  assert.deepEqual(cells(svg, 'b2'), ['pass', 'pass', 'unchecked']);
  const row = (type) => svg.match(new RegExp(`<g data-type="${type}">.*?</g>`))[0];
  assert.match(row('b0'), /class="g-fail">✕</);
  assert.match(row('b1'), /class="g-missing">∅</);
  assert.match(row('b2'), /class="g-unchecked">\?</);
  assert.match(row('b4'), /class="g-pass">✓</);
  assert.match(row('b3'), /class="via"/);
  assert.doesNotMatch(row('b4'), /class="via"/);
  assert.match(svg, /<g data-total="dom-a">.*✓ 78.*✕ 1.*∅ 1.*\(1 host-paint\)/s);
  for (const s of ['pass', 'fail', 'missing', 'unchecked']) assert.match(svg, new RegExp(`\\.c-${s} \\{[^}]*var\\(--`));
  assert.match(svg, /@media \(prefers-color-scheme: dark\)/);
});

test('rows group by x-tier, element then widget then section, untiered types last', () => {
  const { svg } = draw(repo());
  const heads = [...svg.matchAll(/letter-spacing="1.5" class="muted">([A-Z]+) · (\d+)/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual([...new Set(heads)], ['ELEMENT 2', 'WIDGET 1', 'SECTION 1', 'OTHER 76']);
});

test('the heatmap refuses reports that fail the pack check and writes nothing', () => {
  const root = repo();
  report(root, renderers[1], ['b0'], status);
  const r = draw(root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /nothing drawn/);
  assert.match(r.out, /conformance\/text-b.json: no row for pack type b1/);
  assert.equal(r.svg, null);
});
