// Every styleOf call in React's source is rendered by a guard: a block golden, a limit golden or a
// recorded stand-in row whose HTML the built React writes byte for byte, here, and which holds what
// that call writes. A call that can write in several ways (a heatmap grid with and without row
// labels, a matrix with and without values and marginals) has one case per way, and each case needs
// a guard. The calls are found by a plain search of the source, `styleOf(`; each is named
// <file>#<first argument>#<nth call with that argument in the file>, so a moved line keeps its name.
// A call with no case below, a case for a call that is gone, and a case no guard renders are red.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderPortableDocument } from '@portable-doc/react';
import { fieldBlocks } from '@portable-doc/react/field-blocks';
import { embedBlocks } from '@portable-doc/react/embed';
import { NOT_YET, limitGoldens } from './lib/limit-goldens.mjs';
import { REACT_SRC, reactSources } from './lib/react-sources.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = REACT_SRC;
const N = '\\d+';

// What each call writes, matched with its element's class, one row per case.
const CASES = {
  "core#'grid-column'#1": [['section cell span', /bp-section__cell" style="[^"]*grid-column:span \d/]],
  "core#'order'#1": [['section cell order', /bp-section__cell" style="[^"]*\border:-?\d/]],
  "core#'--bp-tracks'#1": [['section grid tracks', /bp-section__grid" style="--bp-tracks:\d/]],
  "core#'--bp-cols'#1": [['columns count', /bp-cols" style="--bp-cols:\d/]],
  "roadmap-marks#'left'#1": [['roadmap bar left in %', /bp-rm__bar[^"]*" style="left:[\d.]+%/]],
  "roadmap-marks#'width'#1": [['roadmap bar width in %', /bp-rm__bar[^"]*" style="[^"]*\bwidth:[\d.]+%/]],
  "dataviz#'width'#1": [['stat bar width in %', /bp-stat__bar"><i style="width:[\d.]+%"/]],
  "dataviz#'grid-column'#1": [['heatmap gap span', /<i style="grid-column:span \d+"><\/i>/]],
  "dataviz#'--i'#1": [['heatmap cell --i', /bp-heat__c" style="--i:[\d.]+" title=/]],
  "dataviz#'--i'#2": [['heatmap legend --i', /bp-heat__c" style="--i:[\d.]+"><\/i>/]],
  "dataviz#'grid-template-columns'#1": [
    ['heatmap grid, no row labels', new RegExp(`class="bp-heat"><div class="bp-heat__grid" style="grid-template-columns:repeat\\(${N},minmax\\(10px,44px\\)\\)"`)],
    ['heatmap grid, row labels', new RegExp(`class="bp-heat"><div class="bp-heat__grid" style="grid-template-columns:auto repeat\\(${N},minmax\\(10px,44px\\)\\)"`)],
  ],
  "dataviz#'grid-template-columns'#2": [
    ['calendar, no row labels', new RegExp(`bp-heat--cal"><div class="bp-heat__scroll"><div class="bp-heat__grid" style="grid-template-columns:repeat\\(${N},12px\\)"`)],
    ['calendar, row labels', new RegExp(`bp-heat--cal"><div class="bp-heat__scroll"><div class="bp-heat__grid" style="grid-template-columns:auto repeat\\(${N},12px\\)"`)],
  ],
  "dataviz#'grid-template-columns'#3": [
    ['matrix, values, no marginals, no row labels', new RegExp(`bp-heat--mtx"><div class="bp-heat__grid" style="grid-template-columns:repeat\\(${N},minmax\\(28px,auto\\)\\)"`)],
    ['matrix, values, no marginals, row labels', new RegExp(`bp-heat--mtx"><div class="bp-heat__grid" style="grid-template-columns:auto repeat\\(${N},minmax\\(28px,auto\\)\\)"`)],
    ['matrix, values and marginals', new RegExp(`bp-heat--mtx"><div class="bp-heat__grid" style="grid-template-columns:auto repeat\\(${N},minmax\\(28px,auto\\)\\) auto"`)],
    ['matrix, marginals, no values', new RegExp(`bp-heat--mtx"><div class="bp-heat__grid" style="grid-template-columns:auto repeat\\(${N},minmax\\(10px,44px\\)\\) auto"`)],
  ],
  "dataviz#'width'#2": [['bar row width in %', /<span class="[\w-]+__bar"><i style="width:[\d.]+%"/]],
  "dataviz#'max-width'#1": [['route max-width in px', /bp-route__map"[^>]*style="[^"]*max-width:\d+px/]],
  "sheet#'width'#1": [['sheet column width in px', /bp-sheet__th" style="width:\d+px;/]],
  "taskboard#'width'#1": [['momentum fill width in %', /bp-momentum__fill" style="width:[\d.]+%"/]],
  "taskboard#'padding-left'#1": [['task row padding-left in px', /bp-trow[^"]*" style="padding-left:\d+px"/]],
};

/** React's source files as [file, text]; each path the walk refuses is red, named with the walk's reason. */
const sources = () => {
  const { files, refused } = reactSources();
  assert.deepEqual(refused, [], refused.join('\n'));
  return files.map((f) => [f, fs.readFileSync(f, 'utf8')]);
};

/** The plain search: each `styleOf(` in the sources, as { id, at }; a call whose first argument it cannot read has id null. */
function sitesIn(sources) {
  const sites = [];
  const nth = {};
  for (const [file, text] of sources) {
    text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/\bstyleOf\(([^,)]*)/g)) {
        const arg = m[1].trim();
        const key = `${path.basename(file).replace(/\.tsx?$/, '')}#${arg}`;
        nth[key] = (nth[key] ?? 0) + 1;
        sites.push({ id: arg ? `${key}#${nth[key]}` : null, at: `${path.relative(root, file)}:${i + 1}` });
      }
    });
  }
  return sites;
}

/** What no guard covers: calls with no case, cases for no call, and cases no guard renders. */
function uncovered(sites, cases, guards) {
  const ids = new Set(sites.map((s) => s.id));
  return {
    unmapped: sites.filter((s) => !s.id || !Object.hasOwn(cases, s.id)).map((s) => `${s.at} ${s.id}`),
    gone: Object.keys(cases).filter((id) => !ids.has(id)),
    unguarded: Object.entries(cases).flatMap(([id, rows]) => rows.filter(([, re]) => !guards.some(([, html]) => re.test(html))).map(([name]) => `${id}: ${name}`)),
  };
}

/** The guards whose HTML the built React writes byte for byte, as [name, html]. */
function guards() {
  const blocks = { ...fieldBlocks, ...embedBlocks() };
  const dir = path.join(root, 'goldens/blocks');
  const blockGoldens = fs.readdirSync(dir).filter((f) => f.endsWith('.golden.json')).sort().map((f) => [`block ${f.replace('.golden.json', '')}`, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]);
  const limits = limitGoldens().filter(([name]) => !Object.hasOwn(NOT_YET, name)).map(([name, g]) => [`limit ${name}`, g]);
  const standIns = JSON.parse(fs.readFileSync(path.join(root, 'scripts/style-stand-ins.json'), 'utf8')).rows.map((r) => [`stand-in ${r.case}`, { input: r.block, expectedHtml: r.html }]);
  const all = [...blockGoldens, ...limits, ...standIns];
  const written = all.filter(([, g]) => renderPortableDocument([g.input], { blocks }) === g.expectedHtml);
  return { all: all.length, written: written.map(([name, g]) => [name, g.expectedHtml]) };
}

test('every styleOf call in React is rendered by a guard, in each way it writes', () => {
  const sites = sitesIn(sources());
  assert.ok(sites.length > 0, 'the plain search finds no styleOf call');
  const { all, written } = guards();
  assert.equal(written.length, all, 'guards React does not write byte for byte');
  assert.deepEqual(uncovered(sites, CASES, written), { unmapped: [], gone: [], unguarded: [] });
});

test('a new call, a call gone and a case with no guard are each red', () => {
  const sites = sitesIn(sources());
  const { written } = guards();
  const plant = [path.join(src, 'blocks', 'plant.ts'), "const a = styleOf('outline-width', n, { after: 'px' })\nconst b = styleOf(\n  'gap', n)"];
  assert.deepEqual(uncovered([...sites, ...sitesIn([plant])], CASES, written).unmapped, [`packages/react/src/blocks/plant.ts:1 plant#'outline-width'#1`, 'packages/react/src/blocks/plant.ts:2 null']);
  assert.deepEqual(uncovered(sites.filter((s) => s.id !== "sheet#'width'#1"), CASES, written).gone, ["sheet#'width'#1"]);
  const unguardable = { ...CASES, "sheet#'width'#1": [['sheet column width in em', /bp-sheet__th" style="width:\d+em;/]] };
  assert.deepEqual(uncovered(sites, unguardable, written).unguarded, ["sheet#'width'#1: sheet column width in em"]);
});
