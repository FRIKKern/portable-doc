import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { render, TIMELINE_LINES } from './lib/timeline.mjs';

const NOW = new Date('2026-11-19T12:00:00Z');
// One day in each period, as seen on Thursday 2026-11-19: today, yesterday, this week,
// last week, this month, last month, earlier.
const DAYS = ['2026-11-19', '2026-11-18', '2026-11-16', '2026-11-10', '2026-11-03', '2026-10-10', '2026-09-01'];
const lines = (text) => text.split('\n').slice(0, -1);

test('the timeline writes at most TIMELINE_LINES lines, one per period that has something: twice as many stories as rows in every period never passes it', () => {
  assert.equal(TIMELINE_LINES, 7);
  const items = DAYS.flatMap((day, p) => Array.from({ length: 2 * TIMELINE_LINES }, (_, i) => ({
    at: new Date(`${day}T${String(10 - (i % 10)).padStart(2, '0')}:00:00Z`),
    kind: i % 3 ? 'change' : 'task',
    text: `story ${p}.${i}${i === 0 ? '\nwith a line break' : ''}`,
  })));
  const out = render(items, NOW);
  assert.ok(lines(out).length <= TIMELINE_LINES, out);
  assert.match(out, /^- \*\*Today\*\* · 9 changes, 5 milestones closed · story 0\.0 with a line break\n/);
  assert.match(out, /\n- \*\*Last week\*\* · 9 changes, 5 milestones closed\n/);
  assert.match(out, /\n- \*\*Earlier\*\* · 9 changes, 5 milestones closed\n$/);
});

test('a period with nothing in it gets no line: one period is one line, and with every period empty the block is one line', () => {
  assert.deepEqual(lines(render([], NOW)), ['- No changes yet']);
  assert.deepEqual(lines(render([{ at: new Date('2026-11-10T10:00:00Z'), kind: 'change', text: 'x' }], NOW)), ['- **Last week** · 1 change']);
  assert.deepEqual(lines(render([{ at: new Date('2026-11-19T10:00:00Z'), kind: 'task', text: 'Delivered: y' }], NOW)), ['- **Today** · 1 milestone closed · Delivered: y']);
});

test('README fits its 80-line cap with the timeline block full: its lines outside the block plus TIMELINE_LINES', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8').trimEnd().split('\n');
  const start = readme.indexOf('<!-- timeline:start -->');
  const end = readme.indexOf('<!-- timeline:end -->');
  assert.ok(start >= 0 && end > start, 'README has its timeline block');
  const outside = readme.length - (end - start - 1);
  assert.ok(outside + TIMELINE_LINES <= 80, `${outside} lines outside the block + ${TIMELINE_LINES} = ${outside + TIMELINE_LINES}, cap is 80`);
});

test('replaceBlock refuses a file without exactly one start marker and one end marker, start first, so a decoy block is never the one written', async () => {
  const { replaceBlock } = await import('./lib/board.mjs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replace block test-'));
  try {
    const file = path.join(dir, 'README.md');
    const block = '<!-- timeline:start -->\nold\n<!-- timeline:end -->\n';
    for (const text of ['# x\n', `# x\n\`\`\`\n${block}\`\`\`\n${block}`, `# x\n${block}<!-- timeline:end -->\n`, '# x\n<!-- timeline:end -->\n<!-- timeline:start -->\n']) {
      fs.writeFileSync(file, text);
      assert.throws(() => replaceBlock(file, 'timeline', 'new\n'), /README\.md: needs exactly one <!-- timeline:start --> and one <!-- timeline:end -->, start first/, text);
      assert.equal(fs.readFileSync(file, 'utf8'), text, 'left as it was');
    }
    fs.writeFileSync(file, `# x\n${block}tail\n`);
    assert.equal(replaceBlock(file, 'timeline', 'new\n'), true);
    assert.equal(fs.readFileSync(file, 'utf8'), '# x\n<!-- timeline:start -->\nnew\n<!-- timeline:end -->\ntail\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The news tool's limits for this repo live in docs/news/limits.json: the days the README shows and the
// groups a day may have. The news run checks its own limits against the same file. At its largest the
// block is, in render's row shape, per day a summary line, a line per group and a blank line, the last
// blank dropped.
const NEWS = JSON.parse(fs.readFileSync(new URL('../docs/news/limits.json', import.meta.url), 'utf8'));
const NEWS_LINES = NEWS.days * (1 + NEWS.groups_per_day + 1) - 1;

test('README fits its 80-line cap with both generated blocks full: the timeline at TIMELINE_LINES and News at its largest', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8').trimEnd().split('\n');
  const inside = (name) => {
    const start = readme.indexOf(`<!-- ${name}:start -->`);
    const end = readme.indexOf(`<!-- ${name}:end -->`);
    assert.ok(start >= 0 && end > start, `README has its ${name} block`);
    return end - start - 1;
  };
  const outside = readme.length - inside('timeline') - inside('news');
  const full = outside + TIMELINE_LINES + NEWS_LINES;
  assert.ok(full <= 80, `${outside} lines outside the blocks + ${TIMELINE_LINES} timeline + ${NEWS_LINES} news = ${full}, cap is 80`);
});
