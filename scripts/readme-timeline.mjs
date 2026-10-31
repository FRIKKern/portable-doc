// Rewrites the <!-- timeline:start/end --> block in README.md from what actually
// happened: commits on main and milestones closed on the board (scripts/lib/board.mjs).
// Empty periods are left out.
import { execFileSync } from 'node:child_process';
import { tasks, replaceBlock } from './lib/board.mjs';

const README = new URL('../README.md', import.meta.url);
const TZ = process.env.TIMELINE_TZ || 'Europe/Oslo';
const BOT = /github-actions|\[bot\]/;
// Items listed per period; older periods show counts only. Keeps README under its 80-line cap.
const SHOW = { Today: 1, Yesterday: 1, 'This week': 1, 'Last week': 0 };

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', cwd: new URL('..', import.meta.url) });
const repo = process.env.GITHUB_REPOSITORY
  || git('remote', 'get-url', 'origin').trim().replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '');

function day(d) {
  const [y, m, dd] = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(d).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd));
}
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);

function periods(now) {
  const today = day(now);
  const week = addDays(today, -((today.getUTCDay() + 6) % 7));
  const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  return [
    ['Today', today],
    ['Yesterday', addDays(today, -1)],
    ['This week', week],
    ['Last week', addDays(week, -7)],
    ['This month', month],
    ['Last month', new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1))],
  ];
}

function bucket(d, list) {
  const k = day(d);
  for (const [name, start] of list) if (k >= start) return name;
  return 'Earlier';
}

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

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function render(items, now = new Date()) {
  const list = periods(now);
  const groups = new Map();
  for (const it of items.sort((a, b) => b.at - a.at)) {
    const name = bucket(it.at, list);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(it);
  }
  const lines = [];
  for (const [name, its] of groups) {
    const changes = its.filter((i) => i.kind === 'change').length;
    const closed = its.length - changes;
    const counts = [changes && plural(changes, 'change'), closed && plural(closed, 'milestone') + ' closed'].filter(Boolean).join(', ');
    lines.push(`- **${name}** · ${counts}`);
    for (const it of its.slice(0, SHOW[name] ?? 0)) lines.push(`  - ${it.text}`);
  }
  return lines.map((l) => l + '\n').join('');
}

if (replaceBlock(README, 'timeline', render([...events(), ...(await closedTasks())]))) console.log('wrote README.md timeline');
