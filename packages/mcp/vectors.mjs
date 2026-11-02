import fs from 'node:fs';
import { answer, elixirAnswers, portable, sourceCommit } from './test/elixir.mjs';

const [barkpark, out = new URL('./test/batch-vectors.json', import.meta.url)] = process.argv.slice(2);
if (!barkpark) {
  console.error('usage: node packages/mcp/vectors.mjs <barkpark checkout> [out.json]');
  process.exit(2);
}

const para = (id, value) => ({ id, type: 'paragraph', content: [{ type: 'text', value }] });
const section = (id, blocks) => ({ id, type: 'section', blocks });
const twoSections = () => ({ title: 'Vectors', blocks: [section('s-1', [para('p-a', 'Alpha.'), para('p-x', 'Moved.')]), section('s-2', [para('p-b', 'Beta.')])] });
const intoS2 = { op: 'replace-block', id: 's-2', block: section('s-2', [para('p-b', 'Beta.'), para('p-x', 'Moved.')]) };
const outOfS1 = { op: 'replace-block', id: 's-1', block: section('s-1', [para('p-a', 'Alpha.')]) };
const legacy = () => ({ title: 'Vectors', blocks: [para('p-d', 'Top.'), section('s-1', [para('p-d', 'Nested.')])] });

const CASES = [
  { criterion: 1, name: 'a move whose id sits twice mid-batch applies', doc: twoSections(), ops: [intoS2, outOfS1] },
  {
    criterion: 2,
    name: 'a repeat the batch leaves is refused, naming the last op that added a copy',
    doc: twoSections(),
    ops: [{ op: 'insert-after', afterId: 'p-b', block: para('p-y', 'Y.') }, { op: 'remove-block', id: 'p-y' }, { op: 'patch-block', id: 's-1', patch: { blocks: [para('p-a', 'Alpha.'), para('p-x', 'Moved.'), para('p-y', 'Y2.')] } }, { op: 'replace-block', id: 's-2', block: section('s-2', [para('p-b', 'Beta.'), para('p-y', 'Y3.')]) }],
  },
  { criterion: 3, name: 'a legacy pair that grows is refused', doc: legacy(), ops: [{ op: 'replace-block', id: 's-1', block: section('s-1', [para('p-d', 'Nested.'), para('p-d', 'Third.')]) }] },
  { criterion: 4, name: 'an op naming an id the batch made repeated is refused, naming that op', doc: twoSections(), ops: [intoS2, { op: 'patch-block', id: 'p-x', patch: { tone: 'info' } }, outOfS1] },
  { criterion: 5, name: 'an op on a legacy repeat edits the first match', doc: legacy(), ops: [{ op: 'patch-block', id: 'p-d', patch: { content: [{ type: 'text', value: 'Top!' }] } }] },
  { criterion: 6, name: 'a leftover repeat plus a later bad op answers the later error', doc: twoSections(), ops: [intoS2, { op: 'patch-block', id: 'p-missing', patch: { tone: 'info' } }] },
  { criterion: 7, name: 'an incoming block that repeats an id inside itself is refused', doc: twoSections(), ops: [{ op: 'append-block', block: section('s-3', [para('p-n', 'One.'), para('p-n', 'Two.')]) }] },
  { criterion: null, name: 'append-block and insert-after still refuse an id already in the doc at that op, so a later bad op does not win', doc: twoSections(), ops: [{ op: 'append-block', block: para('p-a', 'Copy.') }, { op: 'patch-block', id: 'p-missing', patch: { tone: 'info' } }] },
  { criterion: null, name: 'insert-after refuses an id already in the doc at that op, even when a later op would remove the old copy', doc: twoSections(), ops: [{ op: 'insert-after', afterId: 'p-b', block: para('p-x', 'Copy.') }, outOfS1] },
];

const sources = portable(['patch.ex', 'field_number.ex']);
const answers = elixirAnswers({ barkpark, sources, runner: answer('Barkpark.PortableDoc.Patch.apply_patches(doc, ops)', 'ops'), cases: CASES.map(({ doc, ops }) => ({ doc, ops })) });
const cases = CASES.map((c, i) => ({ ...c, answer: answers[i] }));
fs.writeFileSync(out, JSON.stringify({ barkpark: sourceCommit(barkpark, sources), fold: 'Barkpark.PortableDoc.Patch.apply_patches(doc, ops)', cases }, null, 2) + '\n');
for (const c of cases) console.log(c.criterion, c.answer.ok ? 'ok' : `${c.answer.error.code} ${c.answer.error.target} ${c.answer.error.op}`);
