// No committed symbolic links. Any index entry with git mode 120000 fails the check, named by
// its path: a link points at files that may exist on one machine only, or leads out of the
// repo. Should a link ever be needed, it gets a small allow-list file of exact paths with a
// reason each, and a listed link must still be relative, inside the repo and pass through no
// other link; that comes in its own change, when one is needed.
// Outside a git checkout there is nothing to read, and the check says so; run from a copy
// inside some other repo's checkout, it fails, as it cannot read this repo's index there.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The paths of the committed links in the index at `root`, read NUL-separated, so any name reads whole. */
export function committedLinks(root) {
  const links = [];
  for (const entry of execFileSync('git', ['ls-files', '-s', '-z'], { cwd: root, encoding: 'utf8' }).split('\0')) {
    // "<mode> <object> <stage>\t<path>": the path is everything after the first tab.
    const tab = entry.indexOf('\t');
    if (tab !== -1 && entry.startsWith('120000 ')) links.push(entry.slice(tab + 1));
  }
  return links;
}

function main() {
  const root = fs.realpathSync(fileURLToPath(new URL('..', import.meta.url)));
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
  if (top.status !== 0) {
    console.log('check-links: not a git checkout, no committed links to check');
    return 0;
  }
  if (fs.realpathSync(top.stdout.trim()) !== root) {
    console.error('check-links: this folder is not the top of its git checkout, so its index cannot be read; run the check in the repo itself');
    return 1;
  }
  const links = committedLinks(root);
  for (const file of links) console.error(`check-links: ${JSON.stringify(file)} is a committed symbolic link; the repo holds none.`);
  return links.length ? 1 : 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main();
