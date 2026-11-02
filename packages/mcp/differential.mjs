import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyOp } from './ops/apply.js';
import { applyPatch, applyPatches } from './ops/patch.js';
import { digest } from './test/digest.mjs';
import { answer, elixirAnswers, portable, sourceCommit } from './test/elixir.mjs';
import { batchGenerator, generator, intentGenerator, normalizeGenerator, shapeAnswer } from './test/random-ops.mjs';

const flags = ['--intents', '--normalize', '--batch'];
const mode = flags.find((f) => process.argv.includes(f))?.slice(2) ?? 'patch';
const [barkpark, countArg = '20000', seedArg = '1', record] = process.argv.slice(2).filter((a) => !flags.includes(a));
if (!barkpark) {
  console.error('usage: node packages/mcp/differential.mjs <barkpark checkout> [cases] [seed] [record.json] [--intents | --normalize | --batch]');
  process.exit(2);
}

const NORMALIZE = `
[path] = System.argv()
alias Barkpark.Content.Papers.BlockOps
path
|> File.stream!()
|> Enum.each(fn line ->
  %{"blocks" => blocks} = JSON.decode!(line)
  norm = try do BlockOps.normalize_render_shapes(blocks) rescue _ -> "raised" end
  safe =
    try do
      case BlockOps.table_editor_target_ids(blocks) do
        {:ok, _ids} -> "ok"
        {:error, {code, target}} -> %{"code" => Atom.to_string(code), "target" => target}
        {:error, code} -> %{"code" => Atom.to_string(code)}
      end
    rescue
      _ -> "raised"
    end
  IO.puts(JSON.encode!(%{"norm" => norm, "safe" => safe}))
end)
`;

const MODES = {
  patch: { next: generator, runner: answer('Barkpark.PortableDoc.Patch.apply_patch(doc, op)'), ours: (c) => applyPatch(c.doc, c.op), sources: portable(['patch.ex', 'field_number.ex']) },
  batch: { next: batchGenerator, runner: answer('Barkpark.PortableDoc.Patch.apply_patches(doc, ops)', 'ops'), ours: (c) => applyPatches(c.doc, c.ops), sources: portable(['patch.ex', 'field_number.ex']) },
  intents: {
    next: intentGenerator,
    runner: answer(`(with {:ok, lowered} <- Barkpark.Content.Papers.BlockOps.lower_editor_op(doc["blocks"], op),
                      do: Barkpark.PortableDoc.Patch.apply_patch(doc, lowered))`),
    inApp: true,
    ours: (c) => applyOp(c.doc, c.op),
    sources: [...portable(['patch.ex', 'field_number.ex', 'table_editing.ex', 'block_ids.ex']), 'api/lib/barkpark/content/papers/block_ops.ex'],
  },
  normalize: { next: normalizeGenerator, runner: NORMALIZE, inApp: true, ours: shapeAnswer, sources: [...portable(['table_editing.ex', 'block_ids.ex']), 'api/lib/barkpark/content/papers/block_ops.ex'] },
};
const { next: generate, runner, inApp, ours: answerOf, sources } = MODES[mode];
const outcome = (ours) => (mode === 'normalize' ? `norm ${ours.norm === 'raised' ? 'raised' : 'ok'}, safe ${ours.safe.code ?? ours.safe}` : ours.ok ? 'ok' : ours.error.code);

const next = generate(Number(seedArg));
const cases = Array.from({ length: Number(countArg) }, next);
const elixir = elixirAnswers({ barkpark, sources, runner, inApp, cases });
assert.equal(elixir.length, cases.length);

const tally = new Map();
const crashes = new Map();
let mismatches = 0;
cases.forEach((c, i) => {
  const theirs = elixir[i];
  const ours = answerOf(c);
  const label = outcome(ours);
  tally.set(label, (tally.get(label) ?? 0) + 1);
  if (theirs.crash) {
    crashes.set(`${theirs.crash} -> ${label}`, (crashes.get(`${theirs.crash} -> ${label}`) ?? 0) + 1);
    return;
  }
  if (digest(ours) !== digest(theirs)) {
    if (mismatches++ < 5) console.log('MISMATCH', JSON.stringify(c), '\n  elixir', JSON.stringify(theirs), '\n  js    ', JSON.stringify(ours));
  }
});

const distinct = new Set(cases.map((c) => JSON.stringify(c))).size;
console.log(`cases ${cases.length}, distinct ${distinct}, mismatches ${mismatches}`);
console.log('outcomes', Object.fromEntries([...tally].sort()));
console.log('elixir raised (skipped)', Object.fromEntries(crashes));
if (record) {
  const answers = elixir.map((theirs) => (theirs.crash ? 'raised' : digest(theirs)));
  fs.writeFileSync(record, JSON.stringify({ barkpark: sourceCommit(barkpark, sources), seed: Number(seedArg), answers }) + '\n');
}
process.exitCode = mismatches ? 1 : 0;
