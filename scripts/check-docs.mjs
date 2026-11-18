// Doc rules from QUALITY.md: README stays at or under 80 lines, counting the timeline block
// at its full budget (TIMELINE_MAX_LINES) whatever it holds today, and every relative
// link in a tracked Markdown file points at a file that exists. packages/editor is left out:
// it is Barkpark's text, copied by the sync, and its links are Barkpark's to keep.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIMELINE_MAX_LINES } from './lib/timeline.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md', ':(exclude)packages/editor/'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const errors = [];

const readmeText = fs.readFileSync(path.join(root, 'README.md'), 'utf8').trimEnd().split('\n');
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
