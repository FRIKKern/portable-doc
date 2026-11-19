// Every writer keeps every word: each shared case in fixtures/ is imported, then written by every
// writer in the registry (scripts/lib/writers.mjs), and each word of the imported doc's text is in
// each output, or named in a `lost` entry. The import keeping the words of its Markdown is pinned by
// the import's own tests; this one pins that no writer drops what the import kept. The HTML writers
// are @portable-doc/react's built dist: the root test run builds it first. The synced editor's
// writers lose words today; each kind of loss is counted against its row in
// scripts/lib/editor-losses.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { renderPortableDocument } from '@portable-doc/react';
import { validate } from '@portable-doc/validate';
import { EDITOR_LOSSES, lossKind } from '../../scripts/lib/editor-losses.mjs';
import { WRITERS } from '../../scripts/lib/writers.mjs';
import { KEEP_BYTES, sharedCases } from '../../scripts/write-shared-cases.mjs';
import { fromMarkdown, readMarkdown, toMarkdown, toPlainText } from './index.js';

const FIXTURES = new URL('../../fixtures/', import.meta.url);
const json = (dir) =>
  fs.readdirSync(new URL(`${dir}/`, FIXTURES)).filter((f) => f.endsWith('.json')).sort().map((f) => [`fixtures/${dir}/${f}`, JSON.parse(fs.readFileSync(new URL(`${dir}/${f}`, FIXTURES), 'utf8'))]);
const writerCases = json('writers');

const wordsIn = (s) => s.match(/\p{L}[\p{L}\p{N}]*/gu) ?? [];

const HTML = ['HTML', 'HTML with field and embed blocks'];
const READABLE = ['readable Markdown', 'plain text', ...HTML, 'editor export'];
const PLAIN_STRING = 'the schema types it as a plain string, so the test cannot tell its kind';
// The fields a writer may write short or not at all, each with the writers it excuses and why.
// This list only shrinks. Each row must excuse a word in this run, so a stale row turns the test red.
const LISTED = [
  ['xLabels', HTML, "the chart's HTML draws only the first and last label; a later change gives the chart a text alternative carrying every label"],
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
  ['href', HTML, 'an address, written in an attribute; the schema does not specify inline fields'],
  ['src', HTML, `an address, written in an attribute; ${PLAIN_STRING}`],
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

/** Every `id` string anywhere in `x`. */
function idsIn(x, out = new Set()) {
  if (Array.isArray(x)) for (const y of x) idsIn(y, out);
  else if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      if (k === 'id' && typeof v === 'string') out.add(v);
      idsIn(v, out);
    }
  }
  return out;
}

/** `x` without each `id` that is not in `carried`. */
const withoutIdsBut = (x, carried) =>
  Array.isArray(x)
    ? x.map((y) => withoutIdsBut(y, carried))
    : x && typeof x === 'object'
      ? Object.fromEntries(Object.entries(x).filter(([k, v]) => !(k === 'id' && typeof v === 'string' && !carried.has(v))).map(([k, v]) => [k, withoutIdsBut(v, carried)]))
      : x;

/**
 * A writer's words: those of its output (an HTML writer's text content), and of the blocks its
 * output reads back as. A reader mints an id for a block the Markdown carries none for, at random
 * (the editor's markdownToBlocks does), so a read-back id the input did not carry is left out: its
 * letters are no word the writer wrote, and would make the counts move from run to run.
 */
function writtenWords(writer, blocks) {
  const { output, lost = [], readBack } = writer.write(blocks);
  const words = new Set(wordsIn(writer.writes === 'html' ? htmlText(output) : output));
  if (readBack) for (const [w] of textWords(withoutIdsBut(readBack, idsIn(blocks)))) words.add(w);
  return { words, lost };
}

// Round-trip Markdown checks that each block reads back, which takes seconds on the few
// generated inputs over KEEP_BYTES (a 2 MB text of callouts 1000 deep); those skip the
// writers named here.
const big = (blocks) => JSON.stringify(blocks).length > KEEP_BYTES;
const SLOW = ['round-trip Markdown'];

