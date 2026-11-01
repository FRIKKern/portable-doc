import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readReports } from './lib/conformance.mjs';
import { BARKPARK_PACK, BARKPARK_REPO, PACK_DIRS, checkPack, diff, hashes, stampId } from './lib/pack.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'pr-body': { type: 'string' } },
});
if (positionals.length !== 1) {
  console.error('usage: node scripts/sync-from-barkpark.mjs <barkpark checkout> [--pr-body <file>]');
  process.exit(2);
}

const barkpark = positionals[0];
const source = path.join(barkpark, BARKPARK_PACK);
const root = fileURLToPath(new URL('..', import.meta.url));
const sourceErrors = [...checkPack(source), ...readReports(source).errors];
if (sourceErrors.length) {
  console.error(`Barkpark's pack at ${source} is not valid, nothing copied:\n${sourceErrors.join('\n')}`);
  process.exit(1);
}

const commit = execFileSync('git', ['-C', barkpark, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const before = { stamp: stampId(root), files: hashes(root) };
for (const dir of PACK_DIRS) {
  fs.rmSync(path.join(root, dir), { recursive: true, force: true });
  fs.cpSync(path.join(source, dir), path.join(root, dir), { recursive: true });
}
const files = hashes(root);
fs.writeFileSync(path.join(root, 'SOURCE.json'), `${JSON.stringify({ repo: BARKPARK_REPO, commit, path: BARKPARK_PACK, files }, null, 2)}\n`);

const after = stampId(root);
const d = diff(before.files, files);
const title = `Sync from Barkpark ${commit.slice(0, 12)}: stamp ${before.stamp} → ${after}`;

if (values['pr-body']) {
  const list = (kind) => d[kind].map((f) => `- \`${f}\``).join('\n') || '- none';
  fs.writeFileSync(values['pr-body'], `| | |
|---|---|
| Barkpark commit | [\`${commit.slice(0, 12)}\`](https://github.com/FRIKKern/barkpark/commit/${commit}) |
| Old stamp | \`${before.stamp}\` |
| New stamp | \`${after}\` |
| Files | ${d.added.length} added, ${d.changed.length} changed, ${d.removed.length} removed |

Written by \`scripts/sync-from-barkpark.mjs\` from \`${BARKPARK_PACK}\`. Barkpark is the source (Z9): fix it there, never here.

### Added
${list('added')}

### Changed
${list('changed')}

### Removed
${list('removed')}
`);
}
console.log(title);
