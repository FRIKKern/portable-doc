import fs from 'node:fs';
import path from 'node:path';
import { listFiles, sha256 } from './pack.mjs';

export const RENDERERS = [{ renderer: 'ref', compare: 'dom', reference: true }, { renderer: 'text-b', compare: 'text' }];

export function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export function stamp(packRoot) {
  const goldens = path.join(packRoot, 'goldens');
  const files = Object.fromEntries(listFiles(goldens).filter((f) => f !== 'stamp.json').map((f) => [f, sha256(path.join(goldens, f))]));
  write(path.join(goldens, 'stamp.json'), `${JSON.stringify({ render_version: 'synthetic', files }, null, 2)}\n`);
}

export function report(packRoot, { renderer, compare, reference }, types, status) {
  const rows = types.map((type) => ({ type, ...status(renderer, type) }));
  const value = { renderer, compare, ...(reference && { reference }), pack_stamp: sha256(path.join(packRoot, 'goldens', 'stamp.json')), ran_at_sha: 'b'.repeat(40), rows };
  write(path.join(packRoot, 'conformance', `${renderer}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

export function pack(packRoot, { blocks = 80, types = Array.from({ length: blocks }, (_, i) => `b${i}`), tag = 'a', specTag = tag, locale = true, spec, renderers = RENDERERS, status = () => ({ status: 'pass' }) } = {}) {
  write(path.join(packRoot, 'spec', 'blocks.schema.json'), spec ? `${JSON.stringify(spec)}\n` : `{"title":"synthetic ${specTag}"}\n`);
  for (const type of types) write(path.join(packRoot, 'goldens', 'blocks', `${type}.golden.json`), `{"type":"${type}","tag":"${tag}"}\n`);
  if (locale) write(path.join(packRoot, 'goldens', 'locales', 'nb.golden.json'), `{"tag":"${tag}"}\n`);
  stamp(packRoot);
  for (const r of renderers) report(packRoot, r, types, status);
  return packRoot;
}
