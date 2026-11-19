// SPDX-License-Identifier: Apache-2.0
// validate and explain: the same check of each doc, printed as one line per
// error or with each error explained in full.

import { validate } from '@portable-doc/validate';
import { UsageError, errorLine, jsonText, load, moreLine } from './shared.js';
import { explainError, refusedWhen } from './words.js';

/** Check each file (stdin when none) and print the results. `command` is 'validate' or 'explain'. */
export async function check(command, files, opts, io) {
  const inputs = files.length ? files : ['-'];
  if (inputs.filter((f) => f === '-').length > 1) throw new UsageError('stdin can be read only once');
  if (!files.length && io.stdinIsTTY) throw new UsageError('give a file, or pipe a doc to stdin');
  const results = [];
  for (const file of inputs) {
    const input = await load(file, io);
    if (input.failure) {
      results.push({ file: input.name, ok: false, failure: input.failure });
      continue;
    }
    const result = validate(input.doc);
    const errors = result.ok ? [] : result.errors;
    results.push({ file: input.name, ok: result.ok, errors, more: result.more ?? 0, doc: input.doc });
  }
  const code = results.some((r) => r.failure) ? 2 : results.every((r) => r.ok) ? 0 : 1;
  if (opts.json) {
    const files = results.map(({ file, ok, failure, errors, more, doc }) => {
      if (failure) return { file, ok, error: failure };
      const list = command === 'explain' ? errors.map((e) => ({ ...e, explanation: explainError(e, doc, String).join(' '), refusedWhen: refusedWhen(e.code) })) : errors;
      return more ? { file, ok, errors: list, more } : { file, ok, errors: list };
    });
    io.stdout(jsonText({ ok: code === 0, files }));
    return code;
  }
  for (const r of results) {
    if (r.failure) io.stderr(`${r.file}: ${r.failure.message}\n`);
    else if (command === 'validate') io.stdout(r.ok ? `${r.file}: ok\n` : r.errors.map((e) => `${errorLine(r.file, e)}\n`).join('') + moreLine(r.file, r.more));
    else if (r.ok) io.stdout(`${r.file}: ok, nothing to explain\n`);
    else {
      const n = r.errors.length + r.more;
      const body = r.errors.map((e, i) => explainError(e, r.doc).map((l, j) => `${j ? '   ' : `${i + 1}. `}${l}`).join('\n')).join('\n\n');
      io.stdout(`${r.file}: ${n} ${n === 1 ? 'error' : 'errors'}\n\n${body}\n\n${moreLine(r.file, r.more)}`);
    }
  }
  return code;
}
