// Rewrites the <!-- timeline:start/end --> block in README.md from what actually
// happened: commits on main and milestones closed on the board (scripts/lib/board.mjs).
// Empty periods are left out.
import { execFileSync } from 'node:child_process';
import { tasks, replaceBlock } from './lib/board.mjs';
import { render } from './lib/timeline.mjs';

const README = new URL('../README.md', import.meta.url);
const BOT = /github-actions|\[bot\]/;

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', cwd: new URL('..', import.meta.url) });
const repo = process.env.GITHUB_REPOSITORY
  || git('remote', 'get-url', 'origin').trim().replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '');

function events() {
  const out = [];
  for (const line of git('log', '--first-parent', '--no-merges', '--format=%aI%x09%an%x09%s', 'HEAD').trim().split('\n')) {
    if (!line) continue;
    const [at, who, subject] = line.split('\t');
    if (BOT.test(who) || subject.includes('[skip ci]')) continue;
    const text = subject.replace(/\(#(\d+)\)$/, `([#$1](https://github.com/${repo}/pull/$1))`);
    out.push({ at: new Date(at), kind: 'change', text });
  }
  return out;
}

async function closedTasks() {
  return (await tasks())
    .filter((t) => t.id !== 'other' && (t.status === 'done' || t.status === 'cancelled') && t.closedAt)
    .map((t) => ({ at: new Date(t.closedAt), kind: 'task', text: `${t.status === 'done' ? 'Delivered' : 'Dropped'}: [${t.title}](${t.url})` }));
}

if (replaceBlock(README, 'timeline', render([...events(), ...(await closedTasks())]))) console.log('wrote README.md timeline');