// Each folder under fixtures/ and how its cases are read, as [name, blocks, words it must keep?].
// broken/ holds docs that fail validation: writers owe a valid doc's words. A folder with no
// reader here, or one that gives no case, fails the test.
const NOT_READ = { broken: 'docs that fail validation; writers owe only a valid doc its words' };
const markdownCases = async (folder) => Object.entries((await import(new URL(`${folder}/cases.mjs`, FIXTURES).href)).CASES).map(([name, markdown]) => [name, readMarkdown(markdown).blocks]);
const READERS = {
  nesting: () => markdownCases('nesting'),
  headings: () => markdownCases('headings'),
  'list-split': () => markdownCases('list-split'),
  'text-work': async () => {
    const { CUT, CUT_GENERATED, MARKED_PARAGRAPH, SPLIT_ITEMS, WORK, WORK_GENERATED, markedParagraph, splitItems } = await import(new URL('text-work/cases.mjs', FIXTURES).href);
    // The 120,000-item and the 70,000-mark cases are read here at 1,000, their shapes word-checked
    // through every writer; the import tests read them at 20,000 on a small stack.
    const generated = { ...WORK_GENERATED, [SPLIT_ITEMS]: splitItems(1_000), [MARKED_PARAGRAPH]: markedParagraph(1_000) };
    const cut = [...Object.entries(CUT), [CUT_GENERATED.name, [CUT_GENERATED.markdown, CUT_GENERATED.limits]]];
    return [
      ...Object.entries({ ...WORK, ...generated }).map(([name, markdown]) => [name, readMarkdown(markdown).blocks]),
      ...cut.map(([name, [markdown, limits]]) => [name, readMarkdown(markdown, limits).blocks]),
    ];
  },
  'round-trip': () => Object.entries(JSON.parse(sharedCases()[path.posix.join('round-trip', 'round-trip-cases.json')])).map(([name, { markdown }]) => [name, fromMarkdown(markdown)]),
  valid: () => json('valid').map(([name, doc]) => [name, Array.isArray(doc) ? doc : doc.blocks]),
  writers: () => writerCases.map(([name, { blocks }]) => [name, blocks]),
  // An alias case's block holds a field under two names; a writer reads the one `reads` names.
  // A block that does not validate pins only the alias reader: writers owe a valid doc's words.
  aliases: () =>
    json('aliases')
      .filter(([, c]) => validate({ blocks: [c.block] }).ok)
      .map(([name, { block, reads }]) => [name, [block], Object.entries(reads).flatMap(([key, v]) => (typeof v === 'string' ? wordsIn(v).map((w) => [w, key, `/blocks/0/${key}`]) : []))]),
};

/** Every shared case as [name, blocks, words it must keep?], read from each folder under fixtures/. */
async function cases() {
  const folders = fs.readdirSync(FIXTURES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const unread = folders.filter((f) => !(f in READERS) && !(f in NOT_READ));
  assert.deepEqual(unread, [], 'a folder under fixtures/ that the word test has no reader for');
  const all = [];
  for (const folder of folders.filter((f) => f in READERS)) {
    const got = await READERS[folder]();
    assert.ok(got.length > 0, `fixtures/${folder}: no case read`);
    all.push(...got);
  }
  return all;
}

test('every writer keeps every word of every shared case, or lists where it lost it', async () => {
  const excused = new Set();
  const drops = [];
  // Rows only shrink or go: a row at 0 measures nothing, so it is refused, as is a second row of one kind.
  assert.deepEqual(EDITOR_LOSSES.filter(([, , count]) => !(count > 0)).map(([writer, kind]) => `${writer}: ${kind}`), [], 'editor-losses.mjs: a row at 0; take it out');
  const counted = new Map(EDITOR_LOSSES.map(([writer, kind]) => [`${writer}: ${kind}`, 0]));
  assert.equal(counted.size, EDITOR_LOSSES.length, 'editor-losses.mjs: two rows of one writer and kind');
  let seen = 0;
  let bigSeen = 0;
  for (const [name, blocks, words = textWords(blocks)] of await cases()) {
    seen++;
    for (const writer of WRITERS) {
      if (big(blocks) && SLOW.includes(writer.name)) {
        bigSeen++;
        continue;
      }
      const { words: written, lost } = writtenWords(writer, blocks);
      const missing = words.filter(([w, key, path]) => {
        if (written.has(w) || lost.some((l) => path === l || path.startsWith(`${l}/`))) return false;
        const row = LISTED.find(([field, writers]) => field === key && writers.includes(writer.name));
        if (row) excused.add(`${row[0]} ${writer.name}`);
        return !row;
      });
      const uncounted = missing.filter(([, key, path]) => {
        const row = `${writer.name}: ${lossKind(writer.name, name, key, path, blocks)}`;
        if (!counted.has(row)) return true;
        counted.set(row, counted.get(row) + 1);
        return false;
      });
      if (uncounted.length) drops.push(`${writer.name} drops ${uncounted.map(([w, , path]) => `${w} at ${path}`).join(', ')} of ${name}`);
    }
  }
  if (process.env.WORDS_DUMP) fs.writeFileSync(process.env.WORDS_DUMP, drops.join('\n'));
  assert.deepEqual(drops, []);
  // Each listed loss is the exact count of words lost: a new loss and a fix both move it.
  assert.deepEqual(Object.fromEntries(counted), Object.fromEntries(EDITOR_LOSSES.map(([writer, kind, count]) => [`${writer}: ${kind}`, count])), 'editor-losses.mjs: a count moved; a fix brings its row down or out, a new loss is a bug');
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
