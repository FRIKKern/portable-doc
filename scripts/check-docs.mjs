// Doc rules from QUALITY.md: README stays at or under 80 lines, and every relative
// link in a tracked Markdown file points at a file that exists. packages/editor is left out:
// it is Barkpark's text, copied by the sync, and its links are Barkpark's to keep.
// The README timeline block is written on main only, by the housekeeping job: a branch
// whose block differs from the one at its merge-base with origin/main fails. The job
// itself passes --timeline-from-job, which skips that one rule.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md', ':(exclude)packages/editor/'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const errors = [];

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const readmeLines = readme.trimEnd().split('\n').length;
if (readmeLines > 80) errors.push(`README.md: ${readmeLines} lines, cap is 80`);
if (!process.argv.includes('--timeline-from-job')) {
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
