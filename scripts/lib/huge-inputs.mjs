// Documents with one list of n items, for each place a writer or renderer once spread such a list
// into a call. Each case gives the output for n items and what that output holds only when the whole
// document came through: its last item (or a part written after the list), and the paragraph after.
import { diffDocs } from '../../packages/cli/diff-core.js';
import { renderPortableDocument } from '@portable-doc/react';
import { toMarkdown, toPlainText } from '@portable-doc/text';

export const END = 'the paragraph after';
const end = { type: 'paragraph', content: [{ type: 'text', value: END }] };
const many = (n, item) => Array.from({ length: n }, (_, i) => item(i));
const lines = (n, p) => many(n, (i) => `${p}${i}`).join('\n');
const html = (block) => renderPortableDocument([block, end]);
const md = (block) => toMarkdown([block, end]);
// An encoded polyline of n + 1 points: the origin, then n steps of 0.00001 north and east.
const polyline = (n) => `??${'AA'.repeat(n)}`;

/** name → (n) => [output, the last item's mark in it]. */
export const CASES = {
  'text: a chat-tool-diff edit of n lines': (n) => [toPlainText([{ type: 'chat-tool-diff', input: { file_path: 'f', edits: [{ old_string: lines(n, 'o'), new_string: 'n' }] } }, end]), `o${n - 1}`],
  'text: tabs with n tabs': (n) => [md({ type: 'tabs', tabs: many(n, (i) => ({ label: `t${i}`, blocks: [] })) }), `t${n - 1}`],
  'text: code-tabs with n tabs': (n) => [md({ type: 'code-tabs', tabs: many(n, (i) => ({ label: `t${i}`, value: 'x' })) }), `t${n - 1}`],
  'text: a task-list in n phases': (n) => [md({ type: 'task-list', snapshot: many(n, (i) => ({ title: `x${i}`, status: 'open', phase: `p${i}` })) }), `p${n - 1}`],
  'react: a paragraph whose block wrapper holds n inline nodes': (n) => [html({ type: 'paragraph', content: [{ type: 'span', content: many(n, (i) => ({ type: 'text', value: `w${i} ` })) }] }), `w${n - 1}`],
  'react: a chat-tool-diff edit of n lines': (n) => [html({ type: 'chat-tool-diff', input: { file_path: 'f', edits: [{ old_string: lines(n, 'o'), new_string: 'n' }, { old_string: 'a', new_string: 'b' }] } }), `o${n - 1}`],
  'react: a toc of n items': (n) => [html({ type: 'toc', items: many(n, (i) => ({ text: `h${i}`, level: 2 })) }), `h${n - 1}`],
  'react: a stat with a spark of n values': (n) => [html({ type: 'stat', value: '1', label: 'l', spark: many(n, (i) => i % 13) }), 'bp-stat__spark'],
  'react: a chart series of n points': (n) => [html({ type: 'chart', kind: 'line', caption: 'cap', series: [{ label: 's', points: many(n, (i) => i % 97) }] }), 'cap'],
  'react: a heatmap row of n cells': (n) => [html({ type: 'heatmap', cells: [many(n, (i) => i % 7)], colLabels: many(n, (i) => `c${i}`) }), `c${n - 1}`],
  'react: a heatmap of n rows': (n) => [html({ type: 'heatmap', cells: many(n, (i) => [i % 7]), rowLabels: many(n, (i) => `r${i}`) }), `r${n - 1}`],
  'react: a calendar heatmap of n rows': (n) => [html({ type: 'heatmap', mode: 'calendar', cells: many(n, (i) => [i % 7]), rowLabels: many(n, (i) => `r${i}`) }), `r${n - 1}`],
  'react: a heatmap with marginals of n rows': (n) => [html({ type: 'heatmap', marginals: true, cells: many(n, (i) => [i % 7]), rowLabels: many(n, (i) => `r${i}`) }), `r${n - 1}`],
  'react: a gauge-list counting n statuses': (n) => [html({ type: 'gauge-list', mode: 'count', snapshot: many(n, (i) => ({ status: `s${i}` })) }), `s${n - 1}`],
  'react: a bar-chart of n bars': (n) => [html({ type: 'bar-chart', bars: many(n, (i) => ({ label: `b${i}`, value: i })) }), `b${n - 1}`],
  'react: a route of n points': (n) => [html({ type: 'route', polyline: polyline(n), caption: 'cap' }), 'cap'],
  'cli: a diff of n removed blocks': (n) => {
    const a = { blocks: many(n, (i) => ({ type: 'paragraph', content: [{ type: 'text', value: `w${i}` }] })) };
    const { summary, changes } = diffDocs(a, { blocks: [] });
    return [`${JSON.stringify(summary)} ${JSON.stringify(changes.at(-1))} ${END}`, `"removed":${n},`];
  },
};
