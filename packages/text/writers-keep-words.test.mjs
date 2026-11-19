// Every writer keeps every word: each shared case in fixtures/ is imported, then written by
// readable Markdown, plain text, round-trip Markdown and the HTML of @portable-doc/react, and
// each word of the imported doc's text is in each output, or named in a `lost` entry.
// The import keeping the words of its Markdown is pinned by the import's own tests; this one
// pins that no writer drops what the import kept. The HTML writer is @portable-doc/react's
// built dist: the root test run builds it first.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { renderPortableDocument } from '@portable-doc/react';
import { validate } from '@portable-doc/validate';
import { CASES as HEADINGS } from '../../fixtures/headings/cases.mjs';
import { CASES as NESTING } from '../../fixtures/nesting/cases.mjs';
import { CUT, CUT_GENERATED, WORK, WORK_GENERATED } from '../../fixtures/text-work/cases.mjs';
import { KEEP_BYTES, sharedCases } from '../../scripts/write-shared-cases.mjs';
import { fromMarkdown, readMarkdown, toMarkdown, toPlainText } from './index.js';

const json = (dir) =>
  fs.readdirSync(new URL(`../../${dir}/`, import.meta.url)).filter((f) => f.endsWith('.json')).sort().map((f) => [`${dir}/${f}`, JSON.parse(fs.readFileSync(new URL(`../../${dir}/${f}`, import.meta.url), 'utf8'))]);
const writerCases = json('fixtures/writers');

const wordsIn = (s) => s.match(/\p{L}[\p{L}\p{N}]*/gu) ?? [];

const READABLE = ['readable Markdown', 'plain text', 'HTML'];
const PLAIN_STRING = 'the schema types it as a plain string, so the test cannot tell its kind';
// The fields a writer may write short or not at all, each with the writers it excuses and why.
// This list only shrinks. Each row must excuse a word in this run, so a stale row turns the test red.
const LISTED = [
  ['xLabels', ['HTML'], "the chart's HTML draws only the first and last label; a later change gives the chart a text alternative carrying every label"],
  ['tone', READABLE, `a setting, written as its label; ${PLAIN_STRING}`],
  ['verdict', READABLE, `a setting, written as the colour of the digits; ${PLAIN_STRING}`],
  ['lang', READABLE, `a setting, written only as a fence's first word; ${PLAIN_STRING}`],
  ['kind', READABLE, `a setting, written as the chart's shape; ${PLAIN_STRING}`],
  ['align', READABLE, `a setting; ${PLAIN_STRING}`],
  ['mode', READABLE, `a setting; ${PLAIN_STRING}`],
  ['role', READABLE, `a setting; ${PLAIN_STRING}`],
  ['id', READABLE, `a block's name; ${PLAIN_STRING}`],
  ['source', READABLE, `a reference, written as an address or a short commit; ${PLAIN_STRING}`],
  ['sourceDefault', READABLE, `a reference, written only when it is an address; ${PLAIN_STRING}`],
  ['href', ['HTML'], 'an address, written in an attribute; the schema does not specify inline fields'],
  ['src', ['HTML'], `an address, written in an attribute; ${PLAIN_STRING}`],
  ['posterAt', READABLE, 'a setting, the frame a player shows before it plays; the schema does not name it'],
  ['style', READABLE, 'a field the schema does not name: blocks are open, and writers read only what it names'],
];

// What the schema can tell. Every node's `type` names it: the enum of block types, and the
// field an inline node must have. A field the schema gives as a const or an enum is a name too:
// a writer shows it as a label, and this test has no label check yet, so a new one stops the
// test until it gets one.
const schema = JSON.parse(fs.readFileSync(new URL('../../spec/blocks.schema.json', import.meta.url), 'utf8'));
const blockDef = (type) => schema.definitions.blocks[type] ?? schema.definitions.aliases[type];
function enumOf(owner, key) {
  const prop = blockDef(owner?.type)?.properties?.[key];
  const values = prop && (prop.const !== undefined ? [prop.const] : prop.enum ?? prop.anyOf?.find((a) => a.enum)?.enum);
  return values ? values.map(String) : null;
}

/** The words of a doc's text: [word, field, path] for each word of each string field. */
function textWords(blocks) {
  const out = [];
  const visit = (x, key, path, owner) => {
    if (typeof x === 'string') {
      if (key === 'type') return;
      const values = enumOf(owner, key);
      if (values && values.some((v) => wordsIn(v).length)) throw new Error(`${path}: the enum field ${key} has no label check`);
      if (!values) for (const w of wordsIn(x)) out.push([w, key, path]);
    } else if (Array.isArray(x)) x.forEach((y, i) => visit(y, key, `${path}/${i}`, owner));
    else if (x && typeof x === 'object') for (const k of Object.keys(x)) visit(x[k], k, `${path}/${k}`, x);
  };
  visit(blocks, '', '/blocks', null);
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
/** The HTML's text content, and its images' alt text. */
const htmlText = (html) =>
  html
    .replace(/<[^>]*\balt="([^"]*)"[^>]*>/g, ' $1 ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ENTITIES[e]);

