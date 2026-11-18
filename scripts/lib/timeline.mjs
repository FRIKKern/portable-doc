// The README timeline: commits and closed milestones grouped into periods, newest first.
// Pure, so tests can call it; scripts/readme-timeline.mjs gathers the items and writes the block.
// The block is a fixed size, one line per period, so README's line count never moves with it.

const TZ = process.env.TIMELINE_TZ || 'Europe/Oslo';
const ROWS = ['Today', 'Yesterday', 'This week', 'Last week', 'This month', 'Last month', 'Earlier'];
// Periods whose row names their newest story; older rows show counts only.
const STORY = new Set(['Today', 'Yesterday', 'This week']);

/** The lines the timeline block always holds: one row per period, empty or not. */
export const TIMELINE_LINES = ROWS.length;

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
  const starts = [today, addDays(today, -1), week, addDays(week, -7), month, new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1))];
  return starts.map((start, i) => [ROWS[i], start]);
}

function bucket(d, list) {
  const k = day(d);
  for (const [name, start] of list) if (k >= start) return name;
  return 'Earlier';
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The block's text: exactly TIMELINE_LINES lines, one per period, newest first. A period with
 * nothing in it says so; a story goes on its period's own line. */
export function render(items, now = new Date()) {
  const list = periods(now);
  const groups = new Map(ROWS.map((name) => [name, []]));
  for (const it of [...items].sort((x, y) => y.at - x.at)) groups.get(bucket(it.at, list)).push(it);
  const lines = [];
  for (const [name, its] of groups) {
    const changes = its.filter((i) => i.kind === 'change').length;
    const closed = its.length - changes;
    const counts = [changes && plural(changes, 'change'), closed && plural(closed, 'milestone') + ' closed'].filter(Boolean).join(', ') || 'no changes';
    const story = STORY.has(name) && its.length ? ` · ${String(its[0].text).replace(/\s+/g, ' ').trim()}` : '';
    lines.push(`- **${name}** · ${counts}${story}`);
  }
  return lines.map((l) => l + '\n').join('');
}
