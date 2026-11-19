// SPDX-License-Identifier: Apache-2.0
// The shared cases in fixtures/, built from their inputs with this checkout's @portable-doc/text.
// A generated file of at most KEEP_BYTES is kept in the repository; a bigger one is written only
// on request. The shared-cases test checks the kept files are what this writes.
//   node scripts/write-shared-cases.mjs          rewrite the kept files under fixtures/
//   node scripts/write-shared-cases.mjs <dir>    write every file, the big ones too, under <dir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { CASES as HEADINGS } from '../fixtures/headings/cases.mjs';
import { CASES as LIST_SPLIT } from '../fixtures/list-split/cases.mjs';
import { CASES as NESTING } from '../fixtures/nesting/cases.mjs';
import { CUT, CUT_GENERATED, WORK, WORK_GENERATED } from '../fixtures/text-work/cases.mjs';
import { depthsOf, linesOf } from '../fixtures/text-work/rule-reader.mjs';
import { CUT_RULES, RULES } from '../fixtures/text-work/rules.mjs';
import { allForms } from '../packages/text/block-forms.mjs';
import { planText } from '../packages/text/import-work.js';
import { fromMarkdown, readMarkdown, toMarkdown } from '../packages/text/index.js';

export const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
export const KEEP_BYTES = 64 * 1024;

const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;
// A rules object, then one case per line, so a deep case stays one line.
const caseFile = (rules, cases) =>
  `{\n "rules": ${JSON.stringify(rules, null, 2).replace(/\n/g, '\n ')},\n "cases": {\n${Object.entries(cases).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n }\n}\n`;

function workCases() {
  const cases = {};
  const count = (name, markdown) => {
    const depths = depthsOf(markdown);
    const lines = linesOf(markdown);
    let work = 0;
    let cut = null;
    depths.forEach((d, i) => {
      work += (d + 1) * (2 + Buffer.byteLength(lines[i]));
      if (cut === null && work > 16_000_000) cut = i;
    });
    if (work !== planText(markdown, { budget: Infinity, lineBytes: null }).work) throw new Error(`the rules and planText disagree on the work of ${name}`);
    return { depths, work, cut, lines: lines.length };
  };
  for (const [name, markdown] of Object.entries(WORK)) {
    const { depths, work, cut } = count(name, markdown);
    cases[name] = { markdown, depths, work, cut };
  }
  for (const [name, markdown] of Object.entries(WORK_GENERATED)) {
    const { work, cut, lines } = count(name, markdown);
    cases[name] = { generator: name, work, cut, lines, bytes: Buffer.byteLength(markdown) };
  }
  return caseFile(RULES, cases);
}

function cutCases() {
  const read = (markdown, limits) => {
    const { blocks, notices, work } = readMarkdown(markdown, { ...limits, notice: 'import_work_spent' });
    if (notices.some((n) => n.rule === 'net')) throw new Error('a cut case fired the net');
    return { blocks, notices, work };
  };
  const cases = {};
  for (const [name, [markdown, limits]] of Object.entries(CUT)) cases[name] = { markdown, limits, ...read(markdown, limits) };
  const g = CUT_GENERATED;
  const { blocks, notices, work } = read(g.markdown, g.limits);
  if (blocks.length !== 1 || blocks[0].content[0].value !== g.markdown.replace(/\s+/g, ' ').trim()) throw new Error('the generated cut case is no longer one plain paragraph');
  cases[g.name] = { generator: g.generator, blocks: [{ type: 'paragraph', content: [{ type: 'text', value: g.paragraph }] }], notices, work };
  return caseFile(CUT_RULES, cases);
}

// Every block form round-trip mode keeps in its own Markdown or a fence, as { markdown, blocks }.
function roundTripCases() {
  const slug = (s) => s.replace(/"([^"]*)"/g, '$1 str').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const cases = {};
  const put = (name, blocks) => {
    const { markdown, lost } = toMarkdown(blocks, { mode: 'round-trip' });
    if (lost.length) return;
    if (name in cases) throw new Error(`two forms share the name ${name}`);
    if (!isDeepStrictEqual(fromMarkdown(markdown), blocks)) throw new Error(`${name} does not read back`);
    cases[name] = { markdown, blocks };
  };
  for (const [name, block] of allForms()) put(`round-trip-${slug(name)}`, [block]);
  put('round-trip-emphasis-after-diagram', [{ type: 'diagram', source: 'graph TD; A-->B' }, { type: 'paragraph', content: [{ type: 'em', children: [{ type: 'text', value: 'Not a caption' }] }] }]);
  return pretty(cases);
}

/** Every generated shared-case file: { "<folder>/<file>": text }. */
export function sharedCases() {
  const files = {};
  for (const [folder, cases] of [['nesting', NESTING], ['headings', HEADINGS]]) {
    for (const [name, markdown] of Object.entries(cases)) files[`${folder}/${name}.json`] = pretty({ markdown, blocks: fromMarkdown(markdown) });
  }
  for (const [name, markdown] of Object.entries(LIST_SPLIT)) {
    const { blocks, notices } = readMarkdown(markdown);
    files[`list-split/${name}.json`] = pretty({ markdown, blocks, notices });
  }
  files['text-work/work-cases.json'] = workCases();
  files['text-work/cut-cases.json'] = cutCases();
  files['round-trip/round-trip-cases.json'] = roundTripCases();
  return files;
}

/** Whether a generated file is kept in the repository. */
export const kept = (text) => Buffer.byteLength(text) <= KEEP_BYTES;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ? path.resolve(process.argv[2]) : FIXTURES;
  for (const [file, text] of Object.entries(sharedCases())) {
    if (out === FIXTURES && !kept(text)) continue;
    fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
    fs.writeFileSync(path.join(out, file), text);
  }
  console.log(`shared cases written under ${out}`);
}
