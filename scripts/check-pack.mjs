import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BARKPARK_PACK, checkPack, checkSource, diff, hashes, stampId } from './lib/pack.mjs';

const { values } = parseArgs({ options: { against: { type: 'string' }, root: { type: 'string' } } });
const root = values.root ?? fileURLToPath(new URL('..', import.meta.url));
const errors = [...checkPack(root), ...checkSource(root)];

if (values.against) {
  const d = diff(hashes(root), hashes(path.join(values.against, BARKPARK_PACK)));
  for (const kind of ['added', 'changed', 'removed']) for (const f of d[kind]) errors.push(`${f}: stale, ${kind} in Barkpark`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`pack ok: stamp ${stampId(root)}, ${Object.keys(hashes(root)).length} files${values.against ? ', same as Barkpark' : ''}`);
