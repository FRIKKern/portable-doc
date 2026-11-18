// Doc rules from QUALITY.md: README stays at or under 80 lines, counting the timeline block
// at its full budget (TIMELINE_MAX_LINES) whatever it holds today, and every relative
// link in a tracked Markdown file points at a file that exists. packages/editor is left out:
// it is Barkpark's text, copied by the sync, and its links are Barkpark's to keep.
// The README timeline block is written on main only, by the housekeeping job: a branch
// whose block differs from the one at its merge-base with origin/main fails. The job
// itself passes --timeline-from-job, which skips that one rule. Outside a git checkout of
// this repo (a source download, or a copy inside some other repo) the Markdown files are
// found on disk, and the timeline rule is skipped with a line that says so.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIMELINE_MAX_LINES } from './lib/timeline.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).stdout?.trim();
const checkout = Boolean(top) && top === fs.realpathSync(root);
const files = checkout
  ? execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md', ':(exclude)packages/editor/'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  : markdownOnDisk();
const errors = [];

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const readmeText = readme.trimEnd().split('\n');
const start = readmeText.indexOf('<!-- timeline:start -->');
const end = readmeText.indexOf('<!-- timeline:end -->', start + 1);
const inside = start >= 0 && end > start ? end - start - 1 : null;
const outside = readmeText.length - (inside ?? 0);
const readmeLines = inside === null ? outside : outside + Math.max(inside, TIMELINE_MAX_LINES);
if (readmeLines > 80) {
  errors.push(inside === null
    ? `README.md: ${readmeLines} lines, cap is 80`
    : `README.md: ${outside} lines outside the timeline block plus its ${Math.max(inside, TIMELINE_MAX_LINES)}-line budget is ${readmeLines}, cap is 80`);
}
if (!checkout) console.log('docs: not a git checkout of this repo, so the README timeline rule is skipped');
else if (!process.argv.includes('--timeline-from-job')) {
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

function timelineError(readme) {
  const block = (text) => /<!-- timeline:start -->[\s\S]*?<!-- timeline:end -->/.exec(text)?.[0] ?? null;
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
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
  return `README.md: the timeline block differs from origin/main at ${base.slice(0, 12)}; ${rule}, so put it back as it is there`;
}

// What .gitignore leaves out, plus Barkpark's editor text; the walk never follows a symlinked directory.
function markdownOnDisk() {
  const skip = new Set(['.git', 'node_modules', 'dist', '.barkpark', 'packages/editor']);
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const name = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && !skip.has(e.name) && !skip.has(name)) stack.push(name);
      else if (e.isFile() && name.endsWith('.md')) out.push(name);
    }
  }
  return out.sort();
}
