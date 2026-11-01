import { COMPARES, STATUSES } from './conformance.mjs';

export const W = 1200, PAD = 40, MAX_NAME = 32;
const CELL_W = 30, CELL_H = 18, PITCH = 20, COL = CELL_W + 2, MIN_GAP = 24, TOTAL_ROW = 46, TOTALS_Y = 140;
const TIER_ORDER = ['element', 'widget', 'section'];
const GLYPH = { pass: '✓', fail: '✕', missing: '∅', unchecked: '?' };
const SIN = Math.sin((55 * Math.PI) / 180), COS = Math.cos((55 * Math.PI) / 180);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function charWidth(c) {
  if ('ilj.,:;!|\' '.includes(c)) return 0.3;
  if ('frt()-[]'.includes(c)) return 0.42;
  if ('mwMW✓✕∅'.includes(c)) return 0.9;
  if (c >= 'A' && c <= 'Z') return 0.7;
  return 0.6;
}

export function textWidth(text, size, { bold = false, spacing = 0 } = {}) {
  return [...String(text)].reduce((w, c) => w + charWidth(c) * size * (bold ? 1.08 : 1) + spacing, 0);
}

function grouped(types, tierOf) {
  const groups = new Map();
  for (const type of types) {
    const tier = tierOf(type) ?? 'other';
    if (!groups.has(tier)) groups.set(tier, []);
    groups.get(tier).push(type);
  }
  const rank = (t) => (TIER_ORDER.includes(t) ? TIER_ORDER.indexOf(t) : t === 'other' ? Infinity : TIER_ORDER.length);
  return [...groups].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

function flow(groups, panels, rows) {
  const out = [[]];
  for (const [tier, types] of groups) {
    types.forEach((type, i) => {
      if (out.at(-1).length + (i === 0 ? 2 : 1) > rows) out.push([]);
      const col = out.at(-1);
      if (i === 0 || col.length === 0) col.push({ tier, count: types.length, cont: i > 0 });
      col.push({ type });
    });
  }
  return out.length <= panels ? out : null;
}

function columns(groups, panels) {
  const items = groups.reduce((n, [, types]) => n + types.length + 1, 0);
  for (let rows = Math.ceil(items / panels); ; rows++) {
    const cols = flow(groups, panels, rows);
    if (cols) return { cols, rows };
  }
}

function tally(report) {
  const t = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of report.rows) t[row.status]++;
  t.via = report.rows.filter((r) => r.via).length;
  return t;
}

function cell(x, y, row) {
  const out = [`<rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" rx="3" class="c-${row.status}"/>`];
  out.push(`<text x="${x + CELL_W / 2}" y="${y + CELL_H / 2 + 4.5}" font-size="12" font-weight="700" text-anchor="middle" class="g-${row.status}">${GLYPH[row.status]}</text>`);
  if (row.via) out.push(`<path d="M${x + CELL_W - 11} ${y}H${x + CELL_W - 3}Q${x + CELL_W} ${y} ${x + CELL_W} ${y + 3}V${y + 11}Z" class="via via-${row.status}"/>`);
  return out.join('');
}

function totalsText(t) {
  const parts = STATUSES.filter((s) => t[s]).map((s, k) => ({ glyph: `${GLYPH[s]} ${t[s]}`, word: ` ${s}`, s, dx: k ? 12 : 0 }));
  const via = t.via ? `(${t.via} host-paint)` : '';
  const width = parts.reduce((w, p) => w + p.dx + textWidth(p.glyph, 14, { bold: true }) + textWidth(p.word, 14), 0) + (via ? 12 + textWidth(via, 14) : 0);
  const svg = parts.map((p) => `<tspan class="t-${p.s}" font-weight="700"${p.dx ? ` dx="${p.dx}"` : ''}>${p.glyph}</tspan><tspan class="muted">${p.word}</tspan>`).join('') + (via ? `<tspan class="muted" dx="12">${via}</tspan>` : '');
  return { svg, width };
}

