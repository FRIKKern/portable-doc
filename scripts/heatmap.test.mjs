import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MAX_NAME, PAD, W, textWidth } from './lib/heatmap.mjs';
import { sha256 } from './lib/pack.mjs';
import { pack, report } from './lib/synthetic.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heatmap test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;

const renderers = [{ renderer: 'b-text', compare: 'text' }, { renderer: 'ref', compare: 'dom', reference: true }, { renderer: 'a-text', compare: 'text' }, { renderer: 'c-dom', compare: 'dom' }];
const ORDER = ['ref', 'c-dom', 'a-text', 'b-text'];
const spec = { definitions: { blocks: { b0: { 'x-tier': 'element' }, b1: { 'x-tier': 'element' }, b2: { 'x-tier': 'section' }, b3: { 'x-tier': 'widget' } } } };
const STATUS = {
  'c-dom:b0': { status: 'fail' },
  'c-dom:b1': { status: 'missing' },
  'a-text:b2': { status: 'unchecked' },
  'c-dom:b3': { status: 'pass', via: 'host-paint' },
  'c-dom:b5': { status: 'fail', via: 'host-paint' },
  'b-text:b6': { status: 'fail' },
};
const status = (renderer, type) => STATUS[`${renderer}:${type}`] ?? { status: 'pass' };
const everyStatus = (renderer, type) => (renderer === 'ref' ? { status: 'pass' } : { status: ['pass', 'fail', 'missing', 'unchecked'][Number(type.replace(/\D/g, '')) % 4], ...(type.endsWith('7') && { via: 'host-paint' }) });

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

const rowOf = (svg, type) => svg.match(new RegExp(`<g data-type="${type}">.*?</g>`))[0];
const cells = (svg, type) => [...rowOf(svg, type).matchAll(/class="c-(\w+)"/g)].map((m) => m[1]);
const totalOf = (svg, renderer) => svg.match(new RegExp(`<g data-total="${renderer}">[\\s\\S]*?</g>`))[0];
const plain = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

function texts(svg) {
  return [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="(\d+)"([^>]*)>(.*?)<\/text>/g)].map(([, x, y, size, attrs, inner]) => {
    const w = textWidth(plain(inner), Number(size), { bold: /font-weight="(600|700)"/.test(attrs + inner), spacing: Number(attrs.match(/letter-spacing="([\d.]+)"/)?.[1] ?? 0) });
    const left = Number(x), top = Number(y) - Number(size);
    if (/rotate\(-55/.test(attrs)) return { left, right: left + w * Math.cos((55 * Math.PI) / 180), top: top - w * Math.sin((55 * Math.PI) / 180), bottom: Number(y), text: plain(inner) };
    if (/text-anchor="end"/.test(attrs)) return { left: left - w, right: left, top, bottom: Number(y), text: plain(inner) };
    if (/text-anchor="middle"/.test(attrs)) return { left: left - w / 2, right: left + w / 2, top, bottom: Number(y), text: plain(inner) };
    return { left, right: left + w, top, bottom: Number(y), text: plain(inner) };
  });
}

