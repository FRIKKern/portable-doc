import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { render, TIMELINE_MAX_LINES } from './lib/timeline.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('render() with items in all seven periods writes at most TIMELINE_MAX_LINES lines, the oldest folded into one Earlier count', () => {
  assert.equal(TIMELINE_MAX_LINES, 8);
  const at = (iso, text, kind = 'change') => ({ at: new Date(iso), kind, text });
  const items = [
    at('2026-11-19T10:00:00Z', 'today'),
    at('2026-11-18T10:00:00Z', 'yesterday'),
    at('2026-11-16T10:00:00Z', 'this week'),
    at('2026-11-10T10:00:00Z', 'last week'),
    at('2026-11-03T10:00:00Z', 'this month'),
    at('2026-10-10T10:00:00Z', 'last month', 'task'),
    at('2026-09-01T10:00:00Z', 'earlier'),
  ];
  const out = render(items, new Date('2026-11-19T12:00:00Z'));
  assert.ok(out.split('\n').filter(Boolean).length <= TIMELINE_MAX_LINES, out);
  assert.equal(out, [
    '- **Today** · 1 change',
    '  - today',
    '- **Yesterday** · 1 change',
    '  - yesterday',
    '- **This week** · 1 change',
    '  - this week',
    '- **Last week** · 1 change',
    '- **Earlier** · 2 changes, 1 milestone closed',
    '',
  ].join('\n'));
  assert.equal(render(items.slice(0, 3), new Date('2026-11-19T12:00:00Z')).split('\n').filter(Boolean).length, 6, 'nothing folds when it fits');
});

test('check-docs counts the README outside the timeline block plus the block\'s full budget, so a small block cannot hide a README over the cap', () => {
  fs.writeFileSync(path.join(tmp, 'gitconfig'), '[user]\n\tname = t\n\temail = t@example.invalid\n');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(tmp, 'gitconfig'), GIT_CEILING_DIRECTORIES: path.dirname(tmp), GIT_TERMINAL_PROMPT: '0' };
  const run = (outside) => {
    const root = path.join(tmp, `readme-${outside}`);
    fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
    for (const f of ['check-docs.mjs', 'lib/timeline.mjs']) fs.copyFileSync(path.join(scripts, f), path.join(root, 'scripts', f));
    const filler = Array.from({ length: outside - 2 }, (_, i) => `line ${i}`);
    fs.writeFileSync(path.join(root, 'README.md'), ['<!-- timeline:start -->', '- **Today** · 1 change', '<!-- timeline:end -->', ...filler].join('\n') + '\n');
    for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-qm', 'docs'], ['update-ref', 'refs/remotes/origin/main', 'HEAD']]) execFileSync('git', ['-C', root, ...args], { env });
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-docs.mjs')], { cwd: root, env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  // 73 lines outside the block and a 1-line block are 76 lines on disk, but 73 + 8 at the budget.
  const over = run(80 - TIMELINE_MAX_LINES + 1);
  assert.equal(over.code, 1, over.out);
  assert.match(over.out, /README\.md: 73 lines outside the timeline block plus its 8-line budget is 81, cap is 80/);
  const fits = run(80 - TIMELINE_MAX_LINES);
  assert.equal(fits.code, 0, fits.out);
  assert.match(fits.out, /README 80 lines/);
});
