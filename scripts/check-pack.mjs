import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readReports } from './lib/conformance.mjs';
import { BARKPARK_PACK, checkPack, checkSource, diff, hashes, stampId } from './lib/pack.mjs';

const { values } = parseArgs({ options: { against: { type: 'string' } } });
const root = fileURLToPath(new URL('..', import.meta.url));
const conformance = readReports(root);
const errors = [...checkPack(root), ...conformance.errors, ...checkSource(root)];

if (values.against) {
  const d = diff(hashes(root), hashes(path.join(values.against, BARKPARK_PACK)));
  for (const kind of ['added', 'changed', 'removed']) for (const f of d[kind]) errors.push(`${f}: stale, ${kind} in Barkpark`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`pack ok: stamp ${stampId(root)}, ${Object.keys(hashes(root)).length} files, ${conformance.reports.length} conformance reports${values.against ? ', same as Barkpark' : ''}`);