export function render(reports, types, tierOf) {
  const long = reports.filter((r) => r.renderer.length > MAX_NAME).map((r) => r.renderer);
  if (long.length) throw new Error(`renderer names over ${MAX_NAME} characters do not fit: ${long.join(', ')}`);
  const ordered = [...reports].sort((a, b) => Number(!!b.reference) - Number(!!a.reference) || COMPARES.indexOf(a.compare) - COMPARES.indexOf(b.compare) || a.renderer.localeCompare(b.renderer));
  const byRenderer = ordered.map((r) => ({ report: r, rows: Object.fromEntries(r.rows.map((row) => [row.type, row])), tally: tally(r) }));
  const groups = grouped(types, tierOf);
  const n = byRenderer.length;

  const labelW = Math.ceil(Math.max(80, ...types.map((t) => textWidth(t, 14))) + 16);
  const headLen = Math.max(...ordered.map((r) => textWidth(r.renderer, 13, { bold: !!r.reference })));
  const headH = Math.ceil(headLen * SIN) + 24;
  const overhang = Math.max(0, Math.ceil(CELL_W / 2 + 4 + headLen * COS - CELL_W));
  const tierW = Math.max(...groups.map(([tier, ts]) => textWidth(`${tier.toUpperCase()} · ${ts.length} (cont.)`, 12, { bold: true, spacing: 1.5 })));
  const panelW = Math.ceil(Math.max(labelW + n * COL, tierW));
  const room = W - 2 * PAD - overhang;
  const panels = [3, 2, 1].find((p) => p * panelW + (p - 1) * MIN_GAP <= room);
  if (!panels) throw new Error(`${n} renderers need a ${panelW + overhang}px panel; the card has ${W - 2 * PAD}px`);
  const gap = panels > 1 ? (room - panels * panelW) / (panels - 1) : 0;
  const { cols, rows } = columns(groups, panels);

  const totalPass = byRenderer.reduce((sum, r) => sum + r.tally.pass, 0);
  const totalCells = n * types.length;
  const legendY = TOTALS_Y + n * TOTAL_ROW + 16;
  const gridY = legendY + 40;
  const bodyY = gridY + headH;
  const H = bodyY + rows * PITCH + 64;
  const barW = W - 2 * PAD;

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">`);
  out.push(`<title id="t">PortableDoc conformance heatmap</title>`);
  out.push(`<desc id="d">${types.length} block types by ${n} renderers, ${totalPass} of ${totalCells} cells pass. ${esc(byRenderer.map(({ report: r, tally: t }) => `${r.renderer}${r.reference ? ' (reference)' : ''}: ${STATUSES.map((s) => `${t[s]} ${s}`).join(', ')}${t.via ? `, ${t.via} painted by the host` : ''}`).join('. '))}.</desc>`);
  out.push(`<defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" class="hatch-bg"/><path d="M0 0V5" class="hatch"/></pattern></defs>`);
  out.push(`<style>
  svg { --bg:#fbfaf7; --card:#ffffff; --line:#e3e0d6; --ink:#1f1e1b; --muted:#6c6a63; --pass:#2c7a4b; --on-pass:#ffffff; --pass-ink:#2c7a4b; --failbg:#f8d3cf; --fail:#a3221b; --fail-ink:#b3261e; --missbg:#fff6e5; --missing:#8a5300; --unchecked:#a3a097; --refbg:#eef6f0; }
  @media (prefers-color-scheme: dark) {
    svg { --bg:#14161a; --card:#1c1f24; --line:#30343b; --ink:#ecebe6; --muted:#9a9ca3; --pass:#2e7a4e; --on-pass:#f4f3ee; --pass-ink:#6cc28f; --failbg:#f2b8b5; --fail:#7d1a15; --fail-ink:#f2b8b5; --missbg:#2a2418; --missing:#e8b55a; --unchecked:#6d7179; --refbg:#1a2a20; }
  }
  text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; fill: var(--ink); }
  .muted { fill: var(--muted); } .bg { fill: var(--bg); } .track { fill: var(--line); } .ref { fill: var(--refbg); } .rule { stroke: var(--line); }
  .c-pass { fill: var(--pass); }
  .c-fail { fill: var(--failbg); stroke: var(--fail); stroke-width: 1.5; }
  .c-missing { fill: var(--missbg); stroke: var(--missing); stroke-width: 1.5; stroke-dasharray: 3 2; }
  .c-unchecked { fill: url(#hatch); stroke: var(--unchecked); }
  .g-pass { fill: var(--on-pass); } .g-fail { fill: var(--fail); } .g-missing { fill: var(--missing); } .g-unchecked { fill: var(--ink); }
  .hatch { stroke: var(--unchecked); stroke-width: 2; } .hatch-bg { fill: var(--card); } .via { fill: var(--ink); } .via-pass { fill: var(--on-pass); }
  .t-pass { fill: var(--pass-ink); } .t-fail { fill: var(--fail-ink); } .t-missing { fill: var(--missing); } .t-unchecked { fill: var(--muted); }
</style>`);
  out.push(`<rect class="bg" width="${W}" height="${H}" rx="16"/>`);
  out.push(`<text x="${PAD}" y="70" font-size="36" font-weight="700" letter-spacing="-0.8">Conformance</text>`);
  out.push(`<text x="${PAD}" y="102" font-size="19" class="muted">Every block type in the goldens, rendered by every renderer.</text>`);
  out.push(`<text x="${W - PAD}" y="70" font-size="40" font-weight="700" text-anchor="end" data-headline="">${totalPass}<tspan class="muted" font-weight="400"> / ${totalCells}</tspan></text>`);
  out.push(`<text x="${W - PAD}" y="102" font-size="16" text-anchor="end" class="muted">cells pass</text>`);

  byRenderer.forEach(({ report: r, tally: t }, i) => {
    const y = TOTALS_Y + i * TOTAL_ROW;
    const counts = totalsText(t);
    out.push(`<g data-total="${esc(r.renderer)}">`);
    out.push(`<text x="${PAD}" y="${y + 14}" font-size="16" font-weight="600">${esc(r.renderer)}${r.reference ? '<tspan class="muted" font-weight="400"> · reference</tspan>' : ''}</text>`);
    out.push(`<text x="${W - PAD}" y="${y + 14}" font-size="14" text-anchor="end" data-width="${Math.ceil(counts.width)}">${counts.svg}</text>`);
    out.push(`<rect x="${PAD}" y="${y + 22}" width="${barW}" height="12" rx="4" class="track"/>`);
    let x = PAD;
    for (const s of STATUSES) {
      if (!t[s]) continue;
      const w = (barW * t[s]) / r.rows.length;
      out.push(`<rect x="${x}" y="${y + 22}" width="${w}" height="12" class="c-${s}" data-segment="${s}"/>`);
      x += w;
    }
    out.push(`</g>`);
  });

  const legend = STATUSES.map((s, i) => {
    const x = PAD + i * 115;
    return cell(x, legendY, { status: s }) + `<text x="${x + CELL_W + 8}" y="${legendY + 13}" font-size="14">${s}</text>`;
  });
  const lx = PAD + STATUSES.length * 115;
  legend.push(cell(lx, legendY, { status: 'pass', via: 'host-paint' }) + `<text x="${lx + CELL_W + 8}" y="${legendY + 13}" font-size="14">host-paint: drawn by the host</text>`);
  const rx = lx + 270;
  legend.push(`<rect x="${rx}" y="${legendY - 2}" width="${CELL_W}" height="${CELL_H + 4}" rx="3" class="ref"/><text x="${rx + CELL_W + 8}" y="${legendY + 13}" font-size="14">reference: its output is the goldens</text>`);
  out.push(...legend);
  out.push(`<path d="M${PAD} ${gridY - 14}H${W - PAD}" class="rule"/>`);

  cols.forEach((col, p) => {
    const px = PAD + p * (panelW + gap);
    byRenderer.forEach(({ report: r }, c) => {
      const x = px + labelW + c * COL;
      if (r.reference) out.push(`<rect x="${x - 1}" y="${gridY}" width="${CELL_W + 2}" height="${headH + col.length * PITCH}" rx="4" class="ref" data-band="${esc(r.renderer)}"/>`);
      const tx = x + CELL_W / 2 + 4, ty = bodyY - 8;
      out.push(`<text x="${tx}" y="${ty}" font-size="13" transform="rotate(-55 ${tx} ${ty})" data-renderer="${esc(r.renderer)}"${r.reference ? ' font-weight="700"' : ''}>${esc(r.renderer)}</text>`);
    });
    col.forEach((item, k) => {
      const y = bodyY + k * PITCH;
      if (item.tier) {
        out.push(`<text x="${px}" y="${y + 14}" font-size="12" font-weight="700" letter-spacing="1.5" class="muted" data-tier="${esc(item.tier)}">${esc(item.tier.toUpperCase())} · ${item.count}${item.cont ? ' (cont.)' : ''}</text>`);
        return;
      }
      const cells = byRenderer.map(({ rows: byType }, c) => cell(px + labelW + c * COL, y, byType[item.type]));
      out.push(`<g data-type="${esc(item.type)}"><text x="${px + labelW - 8}" y="${y + 13}" font-size="14" text-anchor="end">${esc(item.type)}</text>${cells.join('')}</g>`);
    });
  });

  out.push(`<text x="${PAD}" y="${H - 28}" font-size="14" class="muted">Generated from conformance/*.json by scripts/generate-heatmap.mjs · pack stamp ${esc(ordered[0].pack_stamp.slice(0, 12))} · rows grouped by x-tier in spec/blocks.schema.json</text>`);
  out.push(`</svg>\n`);
  return out.join('\n');
}
