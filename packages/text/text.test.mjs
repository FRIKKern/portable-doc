import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BLOCK_TYPES, toMarkdown, toPlainText } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const jsonIn = (dir) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.json')).sort().map((f) => `${dir}/${f}`);
const spec = read('spec/blocks.schema.json');
const asDoc = (input) => (Array.isArray(input) || Array.isArray(input?.blocks) ? input : [input]);

test('every block type and alias in the spec has its own text handler', () => {
  const specTypes = [...Object.keys(spec.definitions.blocks), ...Object.keys(spec.definitions.aliases)].sort();
  assert.deepEqual(specTypes.filter((t) => !BLOCK_TYPES.includes(t)), [], 'spec types with no handler');
  assert.deepEqual(BLOCK_TYPES.filter((t) => !specTypes.includes(t)), [], 'handlers for types the spec does not name');
  // An alias renders exactly as its type with the fields the spelling forces.
  for (const [alias, def] of Object.entries(spec.definitions.aliases)) {
    const target = def['x-alias-of'];
    const { input } = read(`goldens/blocks/${target}.golden.json`);
    const canonical = { ...input, ...def['x-set'] };
    for (const render of [toMarkdown, toPlainText]) {
      assert.equal(render([{ ...input, type: alias }]), render([canonical]), `${alias} renders as ${target}`);
    }
  }
});

const docs = [
  ...jsonIn('goldens/blocks'),
  ...jsonIn('goldens/limits'),
  ...jsonIn('fixtures/valid'),
  'goldens/nested-list-carriers.json',
].map((file) => {
  const json = read(file);
  return { file, doc: asDoc('input' in json ? json.input : json) };
});

test('every golden and valid doc renders to clean, non-empty, deterministic text', () => {
  assert.ok(docs.length >= 140, `only ${docs.length} docs`);
  for (const { file, doc } of docs) {
    for (const render of [toMarkdown, toPlainText]) {
      const out = render(doc);
      assert.equal(render(doc), out, `${file}: ${render.name} is not deterministic`);
      if ((Array.isArray(doc) ? doc : doc.blocks).length === 0) {
        assert.equal(out, '', `${file}: a doc with no blocks renders to ''`);
        continue;
      }
      assert.ok(out.trim() !== '', `${file}: ${render.name} is empty`);
      assert.ok(out.endsWith('\n') && !out.endsWith('\n\n'), `${file}: ${render.name} must end with one newline`);
      for (const bad of ['[object Object]', 'undefined', 'NaN', '{"']) {
        assert.ok(!out.includes(bad), `${file}: ${render.name} contains ${bad}:\n${out}`);
      }
    }
  }
});

const text = (value, marks) => ({ type: 'text', value, ...(marks ? { marks } : {}) });

test('headings, marks and links come out as Markdown and as plain text', () => {
  const doc = {
    blocks: [
      { type: 'heading', level: 2, text: 'The render path' },
      {
        type: 'paragraph',
        content: [
          text('Read '),
          text('this', [{ type: 'bold' }]),
          text(', '),
          text('that', [{ type: 'italic' }, { type: 'strike' }]),
          text(' and '),
          text('run()', [{ type: 'code' }]),
          text(' in '),
          { type: 'link', href: 'https://example.com/docs', children: [text('the docs')] },
          text('.'),
        ],
      },
    ],
  };
  assert.equal(toMarkdown(doc), '## The render path\n\nRead **this**, *~~that~~* and `run()` in [the docs](https://example.com/docs).\n');
  assert.equal(toPlainText(doc), 'The render path\n\nRead this, that and run() in the docs (https://example.com/docs).\n');
});

test('nested lists keep their numbering and indentation', () => {
  const doc = [
    {
      type: 'list',
      ordered: true,
      start: 3,
      items: [
        { text: 'Plan', children: [{ type: 'list', items: ['Draft', { content: [text('Review', [{ type: 'bold' }])] }] }] },
        'Ship',
      ],
    },
    { type: 'list', task: true, items: [{ text: 'Done', checked: true }, { text: 'Next' }] },
  ];
  assert.equal(toMarkdown(doc), '3. Plan\n   - Draft\n   - **Review**\n4. Ship\n\n- [x] Done\n- [ ] Next\n');
  assert.equal(toPlainText(doc), '3. Plan\n   - Draft\n   - Review\n4. Ship\n\n- [x] Done\n- [ ] Next\n');
});

test('a table becomes a GFM table, with a pipe in a cell escaped', () => {
  const doc = [{ type: 'table', head: [[text('Key')], [text('Value')]], rows: [[[text('a|b')], [text('1')]], [[text('long key')], [text('22')]]] }];
  assert.equal(toMarkdown(doc), '| Key | Value |\n| --- | --- |\n| a\\|b | 1 |\n| long key | 22 |\n');
  assert.equal(toPlainText(doc), 'Key       Value\n--------  -----\na|b       1\nlong key  22\n');
});

test('a code block is fenced with its language, longer than any fence inside it', () => {
  const doc = [{ type: 'code', lang: 'md', value: 'Use ```js fences```\n  indented' }];
  assert.equal(toMarkdown(doc), '````md\nUse ```js fences```\n  indented\n````\n');
  assert.equal(toPlainText(doc), 'Use ```js fences```\n  indented\n');
});

test('Markdown-special characters in prose are escaped; plain text keeps them', () => {
  const doc = [{ type: 'paragraph', text: '# not a heading\n*stars* and _under_ [brackets]\n1. not a list' }];
  assert.equal(toMarkdown(doc), '\\# not a heading\\\n\\*stars\\* and \\_under\\_ \\[brackets\\]\\\n1\\. not a list\n');
  assert.equal(toPlainText(doc), '# not a heading\n*stars* and _under_ [brackets]\n1. not a list\n');
});

test('a link with a disallowed scheme renders as its text only', () => {
  const doc = [{ type: 'paragraph', content: [text('click', [{ type: 'link', href: 'javascript:alert(1)' }]), text(' or '), { type: 'link', href: ' data:text/html,x', children: [text('here')] }] }];
  assert.equal(toMarkdown(doc), 'click or here\n');
  assert.equal(toPlainText(doc), 'click or here\n');
  assert.equal(toMarkdown([{ type: 'image', src: 'javascript:x', alt: 'Cover' }]), 'Cover\n');
});

test('an embed shows the document it names when one is given, else its target', () => {
  const doc = [{ type: 'embed', target: 'Field notes' }];
  assert.equal(toMarkdown(doc), '↪ Field notes\n');
  assert.equal(toMarkdown(doc, { embeds: { 'Field notes': [{ type: 'heading', level: 3, text: 'Notes' }] } }), '### Notes\n');
});

test('unknown block types never throw and show only their text', () => {
  const doc = [{ type: 'mystery', text: 'Kept text' }, { type: 'mystery', data: { a: 1 } }, null, 42];
  assert.equal(toMarkdown(doc), 'Kept text\n');
  assert.equal(toPlainText({ blocks: [] }), '');
  assert.equal(toPlainText('nonsense'), '');
});
