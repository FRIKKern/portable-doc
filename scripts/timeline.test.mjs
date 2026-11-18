import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render, TIMELINE_LINES } from './lib/timeline.mjs';

const NOW = new Date('2026-11-19T12:00:00Z');
// One day in each period, as seen on Thursday 2026-11-19: today, yesterday, this week,
// last week, this month, last month, earlier.
const DAYS = ['2026-11-19', '2026-11-18', '2026-11-16', '2026-11-10', '2026-11-03', '2026-10-10', '2026-09-01'];
const lines = (text) => text.split('\n').slice(0, -1);

test('the timeline always writes exactly TIMELINE_LINES lines, one per period: twice as many stories as rows in every period, or none at all', () => {
  assert.equal(TIMELINE_LINES, 7);
  const items = DAYS.flatMap((day, p) => Array.from({ length: 2 * TIMELINE_LINES }, (_, i) => ({
    at: new Date(`${day}T${String(10 - (i % 10)).padStart(2, '0')}:00:00Z`),
    kind: i % 3 ? 'change' : 'task',
    text: `story ${p}.${i}${i === 0 ? '\nwith a line break' : ''}`,
  })));
  const out = render(items, NOW);
  assert.equal(lines(out).length, TIMELINE_LINES, out);
  assert.match(out, /^- \*\*Today\*\* · 9 changes, 5 milestones closed · story 0\.0 with a line break\n/);
  assert.match(out, /\n- \*\*Last week\*\* · 9 changes, 5 milestones closed\n/);
  assert.match(out, /\n- \*\*Earlier\*\* · 9 changes, 5 milestones closed\n$/);
  assert.deepEqual(lines(render([], NOW)), ['Today', 'Yesterday', 'This week', 'Last week', 'This month', 'Last month', 'Earlier'].map((name) => `- **${name}** · no changes`));
  assert.equal(lines(render(items.slice(0, 1), NOW)).length, TIMELINE_LINES);
});

test('replaceBlock refuses a file without exactly one start marker and one end marker, start first, so a decoy block is never the one written', async () => {
  const { replaceBlock } = await import('./lib/board.mjs');
  const fs = await import('node:fs');
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
