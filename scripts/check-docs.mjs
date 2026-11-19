// Doc rules from QUALITY.md: README stays at or under 80 lines, and every relative
// link in a tracked Markdown file points at a file that exists. packages/editor is left out:
// it is Barkpark's text, copied by the sync, and its links are Barkpark's to keep.
// The README timeline block is written on main only, by the housekeeping job: a branch
// whose block differs from the one at its merge-base with origin/main fails. The job
// itself passes --timeline-from-job, which skips that one rule and is an error anywhere HEAD
// is not origin/main. README holds exactly one start and one end marker, start first.
// Outside a git checkout of this repo (a source download, or a copy inside some other repo)
// the Markdown files are found on disk, skipping what .gitignore names, and the timeline
// rule is skipped with a line that says so.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).stdout?.trim();
const checkout = Boolean(top) && top === fs.realpathSync(root);
const files = checkout
  ? execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md', ':(exclude)packages/editor/'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  : markdownOnDisk();
const errors = [];

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const readmeLines = readme.trimEnd().split('\n').length;
if (readmeLines > 80) errors.push(`README.md: ${readmeLines} lines, cap is 80`);
const START = '<!-- timeline:start -->';
const END = '<!-- timeline:end -->';
const count = (marker) => readme.split(marker).length - 1;
const oneBlock = count(START) === 1 && count(END) === 1 && readme.indexOf(START) < readme.indexOf(END);
if (!oneBlock) errors.push(`README.md: needs exactly one ${START} and one ${END}, start first; it has ${count(START)} and ${count(END)}`);
const fromJob = process.argv.includes('--timeline-from-job');
if (fromJob) {
  const why = jobError();
  if (why) errors.push(why);
}
if (!checkout) console.log('docs: not a git checkout of this repo, so the README timeline rule is skipped');
else if (!fromJob && oneBlock) {
  const why = timelineError(readme);
  if (why) errors.push(why);
}

for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const resolved = path.join(root, path.dirname(file), target.split('#')[0]);
    if (!fs.existsSync(resolved)) errors.push(`${file}: broken link ${target}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`docs ok: ${files.length} files, README ${readmeLines} lines`);

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// The job regenerates the block on main and checks right after, so only there may it skip the rule.
function jobError() {
  const why = 'README.md: --timeline-from-job is only for the housekeeping job, on main at origin/main; here ';
  if (!checkout) return `${why}this is not a git checkout of this repo`;
  const head = git('rev-parse', 'HEAD').trim();
  let main;
  try {
    main = git('rev-parse', '--verify', '--quiet', 'origin/main^{commit}').trim();
  } catch {
    return `${why}origin/main does not resolve`;
  }
  return head === main ? null : `${why}HEAD is ${head.slice(0, 12)} and origin/main is ${main.slice(0, 12)}`;
}

function timelineError(readme) {
  const block = (text) => /<!-- timeline:start -->[\s\S]*?<!-- timeline:end -->/.exec(text)?.[0] ?? null;
  const rule = 'the README timeline block is written on main only, by the housekeeping job';
  try {
    git('rev-parse', '--verify', '--quiet', 'origin/main^{commit}');
  } catch {
    return `README.md: cannot check the timeline block: origin/main does not resolve here (git fetch origin main); ${rule}`;
  }
  let base;
  try {
    base = git('merge-base', 'HEAD', 'origin/main').trim();
  } catch {
    return `README.md: cannot check the timeline block: HEAD and origin/main share no commit; ${rule}`;
  }
  let then = '';
  try {
    then = git('show', `${base}:README.md`);
  } catch {}
  if (block(readme) === block(then)) return null;
  return `README.md: the timeline block differs from origin/main at ${base.slice(0, 12)}; ${rule}, so put it back as it is there, or \`git fetch origin main\` if main has moved`;
}

// What the root .gitignore names, plus .git, node_modules and Barkpark's editor text; the walk never follows a
// symlinked directory. Plain names only, as git reads them: a bare name matches at any depth, a
// name with a slash only from the root. Globs and negations are left out.
function markdownOnDisk() {
  const gitignore = path.join(root, '.gitignore');
  const rules = (fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '').split('\n')
    .map((line) => line.trim().replace(/\/$/, '')).filter((line) => line && !/^[#!]/.test(line) && !/[*?[\]\\]/.test(line));
  const anywhere = new Set(['.git', 'node_modules', ...rules.filter((rule) => !rule.includes('/'))]);
  const fromRoot = new Set(['packages/editor', ...rules.filter((rule) => rule.includes('/')).map((rule) => rule.replace(/^\//, ''))]);
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const name = rel ? `${rel}/${e.name}` : e.name;
      if (anywhere.has(e.name) || fromRoot.has(name)) continue;
      if (e.isDirectory()) stack.push(name);
      else if (e.isFile() && name.endsWith('.md')) out.push(name);
    }
  }
  return out.sort();
}