/** Each writer: its name, and given the blocks, the words it wrote and the paths it lists as lost. */
const WRITERS = [
  ['readable Markdown', (blocks) => ({ words: new Set(wordsIn(toMarkdown(blocks))) })],
  ['plain text', (blocks) => ({ words: new Set(wordsIn(toPlainText(blocks))) })],
  [
    'round-trip Markdown',
    (blocks) => {
      const { markdown, lost } = toMarkdown(blocks, { mode: 'round-trip' });
      // A portabledoc fence holds its blocks as JSON: what it writes is what reads back.
      return { words: new Set([...wordsIn(markdown), ...textWords(fromMarkdown(markdown)).map(([w]) => w)]), lost: lost.map((l) => l.path) };
    },
  ],
  ['HTML', (blocks) => ({ words: new Set(wordsIn(htmlText(renderPortableDocument(blocks)))) })],
];

// Round-trip Markdown checks that each block reads back, which takes seconds on the few
// generated inputs over KEEP_BYTES (a 2 MB text of callouts 1000 deep); those run through
// the other three writers only.
const big = (blocks) => JSON.stringify(blocks).length > KEEP_BYTES;

/** Every shared case as [name, blocks, words it must keep]. */
function* cases() {
  for (const [name, markdown] of Object.entries({ ...NESTING, ...HEADINGS, ...WORK, ...WORK_GENERATED })) yield [name, readMarkdown(markdown).blocks];
  const cut = [...Object.entries(CUT), [CUT_GENERATED.name, [CUT_GENERATED.markdown, CUT_GENERATED.limits]]];
  for (const [name, [markdown, limits]] of cut) yield [name, readMarkdown(markdown, limits).blocks];
  for (const [name, { markdown }] of Object.entries(JSON.parse(sharedCases()[path.posix.join('round-trip', 'round-trip-cases.json')]))) yield [name, fromMarkdown(markdown)];
  for (const [name, doc] of json('fixtures/valid')) yield [name, Array.isArray(doc) ? doc : doc.blocks];
  for (const [name, { blocks }] of writerCases) yield [name, blocks];
  // An alias case's block holds a field under two names; a writer reads the one `reads` names.
  // A block that does not validate pins only the alias reader: writers owe a valid doc's words.
  for (const [name, { block, reads }] of json('fixtures/aliases').filter(([, c]) => validate({ blocks: [c.block] }).ok)) {
    yield [name, [block], Object.entries(reads).flatMap(([key, v]) => (typeof v === 'string' ? wordsIn(v).map((w) => [w, key, `/blocks/0/${key}`]) : []))];
  }
}

test('every writer keeps every word of every shared case, or lists where it lost it', () => {
  const excused = new Set();
  const drops = [];
  let seen = 0;
  let bigSeen = 0;
  for (const [name, blocks, words = textWords(blocks)] of cases()) {
    seen++;
    for (const [writer, write] of WRITERS) {
      if (writer === 'round-trip Markdown' && big(blocks)) {
        bigSeen++;
        continue;
      }
      const { words: written, lost = [] } = write(blocks);
      const missing = words.filter(([w, key, path]) => {
        if (written.has(w) || lost.some((l) => path === l || path.startsWith(`${l}/`))) return false;
        const row = LISTED.find(([field, writers]) => field === key && writers.includes(writer));
        if (row) excused.add(`${row[0]} ${writer}`);
        return !row;
      });
      if (missing.length) drops.push(`${writer} drops ${missing.map(([w, , path]) => `${w} at ${path}`).join(', ')} of ${name}`);
    }
  }
  assert.deepEqual(drops, []);
  assert.ok(seen > 390, `${seen} cases`);
  assert.ok(bigSeen > 0, 'no case is big enough to skip round-trip Markdown: drop that rule');
  const stale = LISTED.flatMap(([field, writers]) => writers.map((w) => `${field} ${w}`)).filter((r) => !excused.has(r));
  assert.deepEqual(stale, [], 'listed rows no case needs');
});

test('each case in fixtures/writers/ is written byte for byte as pinned, by readable Markdown, plain text and HTML', () => {
  assert.ok(writerCases.length >= 3, 'the pinned cases are gone');
  for (const [name, { blocks, markdown, text, html }] of writerCases) {
    assert.equal(toMarkdown(blocks), markdown, `${name}: readable Markdown`);
    assert.equal(toPlainText(blocks), text, `${name}: plain text`);
    assert.equal(renderPortableDocument(blocks), html, `${name}: HTML`);
  }
});
