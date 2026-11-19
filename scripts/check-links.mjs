// Committed symbolic links (git mode 120000, in the index) must be relative and stay inside
// the repo. A link to an absolute path, or one whose ../ climbs out of the repo, points at
// one machine's files: on any other checkout it is broken, or reads what it should not.
// Outside a git checkout this check has nothing to read, and says so.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Why a link at `file` (repo-relative, "/" separated) to `target` is refused, or null. */
export function refusal(file, target) {
  if (path.posix.isAbsolute(target) || /^[A-Za-z]:|^\\/.test(target)) return 'its target is an absolute path';
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target.replaceAll('\\', '/')));
  if (resolved === '..' || resolved.startsWith('../')) return 'its target is outside the repo';
  return null;
}

const root = fileURLToPath(new URL('..', import.meta.url));
const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).stdout?.trim();
if (!top || top !== fs.realpathSync(root)) {
  console.log('check-links: not a git checkout of this repo, nothing to check');
} else {
  const errors = [];
  for (const entry of execFileSync('git', ['ls-files', '-s', '-z'], { cwd: root, encoding: 'utf8' }).split('\0')) {
    const [meta, file] = entry.split('\t');
    const [mode, blob] = meta.split(' ');
    if (mode !== '120000') continue;
    const target = execFileSync('git', ['cat-file', 'blob', blob], { cwd: root, encoding: 'utf8' });
    const why = refusal(file, target);
    if (why) errors.push(`${file}: a committed link to ${JSON.stringify(target)}; ${why}. Links must be relative and stay inside the repo.`);
  }
  for (const e of errors) console.error(`check-links: ${e}`);
  if (errors.length) process.exitCode = 1;
}
