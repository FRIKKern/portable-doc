import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PACK_DIRS } from './lib/pack.mjs';

const BASE = 'main';
const BRANCH = 'sync/barkpark';

const MERGE_TRIES = 5;
const WAIT_MS = Number(process.env.SYNC_PR_WAIT_MS ?? 5000);

const { positionals, values } = parseArgs({ allowPositionals: true, options: { merge: { type: 'boolean', default: false } } });
if (positionals.length !== 2) {
  console.error('usage: node scripts/sync-pr.mjs [--merge] <title file> <body file>');
  process.exit(2);
}

const [titleFile, bodyFile] = positionals;
const root = fileURLToPath(new URL('..', import.meta.url));
const title = fs.readFileSync(titleFile, 'utf8').trim();
const run = (cmd, ...args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// By number and at the head we pushed, then asked again: gh exits 0 on a PR it found merged long ago, and
// exits 1 when only its cleanup failed. GitHub can also refuse while it is still working out mergeability.
function merge(number, head) {
  for (let attempt = 1; attempt <= MERGE_TRIES; attempt++) {
    spawnSync('gh', ['pr', 'merge', number, '--squash', '--delete-branch', '--match-head-commit', head], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
    if (run('gh', 'pr', 'view', number, '--json', 'state', '--jq', '.state') === 'MERGED') return console.log(`merged #${number} at ${head}`);
    if (attempt < MERGE_TRIES) sleep(attempt * WAIT_MS);
  }
  console.error(`sync-pr: #${number} is not merged after ${MERGE_TRIES} tries`);
  process.exit(1);
}

const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).stdout.trim();
if (top !== fs.realpathSync(root)) {
  console.error(`sync-pr: ${root} is not the top of a git repo (git says ${top || 'no repo'}); nothing done`);
  process.exit(1);
}
run('git', 'switch', '-q', '-C', BRANCH);
run('git', 'add', '-A', '--', ...PACK_DIRS, 'SOURCE.json');
run('git', 'commit', '-q', '-m', title);
// --head also matches a fork's branch of the same name, which anyone can open. That PR is not the sync PR.
const open = run('gh', 'pr', 'list', '--head', BRANCH, '--base', BASE, '--state', 'open', '--json', 'number,isCrossRepository', '--jq', '.[] | select(.isCrossRepository | not) | .number');
// Always push: what merges is then the commit made from the tree the check just ran on, not an older head.
run('git', 'push', '-q', '--force', 'origin', `HEAD:${BRANCH}`);
const url = open
  ? run('gh', 'pr', 'edit', open, '--title', title, '--body-file', bodyFile)
  : run('gh', 'pr', 'create', '--head', BRANCH, '--base', BASE, '--title', title, '--body-file', bodyFile);
console.log(`${open ? 'updated' : 'opened'} ${url}: ${title}`);
if (values.merge) merge(url.match(/\/pull\/(\d+)/)[1], run('git', 'rev-parse', 'HEAD'));
