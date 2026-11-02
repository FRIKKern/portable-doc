import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const answer = (call, key = 'op') => `
[path] = System.argv()
path
|> File.stream!()
|> Enum.each(fn line ->
  %{"doc" => doc, "${key}" => ${key}} = JSON.decode!(line)
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

export const portable = (files) => files.map((f) => `api/lib/barkpark/portable_doc/${f}`);

export function elixirAnswers({ barkpark, sources, runner, inApp, cases }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-differential-'));
  try {
    const casesFile = path.join(work, 'cases.jsonl');
    fs.writeFileSync(casesFile, cases.map((c) => JSON.stringify(c)).join('\n') + '\n');
    fs.writeFileSync(path.join(work, 'runner.exs'), runner);
    const out = inApp ? runInApp(barkpark, work, casesFile) : runStandalone(barkpark, sources, work, casesFile);
    return out.trim().split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  } finally {
    fs.rmSync(work, { recursive: true });
  }
}

export const sourceCommit = (barkpark, sources) => execFileSync('git', ['-C', barkpark, 'log', '-1', '--format=%h', '--', ...sources], { encoding: 'utf8' }).trim();

function runStandalone(barkpark, sources, work, casesFile) {
  execFileSync('elixirc', ['--ignore-module-conflict', '-o', work, ...sources.map((f) => path.join(barkpark, f))], { stdio: ['ignore', 'ignore', 'pipe'] });
  return execFileSync('elixir', ['-pa', work, path.join(work, 'runner.exs'), casesFile], { maxBuffer: 1 << 30, encoding: 'utf8' });
}

function runInApp(barkpark, work, casesFile) {
  const env = { ...process.env, MIX_ENV: 'test' };
  return execFileSync('mix', ['run', '--no-start', path.join(work, 'runner.exs'), casesFile], { cwd: path.join(barkpark, 'api'), env, maxBuffer: 1 << 30, encoding: 'utf8' });
}
