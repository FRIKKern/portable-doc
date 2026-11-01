import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyPatch } from './ops/patch.js';
import { generator } from './test/random-ops.mjs';

const [barkpark, countArg = '20000', seedArg = '1'] = process.argv.slice(2);
if (!barkpark) {
  console.error('usage: node packages/mcp/differential.mjs <barkpark checkout> [cases] [seed]');
  process.exit(2);
}

const RUNNER = `
[path] = System.argv()
path
|> File.stream!()
|> Enum.each(fn line ->
  %{"doc" => doc, "op" => op} = JSON.decode!(line)
  result =
    try do
      case Barkpark.PortableDoc.Patch.apply_patch(doc, op) do
        {:ok, value} -> %{"ok" => true, "value" => value}
        {:error, {:invalid_op, o}} -> %{"ok" => false, "error" => %{"code" => "invalid_op", "op" => o}}
        {:error, {code, target, o}} -> %{"ok" => false, "error" => %{"code" => Atom.to_string(code), "target" => target, "op" => o}}
      end
    rescue
      e -> %{"crash" => e.__struct__ |> inspect()}
    end
  IO.puts(JSON.encode!(result))
end)
`;

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-differential-'));
const source = path.join(barkpark, 'api/lib/barkpark/portable_doc');
execFileSync('elixirc', ['--ignore-module-conflict', '-o', work, path.join(source, 'patch.ex'), path.join(source, 'field_number.ex')], { stdio: ['ignore', 'ignore', 'pipe'] });
fs.writeFileSync(path.join(work, 'runner.exs'), RUNNER);

const next = generator(Number(seedArg));
const cases = Array.from({ length: Number(countArg) }, next);
fs.writeFileSync(path.join(work, 'cases.jsonl'), cases.map((c) => JSON.stringify(c)).join('\n') + '\n');
const out = execFileSync('elixir', ['-pa', work, path.join(work, 'runner.exs'), path.join(work, 'cases.jsonl')], { maxBuffer: 1 << 30, encoding: 'utf8' });
const elixir = out.trim().split('\n').map((line) => JSON.parse(line));

const tally = new Map();
const crashes = new Map();
let mismatches = 0;
cases.forEach((c, i) => {
  const theirs = elixir[i];
  const ours = applyPatch(c.doc, c.op);
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
fs.rmSync(work, { recursive: true });
process.exit(mismatches ? 1 : 0);
