import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const BASE = 'main';
const BRANCH = 'sync/barkpark';

const { positionals } = parseArgs({ allowPositionals: true });
if (positionals.length !== 2) {
  console.error('usage: node scripts/sync-pr.mjs <title file> <body file>');
  process.exit(2);
}

const [titleFile, bodyFile] = positionals;
const root = fileURLToPath(new URL('..', import.meta.url));
const title = fs.readFileSync(titleFile, 'utf8').trim();
const run = (cmd, ...args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const succeeds = (cmd, ...args) => {
  try {
    run(cmd, ...args);
    return true;
  } catch {
    return false;
  }
};

run('git', 'switch', '-q', '-C', BRANCH);
run('git', 'add', '-A', '--', 'spec', 'goldens', 'SOURCE.json');
run('git', 'commit', '-q', '-m', title);
const open = run('gh', 'pr', 'list', '--head', BRANCH, '--base', BASE, '--state', 'open', '--json', 'number', '--jq', '.[].number');
if (open && succeeds('git', 'fetch', '-q', 'origin', BRANCH) && succeeds('git', 'diff', '--quiet', 'FETCH_HEAD', 'HEAD', '--', 'spec', 'goldens')) {
  console.log(`sync PR #${open} already carries this pack: nothing pushed`);
  process.exit(0);
}
run('git', 'push', '-q', '--force', 'origin', `HEAD:${BRANCH}`);
const url = open
  ? run('gh', 'pr', 'edit', open, '--title', title, '--body-file', bodyFile)
  : run('gh', 'pr', 'create', '--head', BRANCH, '--base', BASE, '--title', title, '--body-file', bodyFile);
console.log(`${open ? 'updated' : 'opened'} ${url}: ${title}`);
