// The README timeline: commits and closed milestones grouped into periods, newest first.
// Pure, so tests can call it; scripts/readme-timeline.mjs gathers the items and writes the block.

const TZ = process.env.TIMELINE_TZ || 'Europe/Oslo';
// Items listed per period; older periods show counts only.
const SHOW = { Today: 1, Yesterday: 1, 'This week': 1, 'Last week': 0 };

/** The most lines the timeline block holds. check-docs counts the block at this size against README's cap. */
export const TIMELINE_MAX_LINES = 8;

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

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The block's text, at most TIMELINE_MAX_LINES lines: while it is longer, the two oldest periods fold into one "Earlier" count. */
export function render(items, now = new Date()) {
  const list = periods(now);
  const groups = new Map();
  for (const it of [...items].sort((x, y) => y.at - x.at)) {
    const name = bucket(it.at, list);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(it);
  }
  const periodsShown = [...groups].map(([name, its]) => ({ name, its, show: SHOW[name] ?? 0 }));
  const size = () => periodsShown.reduce((n, p) => n + 1 + Math.min(p.show, p.its.length), 0);
  while (size() > TIMELINE_MAX_LINES && periodsShown.length > 1) {
    const older = periodsShown.pop();
    const newer = periodsShown.pop();
    periodsShown.push({ name: 'Earlier', its: [...newer.its, ...older.its], show: 0 });
  }
  const lines = [];
  for (const { name, its, show } of periodsShown) {
    const changes = its.filter((i) => i.kind === 'change').length;
    const closed = its.length - changes;
    const counts = [changes && plural(changes, 'change'), closed && plural(closed, 'milestone') + ' closed'].filter(Boolean).join(', ');
    lines.push(`- **${name}** · ${counts}`);
    for (const it of its.slice(0, show)) lines.push(`  - ${it.text}`);
  }
  return lines.slice(0, TIMELINE_MAX_LINES).map((l) => l + '\n').join('');
}
