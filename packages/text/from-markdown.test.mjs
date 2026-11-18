import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '@portable-doc/validate';
import { fromMarkdown } from './index.js';

const t = (value) => ({ type: 'text', value });
const valid = (blocks) => {
  const r = validate({ blocks });
  assert.ok(r.ok, JSON.stringify(r.errors, null, 1));
};

test('fromMarkdown reads headings, inline marks, links, task lists, tables and mermaid fences, and the result validates', () => {
  const md = [
    '## Title',
    'plain **bold** *it* `code` [go](https://x.example)',
    '- [ ] todo\n- [x] done',
    '| Name | N |\n| ---- | - |\n| a    | 1 |',
    '```mermaid\ngraph TD\n  A-->B\n```',
  ].join('\n\n');
  const blocks = fromMarkdown(md);
  assert.deepEqual(blocks, [
    { type: 'heading', level: 2, text: 'Title' },
    {
      type: 'paragraph',
      content: [
        t('plain '),
        { type: 'strong', children: [t('bold')] },
        t(' '),
        { type: 'em', children: [t('it')] },
        t(' '),
        { type: 'code', value: 'code' },
        t(' '),
        { type: 'link', href: 'https://x.example', children: [t('go')] },
      ],
    },
    { type: 'list', ordered: false, task: true, items: [{ content: [t('todo')], checked: false }, { content: [t('done')], checked: true }] },
    { type: 'table', head: [[t('Name')], [t('N')]], rows: [[[t('a')], [t('1')]]] },
    { type: 'diagram', source: 'graph TD\n  A-->B' },
  ]);
  valid(blocks);
});
