// Doc rules from QUALITY.md: README stays at or under 80 lines, and every relative
// link in a tracked Markdown file points at a file that exists.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const errors = [];

const readmeLines = fs.readFileSync(path.join(root, 'README.md'), 'utf8').trimEnd().split('\n').length;
if (readmeLines > 80) errors.push(`README.md: ${readmeLines} lines, cap is 80`);

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
