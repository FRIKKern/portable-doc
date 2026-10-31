// Draws docs/images/roadmap.svg: milestones and rewards from docs/ROADMAP.md,
// status from the board (scripts/lib/board.mjs).
import fs from 'node:fs';
import { tasks, milestones } from './lib/board.mjs';

const OUT = new URL('../docs/images/roadmap.svg', import.meta.url);
const W = 1200, PAD = 40, GAP = 16, TOP = 196, CARD_H = 196, PER_ROW = 4;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ICON = { done: '✓', in_progress: '◐', open: '○', cancelled: '✕' };
const STATUS_TEXT = { done: 'delivered', in_progress: 'in progress', open: 'to do', cancelled: 'dropped' };

function wrap(text, width) {
  const lines = [''];
  for (const word of text.split(' ')) {
    const last = lines.length - 1;
    if ((lines[last] + ' ' + word).trim().length > width) lines.push(word);
    else lines[last] = (lines[last] + ' ' + word).trim();
  }
  return lines;
}

function render(board, rows) {
  const byId = Object.fromEntries(board.filter((t) => t.id !== 'other').map((t) => [t.id, t]));
  const cards = rows.map((m) => ({ ...m, status: byId[m.id]?.status ?? 'open', url: byId[m.id]?.url }));
  const firstOpen = cards.findIndex((c) => c.status !== 'done');
  cards.forEach((c, i) => {
    c.tag = c.status === 'done' ? 'done' : c.status === 'in_progress' || i === firstOpen ? 'now' : i === firstOpen + 1 ? 'next' : 'later';
  });
  const delivered = cards.filter((c) => c.status === 'done').length;
  const colW = (W - 2 * PAD - GAP * (PER_ROW - 1)) / PER_ROW;
  const rowCount = Math.ceil(cards.length / PER_ROW);
  const H = TOP + rowCount * (CARD_H + GAP) + 52;
  const barW = W - 2 * PAD;

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">`);
  out.push(`<title id="t">PortableDoc roadmap</title>`);
  out.push(`<desc id="d">${delivered} of ${cards.length} rewards delivered. ${esc(cards.map((c) => `${c.id} ${c.name}: ${c.tag}, reward: ${c.reward}`).join('. '))}.</desc>`);
  out.push(`<style>
  svg { --bg:#fbfaf7; --card:#ffffff; --line:#e3e0d6; --ink:#1f1e1b; --muted:#6c6a63; --done:#2c7a4b; --now:#b26b00; --todo:#a3a097; --nowbg:#fff6e5; }
  @media (prefers-color-scheme: dark) {
    svg { --bg:#14161a; --card:#1c1f24; --line:#30343b; --ink:#ecebe6; --muted:#9a9ca3; --done:#6cc28f; --now:#e8b55a; --todo:#6d7179; --nowbg:#2a2418; }
  }
  text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; fill: var(--ink); }
  .muted { fill: var(--muted); } .done { fill: var(--done); } .now { fill: var(--now); } .todo { fill: var(--todo); }
  .bg { fill: var(--bg); } .track { fill: var(--line); } .bar { fill: var(--done); } .rule { stroke: var(--line); }
  .card { fill: var(--card); stroke: var(--line); } .card.on { fill: var(--nowbg); stroke: var(--now); stroke-width: 2; }
</style>`);
  out.push(`<rect class="bg" width="${W}" height="${H}" rx="16"/>`);
  out.push(`<text x="${PAD}" y="70" font-size="36" font-weight="700" letter-spacing="-0.8">PortableDoc</text>`);
  out.push(`<text x="${PAD}" y="102" font-size="19" class="muted">One home for the format. Every milestone ships a reward you can see.</text>`);
  out.push(`<text x="${W - PAD}" y="70" font-size="40" font-weight="700" text-anchor="end">${delivered}<tspan class="muted" font-weight="400"> / ${cards.length}</tspan></text>`);
  out.push(`<text x="${W - PAD}" y="102" font-size="16" text-anchor="end" class="muted">rewards delivered</text>`);
  out.push(`<rect x="${PAD}" y="124" width="${barW}" height="8" rx="4" class="track"/>`);
  if (delivered) out.push(`<rect x="${PAD}" y="124" width="${(barW * delivered) / cards.length}" height="8" rx="4" class="bar"/>`);
  out.push(`<text x="${PAD}" y="168" font-size="16"><tspan class="done">✓ delivered</tspan><tspan class="now" dx="24">◐ in progress</tspan><tspan class="todo" dx="24">○ to do</tspan></text>`);
  out.push(`<text x="${W - PAD}" y="168" font-size="16" text-anchor="end" class="muted">R2 and R4 run side by side · editor upgrades start at R2</text>`);

  cards.forEach((c, k) => {
    const x = PAD + (k % PER_ROW) * (colW + GAP);
    const y = TOP + Math.floor(k / PER_ROW) * (CARD_H + GAP);
    const tagCls = { done: 'done', now: 'now', next: 'muted', later: 'todo' }[c.tag];
    const statusCls = { done: 'done', in_progress: 'now', open: 'todo', cancelled: 'todo' }[c.status];
    out.push(`<g data-milestone="${c.id}">`);
    out.push(`<rect x="${x}" y="${y}" width="${colW}" height="${CARD_H}" rx="12" class="card${c.tag === 'now' ? ' on' : ''}"/>`);
    out.push(`<text x="${x + 20}" y="${y + 32}" font-size="13" font-weight="700" letter-spacing="1.5" class="muted">${c.id}</text>`);
    out.push(`<text x="${x + colW - 20}" y="${y + 32}" font-size="13" font-weight="700" letter-spacing="1.5" text-anchor="end" class="${tagCls}">${c.tag.toUpperCase()}</text>`);
    out.push(`<text x="${x + 20}" y="${y + 66}" font-size="${c.name.length > 17 ? 19 : 23}" font-weight="600">${esc(c.name)}</text>`);
    out.push(`<path d="M${x + 20} ${y + 86}H${x + colW - 20}" class="rule"/>`);
    wrap(c.reward, 28).slice(0, 3).forEach((line, i) => out.push(`<text x="${x + 20}" y="${y + 116 + i * 22}" font-size="16">${esc(line)}</text>`));
    out.push(`<text x="${x + 20}" y="${y + CARD_H - 20}" font-size="15" class="${statusCls}">${ICON[c.status]} ${STATUS_TEXT[c.status]}</text>`);
    out.push(`</g>`);
  });
  out.push(`<text x="${PAD}" y="${H - 30}" font-size="14" class="muted">Generated from the task board by scripts/generate-roadmap.mjs. Milestones: docs/ROADMAP.md · steps: Paper portabledoc-plan</text>`);
  out.push(`</svg>\n`);
  return out.join('\n');
}

const svg = render(await tasks(), milestones());
if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== svg) {
  fs.mkdirSync(new URL('.', OUT), { recursive: true });
  fs.writeFileSync(OUT, svg);
  console.log('wrote docs/images/roadmap.svg');
}
