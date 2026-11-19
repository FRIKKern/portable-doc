import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BLOCK_TYPES, fromMarkdown, toMarkdown, toPlainText } from './index.js';

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

test('a // a reader could link as a protocol-relative address is escaped; a // between words or in http:// is not', () => {
  // A reader that links bare URLs links //host after anything but a letter, a digit, _, : or /.
  const para = (value) => [{ type: 'paragraph', content: [{ type: 'text', value }] }];
  assert.equal(toMarkdown(para('see //evil.example/x')), 'see /\\/evil.example/x\n');
  assert.equal(toMarkdown(para('//a.example, (//b.example) and x.//c.example')), '/\\/a.example, (/\\/b.example) and x./\\/c.example\n');
  for (const text of ['a // b', 'http://example.com/a', 'abc//def.example', 'a ///x.example', 'see //']) assert.equal(toMarkdown(para(text)), `${text}\n`, text);
  // Import gives the same text back (it links a bare http:// URL, so that one is left out here).
  for (const text of ['see //evil.example/x', '(//b.example)', '//a.example', 'a // b']) assert.deepEqual(fromMarkdown(toMarkdown(para(text))), para(text), text);
});

test('a link with a disallowed scheme renders as its text only', () => {
  const doc = [{ type: 'paragraph', content: [text('click', [{ type: 'link', href: 'javascript:alert(1)' }]), text(' or '), { type: 'link', href: ' data:text/html,x', children: [text('here')] }] }];
  assert.equal(toMarkdown(doc), 'click or here\n');
  assert.equal(toPlainText(doc), 'click or here\n');
  assert.equal(toMarkdown([{ type: 'image', src: 'javascript:x', alt: 'Cover' }]), 'Cover\n');
});

test('an entity in a link or image URL stays literal, so /&#47;host never becomes //host', () => {
  const doc = [{ type: 'paragraph', content: [text('x', [{ type: 'link', href: '/&#47;evil.example/p?a=1&b=2' }])] }];
  assert.equal(toMarkdown(doc), '[x](/\\&#47;evil.example/p?a=1\\&b=2)\n');
  assert.equal(toMarkdown([{ type: 'image', src: '/&sol;evil.example/a.png', alt: 'a' }]), '![a](/\\&sol;evil.example/a.png)\n');
});

test('a link with no label shows its URL escaped like any text', () => {
  const doc = [{ type: 'action', label: '', href: 'https://a.example/[x](javascript:alert(1))<img>' }];
  assert.equal(toMarkdown(doc), '[https://a.example/\\[x\\](javascript:alert(1))\\<img>](https://a.example/[x]%28javascript:alert%281%29%29%3Cimg%3E)\n');
});

test('equation TeX sits in a math fence or code span, never as raw HTML or markup', () => {
  assert.equal(toMarkdown([{ type: 'equation', tex: '<script>x</script>\n\n# H', display: true }]), '```math\n<script>x</script>\n\n# H\n```\n');
  assert.equal(toMarkdown([{ type: 'equation', tex: 'a<img src=x>' }]), '$`a<img src=x>`$\n');
  assert.equal(toPlainText([{ type: 'equation', tex: 'E = mc^2' }]), 'E = mc^2\n');
});

test('a heading that is only # keeps its text, and prose cannot become a table', () => {
  assert.equal(toMarkdown([{ type: 'heading', level: 2, text: '#' }]), '## \\#\n');
  assert.equal(toMarkdown([{ type: 'paragraph', text: 'a | b\n--- | ---' }]), 'a | b\\\n\\--- | ---\n');
  assert.equal(toMarkdown([{ type: 'paragraph', text: 'a | b\n|:--|' }]), 'a | b\\\n\\|:--|\n');
});

test('embeds that cycle or double stay small; huge inputs still render; a code language is one token', () => {
  const self = { me: [{ type: 'paragraph', text: 'x' }, { type: 'embed', target: 'me' }] };
  assert.equal(toMarkdown([{ type: 'embed', target: 'me' }], { embeds: self }), 'x\n\n↪ me\n');
  const embeds = { t30: [{ type: 'paragraph', text: 'leaf' }] };
  for (let k = 0; k < 30; k++) embeds[`t${k}`] = [{ type: 'embed', target: `t${k + 1}` }, { type: 'embed', target: `t${k + 1}` }];
  assert.ok(toMarkdown([{ type: 'embed', target: 't0' }], { embeds }).length < 5000);
  assert.notEqual(toMarkdown([{ type: 'code', value: '`a '.repeat(200000) }]), '');
  assert.equal(toMarkdown([{ type: 'code', lang: 'js onerror=x', value: 'x' }]), '```js\nx\n```\n');
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
