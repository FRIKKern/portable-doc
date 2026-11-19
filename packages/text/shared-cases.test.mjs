import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { FIXTURES, kept, sharedCases } from '../../scripts/write-shared-cases.mjs';
import { CASES as HEADINGS } from '../../fixtures/headings/cases.mjs';
import { CASES as NESTING } from '../../fixtures/nesting/cases.mjs';
import { CUT, CUT_GENERATED, FIRST, WORK, WORK_GENERATED } from '../../fixtures/text-work/cases.mjs';
import { plan } from '../../fixtures/text-work/rule-reader.mjs';
import { planText } from './import-work.js';
import { CASES as HOSTILE, seeded } from './import-work-cases.mjs';
import { readMarkdown } from './index.js';
import { readField } from './read-aliases.js';

// The shared cases in fixtures/ are for any reader or writer of Portable Doc to be tested against.
// Each is checked here against this package, so a case and the code cannot drift apart.

const FILES = sharedCases();
const json = (file) => JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8'));

test('each generated case file is kept in fixtures/ exactly as scripts/write-shared-cases.mjs writes it, or not kept when it is big; no other case file sits beside them', () => {
  for (const [file, text] of Object.entries(FILES)) {
    const at = path.join(FIXTURES, file);
    if (kept(text)) assert.equal(fs.existsSync(at) && fs.readFileSync(at, 'utf8'), text, `stale: run node scripts/write-shared-cases.mjs (${file})`);
    else assert.ok(!fs.existsSync(at), `${file} is over the size kept in the repository; the script writes it on request`);
  }
  for (const folder of ['nesting', 'headings', 'text-work', 'round-trip']) {
    const stray = fs.readdirSync(path.join(FIXTURES, folder)).filter((f) => f.endsWith('.json') && !(`${folder}/${f}` in FILES));
    assert.deepEqual(stray, [], `${folder}: a case file no input builds`);
  }
});

test('one name, one case: no two shared cases share a name, in any folder or across folders', () => {
  const names = [
    ...Object.keys(NESTING),
    ...Object.keys(HEADINGS),
    ...Object.keys(FIRST),
    ...Object.keys(HOSTILE),
    ...Object.keys(WORK_GENERATED),
    ...Object.keys(CUT),
    CUT_GENERATED.name,
    ...Object.keys(JSON.parse(FILES['round-trip/round-trip-cases.json'])),
    ...fs.readdirSync(path.join(FIXTURES, 'aliases')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)),
  ];
  assert.deepEqual(names.filter((name, i) => names.indexOf(name) !== i), []);
});

test('callouts nest to 50 deep: in the 52-deep case the 51st keeps the 52nd as text, with no notice', () => {
  const { markdown, blocks } = JSON.parse(FILES['nesting/callout-52-deep-past-cap.json']);
  assert.deepEqual(readMarkdown(markdown).notices, []);
  let at = blocks[0];
  let depth = 1;
  while (at.slots) {
    at = at.slots.body[0];
    depth++;
  }
  assert.deepEqual([depth, at.content], [51, [{ type: 'text', value: 'h50 [!info] h51' }]]);
});

test('the text-work rules, done from their words alone, give planText\'s work and notices on every shared case and a seeded sweep', () => {
  const docs = [];
  for (const markdown of Object.values(WORK)) for (const lineBytes of [null, 40, 7]) docs.push([markdown, { budget: 16_000_000, lineBytes }]);
  for (const [markdown, limits] of Object.values(CUT)) docs.push([markdown, limits]);
  const rnd = seeded(5);
  const pick = (a) => a[rnd(a.length)];
  const PREFIX = ['> ', '>', '- ', '1. ', '  ', '\t', '>\t', '-\t', ' ', '    '];
  const TAIL = ['```', '~~~', '````', '``` x', '```a`', 'text', '', 'x'.repeat(45), '~~~~ ', '   ```', '\t```'];
  for (let d = 0; d < 3000; d++) {
    const lines = Array.from({ length: 2 + rnd(12) }, () => Array.from({ length: rnd(4) }, () => pick(PREFIX)).join('') + pick(TAIL));
    docs.push([lines.join(pick(['\n', '\r\n', '\r'])), { budget: 50 + rnd(3000), lineBytes: pick([null, 40, 10]) }]);
  }
  const key = (notices) => JSON.stringify(notices.map(({ rule, line, lines }) => ({ rule, line, lines })).sort((a, b) => a.rule.localeCompare(b.rule)));
  const differ = docs.filter(([markdown, limits]) => {
    const words = plan(markdown, limits);
    const code = planText(markdown, { ...limits, notice: 'import_work_spent' });
    return words.work !== code.work || key(words.notices) !== key(code.notices);
  });
  assert.deepEqual(differ.slice(0, 3), [], `${differ.length} of ${docs.length} texts`);
});

test('each alias case reads as its file says: readField of each name gives the value, null for none', () => {
  const files = fs.readdirSync(path.join(FIXTURES, 'aliases')).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0);
  for (const file of files) {
    const { block, reads } = json(`aliases/${file}`);
    for (const [name, value] of Object.entries(reads)) assert.deepEqual(readField(block, name).value ?? null, value, `${file}: ${name}`);
  }
});

test('the fixtures README names, for each folder under fixtures/, the tests that read it, and each one does', () => {
  const rows = fs.readFileSync(path.join(FIXTURES, 'README.md'), 'utf8').match(/^\| `[^`]+\/` \|.*$/gm);
  const table = Object.fromEntries(rows.map((row) => [row.match(/^\| `([^`]+)\/`/)[1], row.split('|').at(-2).match(/`[^`]+\.test\.mjs`/g)?.map((f) => f.slice(1, -1)) ?? []]));
  const folders = fs.readdirSync(FIXTURES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.deepEqual(Object.keys(table).sort(), folders, 'a row for each folder, and no other');
  for (const [folder, tests] of Object.entries(table)) {
    assert.ok(tests.length, `${folder}: no test named`);
    for (const file of tests) {
      const at = path.join(FIXTURES, '..', file);
      assert.ok(fs.existsSync(at), `${file} does not exist`);
      const source = fs.readFileSync(at, 'utf8');
      assert.ok(source.includes(`fixtures/${folder}`) || source.includes(`'${folder}'`), `${file} does not read fixtures/${folder}`);
    }
  }
});
