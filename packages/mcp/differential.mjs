import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyOp } from './ops/apply.js';
import { applyPatch } from './ops/patch.js';
import { digest } from './test/digest.mjs';
import { generator, intentGenerator } from './test/random-ops.mjs';

const intents = process.argv.includes('--intents');
const [barkpark, countArg = '20000', seedArg = '1', record] = process.argv.slice(2).filter((a) => a !== '--intents');
if (!barkpark) {
  console.error('usage: node packages/mcp/differential.mjs <barkpark checkout> [cases] [seed] [record.json] [--intents]');
  process.exit(2);
}

const answer = (call) => `
[path] = System.argv()
path
|> File.stream!()
|> Enum.each(fn line ->
  %{"doc" => doc, "op" => op} = JSON.decode!(line)
  result =
    try do
      case ${call} do
        {:ok, value} -> %{"ok" => true, "value" => value}
        {:error, {:invalid_op, o}} -> %{"ok" => false, "error" => %{"code" => "invalid_op", "op" => o}}
        {:error, {code, target, o}} -> %{"ok" => false, "error" => %{"code" => Atom.to_string(code), "target" => target, "op" => o}}
        {:error, {code, target}} -> %{"ok" => false, "error" => %{"code" => Atom.to_string(code), "target" => target}}
        {:error, code} when is_atom(code) -> %{"ok" => false, "error" => %{"code" => Atom.to_string(code)}}
      end
    rescue
      e -> %{"crash" => e.__struct__ |> inspect()}
    end
  IO.puts(JSON.encode!(result))
end)
`;

const PATCH = answer('Barkpark.PortableDoc.Patch.apply_patch(doc, op)');
const INTENT = answer(`(with {:ok, lowered} <- Barkpark.Content.Papers.BlockOps.lower_editor_op(doc["blocks"], op),
                      do: Barkpark.PortableDoc.Patch.apply_patch(doc, lowered))`);
const SOURCES = [
  ...['patch.ex', 'field_number.ex', ...(intents ? ['table_editing.ex', 'block_ids.ex'] : [])].map((f) => `api/lib/barkpark/portable_doc/${f}`),
  ...(intents ? ['api/lib/barkpark/content/papers/block_ops.ex'] : []),
];

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-differential-'));
try {
  const next = (intents ? intentGenerator : generator)(Number(seedArg));
  const cases = Array.from({ length: Number(countArg) }, next);
  const casesFile = path.join(work, 'cases.jsonl');
  fs.writeFileSync(casesFile, cases.map((c) => JSON.stringify(c)).join('\n') + '\n');
  fs.writeFileSync(path.join(work, 'runner.exs'), intents ? INTENT : PATCH);
  const out = intents ? runInApp(casesFile) : runStandalone(casesFile);
  const elixir = out.trim().split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  assert.equal(elixir.length, cases.length);

  const tally = new Map();
  const crashes = new Map();
  let mismatches = 0;
  cases.forEach((c, i) => {
    const theirs = elixir[i];
    const ours = (intents ? applyOp : applyPatch)(c.doc, c.op);
    const label = ours.ok ? 'ok' : ours.error.code;
    tally.set(label, (tally.get(label) ?? 0) + 1);
    if (theirs.crash) {
      crashes.set(`${theirs.crash} -> ${label}`, (crashes.get(`${theirs.crash} -> ${label}`) ?? 0) + 1);
      return;
    }
    try {
      assert.deepEqual(ours, theirs);
    } catch {
      if (mismatches++ < 5) console.log('MISMATCH', JSON.stringify(c), '\n  elixir', JSON.stringify(theirs), '\n  js    ', JSON.stringify(ours));
    }
  });

  const distinct = new Set(cases.map((c) => JSON.stringify(c))).size;
  console.log(`cases ${cases.length}, distinct ${distinct}, mismatches ${mismatches}`);
  console.log('outcomes', Object.fromEntries([...tally].sort()));
  console.log('elixir raised (skipped)', Object.fromEntries(crashes));
  if (record) {
    const commit = execFileSync('git', ['-C', barkpark, 'log', '-1', '--format=%h', '--', ...SOURCES], { encoding: 'utf8' }).trim();
    const answers = elixir.map((theirs) => (theirs.crash ? 'raised' : digest(theirs)));
    fs.writeFileSync(record, JSON.stringify({ barkpark: commit, seed: Number(seedArg), answers }) + '\n');
  }
  process.exitCode = mismatches ? 1 : 0;
} finally {
  fs.rmSync(work, { recursive: true });
}

function runStandalone(casesFile) {
  execFileSync('elixirc', ['--ignore-module-conflict', '-o', work, ...SOURCES.map((f) => path.join(barkpark, f))], { stdio: ['ignore', 'ignore', 'pipe'] });
  return execFileSync('elixir', ['-pa', work, path.join(work, 'runner.exs'), casesFile], { maxBuffer: 1 << 30, encoding: 'utf8' });
}

function runInApp(casesFile) {
  const env = { ...process.env, MIX_ENV: 'test' };
  return execFileSync('mix', ['run', '--no-start', path.join(work, 'runner.exs'), casesFile], { cwd: path.join(barkpark, 'api'), env, maxBuffer: 1 << 30, encoding: 'utf8' });
}