function rects(svg) {
  return [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(([, x, y, w, h]) => ({ left: Number(x), right: Number(x) + Number(w), top: Number(y), bottom: Number(y) + Number(h) }));
}

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

function assertFits(svg, label) {
  const rule = Number(svg.match(/<path d="M[\d.]+ ([\d.]+)H/)[1]);
  for (const head of texts(svg.match(/<text [^>]*rotate\(-55[^>]*>.*?<\/text>/g).join(''))) assert.ok(head.top >= rule, `${label}: column head ${head.text} reaches ${head.top}, above the rule at ${rule}`);
  for (const box of [...rects(svg), ...texts(svg)]) {
    assert.ok(box.left >= PAD - 1 && box.right <= W - PAD + 0.5, `${label}: ${JSON.stringify(box)} is outside ${PAD}..${W - PAD}`);
  }
  const blocks = [
    ...[...svg.matchAll(/<g data-type="[^"]+">.*?<\/g>/g)].map(([g]) => [...texts(g), ...rects(g)].reduce((a, b) => ({ left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), text: a.text ?? b.text }))),
    ...texts(svg.match(/<text [^>]*data-tier="[^"]+"[^>]*>.*?<\/text>/g)?.join('') ?? ''),
  ];
  const clear = (a) => ({ ...a, left: a.left - 12, right: a.right + 12 });
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) assert.ok(!overlaps(clear(blocks[i]), blocks[j]), `${label}: ${blocks[i].text} is within 12px of ${blocks[j].text}`);
  const columns = svg.match(/data-renderer="ref"/g).length;
  const n = svg.match(/data-renderer="/g).length / columns;
  const bands = [...svg.matchAll(/<rect x="([\d.]+)"[^>]*data-band/g)].map((m) => Number(m[1]));
  const tierXs = [...new Set([...svg.matchAll(/<text x="([\d.]+)"[^>]*data-tier/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  assert.equal(tierXs.length, bands.length, `${label}: one panel per band`);
  for (let p = 1; p < bands.length; p++) assert.ok(tierXs[p] - (bands[p - 1] + n * 32 - 1) >= 24, `${label}: panel ${p + 1} starts ${tierXs[p] - (bands[p - 1] + n * 32 - 1)}px after panel ${p}`);
  for (const [, g] of svg.matchAll(/<g data-total="[^"]+">([\s\S]*?)<\/g>/g)) {
    const [name, counts] = texts(g);
    assert.ok(name.right + 8 <= counts.left, `${label}: totals ${name.text} runs into ${counts.text}`);
  }
}

test('the heatmap is the same bytes for the same reports, and changes when a report does', () => {
  const root = repo();
  const first = draw(root);
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /wrote docs\/images\/conformance.svg: 80 types × 4 renderers/);
  assert.equal(draw(root).svg, first.svg);
  assert.equal(draw(repo()).svg, first.svg);
  const changed = repo({ status: (renderer, type) => (type === 'b40' ? { status: 'fail' } : status(renderer, type)) });
  assert.notEqual(draw(changed).svg, first.svg);
});

test('every pack type is one row and every renderer a column in every panel: reference, then dom, then text, by name', () => {
  const { svg } = draw(repo());
  for (let i = 0; i < 80; i++) assert.equal(svg.match(new RegExp(`<g data-type="b${i}">`, 'g'))?.length, 1, `b${i}`);
  const heads = [...svg.matchAll(/data-renderer="([^"]+)"/g)].map((m) => m[1]);
  const panels = heads.length / ORDER.length;
  assert.ok(panels >= 1);
  assert.deepEqual(heads, Array.from({ length: panels }, () => ORDER).flat());
  assert.deepEqual([...svg.matchAll(/<g data-total="([^"]+)">/g)].map((m) => m[1]), ORDER);
  assert.match(totalOf(svg, 'ref'), /· reference/);
  assert.doesNotMatch(totalOf(svg, 'c-dom'), /reference/);
});

test('the reference band sits on the reference column in every panel', () => {
  const { svg } = draw(repo());
  const bands = [...svg.matchAll(/<rect x="([\d.]+)"[^>]*data-band="ref"/g)].map((m) => Number(m[1]) + 1);
  assert.equal(bands.length, svg.match(/data-renderer="ref"/g).length);
  for (let i = 0; i < 80; i++) {
    const x = Number(rowOf(svg, `b${i}`).match(/<rect x="([\d.]+)"/)[1]);
    assert.ok(bands.includes(x), `b${i}: first cell at ${x}, bands at ${bands}`);
  }
});

test('each status has its own fill, stroke and glyph, and host-paint cells carry a mark', () => {
  const { svg } = draw(repo());
  assert.deepEqual(cells(svg, 'b0'), ['pass', 'fail', 'pass', 'pass']);
  assert.deepEqual(cells(svg, 'b1'), ['pass', 'missing', 'pass', 'pass']);
  assert.deepEqual(cells(svg, 'b2'), ['pass', 'pass', 'unchecked', 'pass']);
  assert.match(rowOf(svg, 'b0'), /class="g-fail">✕</);
  assert.match(rowOf(svg, 'b1'), /class="g-missing">∅</);
  assert.match(rowOf(svg, 'b2'), /class="g-unchecked">\?</);
  assert.match(rowOf(svg, 'b4'), /class="g-pass">✓</);
  assert.match(rowOf(svg, 'b3'), /class="via via-pass"/);
  assert.match(rowOf(svg, 'b5'), /class="via via-fail"/);
  assert.doesNotMatch(rowOf(svg, 'b4'), /class="via/);
  for (const rule of [
    '.c-pass { fill: var(--pass); }',
    '.c-fail { fill: var(--failbg); stroke: var(--fail); stroke-width: 1.5; }',
    '.c-missing { fill: var(--missbg); stroke: var(--missing); stroke-width: 1.5; stroke-dasharray: 3 2; }',
    '.c-unchecked { fill: url(#hatch); stroke: var(--unchecked); }',
    '.g-pass { fill: var(--on-pass); } .g-fail { fill: var(--fail); } .g-missing { fill: var(--missing); } .g-unchecked { fill: var(--ink); }',
  ]) assert.ok(svg.includes(rule), rule);
});

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('pass and fail differ in lightness, and every glyph reads on its cell, in light and in dark', () => {
  const { svg } = draw(repo());
  const [light, dark] = [...svg.matchAll(/svg \{ (--[^}]+)\}/g)].map((m) => Object.fromEntries([...m[1].matchAll(/(--[\w-]+):(#[0-9a-f]{6})/g)].map((t) => [t[1], t[2]])));
  for (const [mode, t] of [['light', light], ['dark', dark]]) {
    assert.ok(contrast(t['--pass'], t['--failbg']) >= 3, `${mode}: pass ${t['--pass']} vs fail ${t['--failbg']}`);
    assert.ok(contrast(t['--on-pass'], t['--pass']) >= 4.5, `${mode}: ✓ on pass`);
    assert.ok(contrast(t['--fail'], t['--failbg']) >= 4.5, `${mode}: ✕ on fail`);
    assert.ok(contrast(t['--missing'], t['--missbg']) >= 4.5, `${mode}: ∅ on missing`);
    assert.ok(contrast(t['--ink'], t['--card']) >= 4.5, `${mode}: ? on unchecked`);
  }
});

test('the headline, the totals and the footer stamp come from the reports', () => {
  const root = repo();
  const { svg } = draw(root);
  assert.match(svg, /data-headline="">315<tspan class="muted" font-weight="400"> \/ 320<\/tspan>/);
  assert.equal(plain(totalOf(svg, 'c-dom')).replace(/\s+/g, ' ').trim(), 'c-dom ✓ 77 pass✕ 2 fail∅ 1 missing(2 host-paint)');
  assert.equal(plain(totalOf(svg, 'ref')).replace(/\s+/g, ' ').trim(), 'ref · reference ✓ 80 pass');
  assert.equal(plain(totalOf(svg, 'a-text')).replace(/\s+/g, ' ').trim(), 'a-text ✓ 79 pass? 1 unchecked');
  const segments = [...totalOf(svg, 'c-dom').matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="12" class="c-(\w+)"/g)].map((m) => ({ x: Number(m[1]), w: Number(m[2]), s: m[3] }));
  const counts = { pass: 77, fail: 2, missing: 1 };
  assert.deepEqual(segments.map((s) => s.s), ['pass', 'fail', 'missing']);
  let x = PAD;
  for (const seg of segments) {
    assert.ok(Math.abs(seg.x - x) < 1e-6 && Math.abs(seg.w - ((W - 2 * PAD) * counts[seg.s]) / 80) < 1e-6, JSON.stringify(seg));
    x += seg.w;
  }
  const stamp = sha256(path.join(root, 'goldens/stamp.json')).slice(0, 12);
  assert.match(svg, new RegExp(`pack stamp ${stamp} ·`));
});

test('rows group by x-tier: element, widget, section, other tiers by name, untiered last; only a continued tier says (cont.)', () => {
  const tiered = { definitions: { blocks: { ...spec.definitions.blocks, b4: { 'x-tier': 'layout' }, b5: { 'x-tier': 'block' } } } };
  const { svg } = draw(repo({ spec: tiered }));
  const heads = [...svg.matchAll(/data-tier="([^"]+)">([A-Z]+) · (\d+)( \(cont\.\))?</g)].map((m) => ({ tier: m[1], label: `${m[2]} ${m[3]}`, cont: !!m[4] }));
  assert.deepEqual([...new Set(heads.map((h) => h.label))], ['ELEMENT 2', 'WIDGET 1', 'SECTION 1', 'BLOCK 1', 'LAYOUT 1', 'OTHER 74']);
  heads.forEach((h, i) => assert.equal(h.cont, i > 0 && heads[i - 1].tier === h.tier, JSON.stringify(h)));
  assert.ok(heads.some((h) => h.cont));
  const untiered = draw(repo({ spec: null })).svg;
  assert.deepEqual([...new Set([...untiered.matchAll(/data-tier="([^"]+)"/g)].map((m) => m[1]))], ['other']);
});

test('the panels are as short as the rows allow: no empty row above the footer', () => {
  for (const blocks of [80, 81, 83]) {
    const { svg } = draw(repo({ blocks }));
    const height = Number(svg.match(/<svg [^>]*height="(\d+)"/)[1]);
    const lowest = Math.max(...[...svg.matchAll(/<g data-type="[^"]+"><text x="[\d.]+" y="([\d.]+)"/g)].map((m) => Number(m[1])));
    assert.equal(height - lowest, 71, `${blocks} blocks`);
  }
});

const many = (count, name = (i) => `renderer-${i}`) => [{ renderer: 'ref', compare: 'dom', reference: true }, ...Array.from({ length: count - 1 }, (_, i) => ({ renderer: name(i), compare: i % 2 ? 'text' : 'dom' }))];
const longTypes = Array.from({ length: 80 }, (_, i) => (i % 10 ? `type-${i}` : `a-much-longer-block-type-${i}`));

test('it fits the card at 1 to 10 renderers, with long type names and every status in a totals row', () => {
  for (let count = 1; count <= 10; count++) {
    const { code, out, svg } = draw(repo({ renderers: many(count), types: longTypes, status: everyStatus }));
    assert.equal(code, 0, out);
    assertFits(svg, `${count} renderers`);
  }
});

test(`it fits renderer names of ${MAX_NAME} characters and refuses longer ones`, () => {
  const name = (i) => `${'n'.repeat(MAX_NAME - 3)}-${String(i).padStart(2, '0')}`;
  const fits = draw(repo({ renderers: many(7, name), status: everyStatus }));
  assert.equal(fits.code, 0, fits.out);
  assertFits(fits.svg, 'long names');
  const over = draw(repo({ renderers: many(2, () => 'w'.repeat(MAX_NAME + 1)) }));
  assert.equal(over.code, 1, over.out);
  assert.match(over.out, new RegExp(`renderer names over ${MAX_NAME} characters do not fit: w{${MAX_NAME + 1}}\\nnothing drawn`));
  assert.equal(over.svg, null);
});

test('it refuses more renderers than one panel can hold, naming the limit', () => {
  const r = draw(repo({ renderers: many(40), types: longTypes }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /40 renderers need a \d+px panel; the card has 1120px\nnothing drawn/);
  assert.equal(r.svg, null);
});

test('the heatmap refuses reports that fail the pack check and writes nothing', () => {
  const root = repo();
  report(root, renderers[0], ['b0'], status);
  const r = draw(root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /nothing drawn/);
  assert.match(r.out, /conformance\/b-text.json: no row for pack type b1/);
  assert.equal(r.svg, null);
});
