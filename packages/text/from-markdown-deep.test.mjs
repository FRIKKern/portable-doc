import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '@portable-doc/validate';
import { fromMarkdown } from './index.js';

const t = (value) => ({ type: 'text', value });
const words = (n, prefix = 'w') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

// The deepest item of a list chain, and how many lists down it is (the top list is depth 0).
function deepest(list) {
  let item = list.items[0];
  let depth = 0;
  while (item.children) {
    item = item.children[0].items[0];
    depth++;
  }
  return { depth, content: item.content ?? item };
}

// Every word of the Markdown is in the doc's text, and the doc validates.
function keepsEveryWord(md, label) {
  const blocks = fromMarkdown(md);
  assert.deepEqual(validate({ blocks }), { ok: true }, label);
  assert.notEqual(blocks[0]?.type, 'code', `${label}: fell back to a code block`);
  const text = new Set(JSON.stringify(blocks).match(/[a-z]+\d+/g));
  const lost = md.match(/[a-z]+\d+/g).filter((w) => !text.has(w));
  assert.deepEqual(lost, [], `${label}: words lost`);
  return blocks;
}

test('a list nested 60 levels deep keeps every word: lists to depth 50, then the deepest item holds the rest as text, one space apart', () => {
  const nested = (marker, indent) => words(60).map((w, i) => `${' '.repeat(indent * i)}${marker} ${w}`).join('\n');
  for (const [label, md] of [['bullets', nested('-', 2)], ['ordered', nested('1.', 3)], ['checklist', nested('- [ ]', 2)]]) {
    const { depth, content } = deepest(keepsEveryWord(md, label)[0]);
    assert.equal(depth, 50, label);
    assert.deepEqual(content, [t(label === 'checklist' ? 'w50 [ ] w51 [ ] w52 [ ] w53 [ ] w54 [ ] w55 [ ] w56 [ ] w57 [ ] w58 [ ] w59' : words(10).map((_, i) => `w${50 + i}`).join(' '))], label);
  }
  // The deepest item keeps its own marks; what is flattened into it is plain text.
  const marked = words(60).map((w, i) => `${'  '.repeat(i)}- **${w}** and *more*`).join('\n');
  const { content } = deepest(keepsEveryWord(marked, 'marked')[0]);
  assert.deepEqual(content.slice(0, 2), [{ type: 'strong', children: [t('w50')] }, t(' and ')]);
  assert.equal(content.at(-1).value, ' w51 and more w52 and more w53 and more w54 and more w55 and more w56 and more w57 and more w58 and more w59 and more');
  // `- - - x` nests a list per marker on one line.
  assert.deepEqual(deepest(keepsEveryWord(`${'- '.repeat(60)}end0`, 'one line')[0]), { depth: 50, content: [t('end0')] });
});

test('quotes nested deep, lists inside quotes and quotes inside lists keep every word, and the doc validates', () => {
  const quotes = words(150).map((w, i) => `${'>'.repeat(i + 1)} ${w}`).join('\n');
  assert.deepEqual(keepsEveryWord(quotes, 'quotes'), [{ type: 'blockquote', content: [t(words(150).join(' '))] }]);
  keepsEveryWord(words(150).map((w, i) => `${'> '.repeat(i + 1)}- ${w}`).join('\n'), 'lists in quotes');
  keepsEveryWord(words(80).map((w, i) => `${'  '.repeat(i)}- > ${w}`).join('\n'), 'quotes in lists');
  keepsEveryWord(words(80).map((w, i) => `${'  '.repeat(i)}- ${w}\n${'  '.repeat(i + 1)}> q${i}`).join('\n'), 'a quote under each item');
  keepsEveryWord(`${'> - 1. '.repeat(60)}end0`, 'mixed on one line');
  keepsEveryWord(`${'**'.repeat(80)}w0 w1${'**'.repeat(80)} ${'['.repeat(60)}w2${'](https://a.example)'.repeat(60)}`, 'inline marks and links');
  const table = `${'> '.repeat(120)}| a0 | b0 |\n${'> '.repeat(120)}| - | - |\n${'> '.repeat(120)}| c0 | d0 |`;
  keepsEveryWord(table, 'a table deep in quotes');
});

test('100,000 levels of nesting import in under 1.5 s of CPU, with every word kept and no deep stack', () => {
  for (const md of [`${'- '.repeat(100_000)}end0`, `${'>'.repeat(100_000)} end0`, `${'1. '.repeat(100_000)}end0`, `${'> - '.repeat(50_000)}end0`]) {
    const start = process.cpuUsage();
    const blocks = fromMarkdown(md);
    const used = process.cpuUsage(start);
    const ms = (used.user + used.system) / 1000;
    assert.ok(ms < 1500, `${md.slice(0, 6)}: ${Math.round(ms)} ms of CPU`);
    assert.deepEqual(validate({ blocks }), { ok: true });
    assert.notEqual(blocks[0].type, 'code', md.slice(0, 6));
    assert.ok(JSON.stringify(blocks).includes('end0'), md.slice(0, 6));
  }
});
