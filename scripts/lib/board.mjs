// Reads the board as the Barkpark GitHub bridge mirrors it: every milestone under the
// PortableDoc goal is a sub-issue of FRIKKern/barkpark#24888 (public, so CI needs no
// Barkpark token). See docs/decisions/0001-one-home.md.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

export const GOAL = { repo: 'FRIKKern/barkpark', issue: 24888, task: 'task-88d88a6e15e5a2eb' };

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim(); } catch { return ''; }
}

async function gh(path) {
  const t = token();
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: { accept: 'application/vnd.github+json', ...(t && { authorization: `Bearer ${t}` }) },
  });
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function subIssues(issue) {
  const rows = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`repos/${GOAL.repo}/issues/${issue}/sub_issues?per_page=100&page=${page}`);
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  for (const i of [...rows]) if (i.sub_issues_summary?.total) rows.push(...(await subIssues(i.number)));
  return rows;
}

// One row per task: { id: 'R0'…'R7' | 'other', title, status, closedAt, url }.
// status: done | cancelled | in_progress | open, from the bridge's status:* label.
export async function tasks() {
  return (await subIssues(GOAL.issue)).map((i) => {
    const label = i.labels.map((l) => l.name).find((n) => n.startsWith('status:'));
    let status = label ? label.slice(7) : 'open';
    if (i.state === 'closed') status = i.state_reason === 'not_planned' || status === 'cancelled' ? 'cancelled' : 'done';
    const id = i.title.match(/^(R\d)\b/)?.[1] ?? 'other';
    return { id, title: i.title, status, closedAt: i.closed_at, url: i.html_url };
  });
}

// Milestones from the table in docs/ROADMAP.md, its one home.
export function milestones(file = new URL('../../docs/ROADMAP.md', import.meta.url)) {
  return [...fs.readFileSync(file, 'utf8').matchAll(/^\| (R\d) \| ([^|]+)\| ([^|]+)\|/gm)]
    .map(([, id, name, reward]) => ({ id, name: name.trim(), reward: reward.trim().replace(/`/g, '') }));
}

// Replaces the text between <!-- name:start --> and <!-- name:end --> in a file.
export function replaceBlock(file, name, body) {
  const text = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`(<!-- ${name}:start -->\\n)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(text)) throw new Error(`${file}: no ${name} block`);
  const next = text.replace(re, (_, a, b) => a + body + b);
  if (next === text) return false;
  fs.writeFileSync(file, next);
  return true;
}
