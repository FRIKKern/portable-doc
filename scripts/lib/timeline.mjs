// The README timeline: commits and closed milestones grouped into periods, newest first.
// Pure, so tests can call it; scripts/readme-timeline.mjs gathers the items and writes the block.
// The block holds at most one line per period, so README's cap holds with the block full.

const TZ = process.env.TIMELINE_TZ || 'Europe/Oslo';
const ROWS = ['Today', 'Yesterday', 'This week', 'Last week', 'This month', 'Last month', 'Earlier'];
// Periods whose row names their newest story; older rows show counts only.
const STORY = new Set(['Today', 'Yesterday', 'This week']);

/** The most lines the timeline block holds: one per period. */
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
// A story is one line of Markdown whose `&` and `<` are written as entities, so a title holding
// `<!--` or the block's own end marker reads as text on GitHub and can never open a comment or
// end the block early. Links in it still work: an entity in a link's text or URL is decoded.
const storyText = (text) => String(text).replace(/\s+/g, ' ').trim().replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** The block's text: one line per period that has something, newest first, so at most
 * TIMELINE_LINES. A story goes on its period's own line. With nothing at all, one line says so. */
export function render(items, now = new Date()) {
  const list = periods(now);
  const groups = new Map(ROWS.map((name) => [name, []]));
  for (const it of [...items].sort((x, y) => y.at - x.at)) groups.get(bucket(it.at, list)).push(it);
  const lines = [];
  for (const [name, its] of groups) {
    if (!its.length) continue;
    const changes = its.filter((i) => i.kind === 'change').length;
    const closed = its.length - changes;
    const counts = [changes && plural(changes, 'change'), closed && plural(closed, 'milestone') + ' closed'].filter(Boolean).join(', ');
    const story = STORY.has(name) ? ` · ${storyText(its[0].text)}` : '';
    lines.push(`- **${name}** · ${counts}${story}`);
  }
  return (lines.length ? lines : ['- No changes yet']).map((l) => l + '\n').join('');
}
