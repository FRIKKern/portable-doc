import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATUSES, readReports } from './lib/conformance.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(root, 'docs', 'images', 'conformance.svg');
const W = 1200, PAD = 40, PANELS = 3, LABEL_W = 140, HEAD_OVERHANG = 56, CELL_W = 30, CELL_H = 18, PITCH = 20, HEAD_H = 78;
const TIER_ORDER = ['element', 'widget', 'section'];
const GLYPH = { pass: '✓', fail: '✕', missing: '∅', unchecked: '?' };
const COMPARE_ORDER = { dom: 0, text: 1 };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function tiers(types) {
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'spec', 'blocks.schema.json'), 'utf8'));
  const blocks = schema.definitions?.blocks ?? {};
  const groups = new Map();
  for (const type of types) {
    const tier = blocks[type]?.['x-tier'] ?? 'other';
    if (!groups.has(tier)) groups.set(tier, []);
    groups.get(tier).push(type);
  }
  const rank = (t) => (TIER_ORDER.includes(t) ? TIER_ORDER.indexOf(t) : t === 'other' ? Infinity : TIER_ORDER.length);
  return [...groups].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

function flow(groups, columns, rows) {
  const out = [[]];
  for (const [tier, types] of groups) {
    types.forEach((type, i) => {
      let col = out.at(-1);
      const needsHead = i === 0 || col.length === 0;
      if (col.length + (needsHead ? 2 : 1) > rows) {
        col = [];
        out.push(col);
      }
      if (i === 0 || col.length === 0) col.push({ tier, count: types.length, cont: i > 0 });
      col.push({ type });
    });
  }
  return out.length <= columns ? out : null;
}

function layout(groups) {
  const items = groups.reduce((n, [, types]) => n + types.length + 1, 0);
  for (let rows = Math.ceil(items / PANELS); ; rows++) {
    const cols = flow(groups, PANELS, rows);
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
  const cx = x + CELL_W / 2, cy = y + CELL_H / 2;
  const out = [`<rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" rx="3" class="c-${row.status}"/>`];
  out.push(`<text x="${cx}" y="${cy + 4.5}" font-size="12" font-weight="700" text-anchor="middle" class="g-${row.status}">${GLYPH[row.status]}</text>`);
  if (row.via) out.push(`<path d="M${x + CELL_W - 11} ${y}H${x + CELL_W - 3}Q${x + CELL_W} ${y} ${x + CELL_W} ${y + 3}V${y + 11}Z" class="via"/>`);
  return out.join('');
}

function render(reports, types) {
  const ordered = [...reports].sort((a, b) => Number(!!b.reference) - Number(!!a.reference) || (COMPARE_ORDER[a.compare] ?? 9) - (COMPARE_ORDER[b.compare] ?? 9) || a.renderer.localeCompare(b.renderer));
  const byRenderer = ordered.map((r) => ({ report: r, rows: Object.fromEntries(r.rows.map((row) => [row.type, row])), tally: tally(r) }));
  const groups = tiers(types);
  const { cols, rows } = layout(groups);
  const totalPass = byRenderer.reduce((n, r) => n + r.tally.pass, 0);
  const totalCells = byRenderer.length * types.length;
  const stamp = String(ordered[0]?.pack_stamp ?? '').slice(0, 12);

  const TOTALS_Y = 150, TOTAL_ROW = 30;
  const LEGEND_Y = TOTALS_Y + byRenderer.length * TOTAL_ROW + 24;
  const GRID_Y = LEGEND_Y + 40;
  const panelW = LABEL_W + byRenderer.length * (CELL_W + 2);
  const panelGap = (W - 2 * PAD - HEAD_OVERHANG - PANELS * panelW) / (PANELS - 1);
  const bodyY = GRID_Y + HEAD_H;
  const H = bodyY + rows * PITCH + 64;
  const barX = PAD + 190, barW = 560;

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">`);
  out.push(`<title id="t">PortableDoc conformance heatmap</title>`);
  out.push(`<desc id="d">${types.length} block types by ${byRenderer.length} renderers, ${totalPass} of ${totalCells} cells pass. ${esc(byRenderer.map(({ report: r, tally: t }) => `${r.renderer}${r.reference ? ' (reference)' : ''}: ${STATUSES.map((s) => `${t[s]} ${s}`).join(', ')}${t.via ? `, ${t.via} painted by the host` : ''}`).join('. '))}.</desc>`);
  out.push(`<defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" class="hatch-bg"/><path d="M0 0V5" class="hatch"/></pattern></defs>`);
  out.push(`<style>
  svg { --bg:#fbfaf7; --card:#ffffff; --line:#e3e0d6; --ink:#1f1e1b; --muted:#6c6a63; --pass:#2c7a4b; --fail:#b3261e; --missing:#b26b00; --missbg:#fff6e5; --unchecked:#a3a097; --on:#ffffff; --refbg:#eef6f0; }
  @media (prefers-color-scheme: dark) {
    svg { --bg:#14161a; --card:#1c1f24; --line:#30343b; --ink:#ecebe6; --muted:#9a9ca3; --pass:#6cc28f; --fail:#f2b8b5; --missing:#e8b55a; --missbg:#2a2418; --unchecked:#6d7179; --on:#14161a; --refbg:#1a2a20; }
  }
  text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; fill: var(--ink); }
  .muted { fill: var(--muted); } .bg { fill: var(--bg); } .track { fill: var(--line); } .ref { fill: var(--refbg); } .rule { stroke: var(--line); }
  .c-pass { fill: var(--pass); } .c-fail { fill: var(--fail); } .c-missing { fill: var(--missbg); stroke: var(--missing); stroke-width: 1.5; stroke-dasharray: 3 2; } .c-unchecked { fill: url(#hatch); stroke: var(--unchecked); }
  .g-pass, .g-fail { fill: var(--on); } .g-missing { fill: var(--missing); } .g-unchecked { fill: var(--ink); }
  .hatch { stroke: var(--unchecked); stroke-width: 2; } .hatch-bg { fill: var(--card); } .via { fill: var(--on); }
  .t-pass { fill: var(--pass); } .t-fail { fill: var(--fail); } .t-missing { fill: var(--missing); } .t-unchecked { fill: var(--unchecked); }
</style>`);
  out.push(`<rect class="bg" width="${W}" height="${H}" rx="16"/>`);
  out.push(`<text x="${PAD}" y="70" font-size="36" font-weight="700" letter-spacing="-0.8">Conformance</text>`);
  out.push(`<text x="${PAD}" y="102" font-size="19" class="muted">Every block type in the goldens, rendered by every renderer.</text>`);
  out.push(`<text x="${W - PAD}" y="70" font-size="40" font-weight="700" text-anchor="end">${totalPass}<tspan class="muted" font-weight="400"> / ${totalCells}</tspan></text>`);
  out.push(`<text x="${W - PAD}" y="102" font-size="16" text-anchor="end" class="muted">cells pass</text>`);

  byRenderer.forEach(({ report: r, tally: t }, i) => {
    const y = TOTALS_Y + i * TOTAL_ROW;
    out.push(`<g data-total="${esc(r.renderer)}">`);
    out.push(`<text x="${PAD}" y="${y + 13}" font-size="16" font-weight="600">${esc(r.renderer)}${r.reference ? '<tspan class="muted" font-weight="400"> · reference</tspan>' : ''}</text>`);
    out.push(`<rect x="${barX}" y="${y}" width="${barW}" height="16" rx="4" class="track"/>`);
    let x = barX;
    for (const s of STATUSES) {
      if (!t[s]) continue;
      const w = (barW * t[s]) / r.rows.length;
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="16" class="c-${s}"/>`);
      x += w;
    }
    const parts = STATUSES.filter((s) => t[s]).map((s, k) => `<tspan class="t-${s}" font-weight="700"${k ? ' dx="12"' : ''}>${GLYPH[s]} ${t[s]}</tspan><tspan class="muted"> ${s}</tspan>`);
    if (t.via) parts.push(`<tspan class="muted" dx="12">(${t.via} host-paint)</tspan>`);
    out.push(`<text x="${barX + barW + 20}" y="${y + 13}" font-size="14">${parts.join('')}</text>`);
    out.push(`</g>`);
  });

  const legend = STATUSES.map((s, i) => {
    const x = PAD + i * 115;
    return cell(x, LEGEND_Y, { status: s }) + `<text x="${x + CELL_W + 8}" y="${LEGEND_Y + 13}" font-size="14">${s}</text>`;
  });
  const lx = PAD + STATUSES.length * 115;
  legend.push(cell(lx, LEGEND_Y, { status: 'pass', via: 'host-paint' }) + `<text x="${lx + CELL_W + 8}" y="${LEGEND_Y + 13}" font-size="14">host-paint: drawn by the host</text>`);
  const rx = lx + 270;
  legend.push(`<rect x="${rx}" y="${LEGEND_Y - 2}" width="${CELL_W}" height="${CELL_H + 4}" rx="3" class="ref"/><text x="${rx + CELL_W + 8}" y="${LEGEND_Y + 13}" font-size="14">reference: its output is the goldens</text>`);
  out.push(...legend);
  out.push(`<path d="M${PAD} ${GRID_Y - 14}H${W - PAD}" class="rule"/>`);

  cols.forEach((col, p) => {
    const px = PAD + p * (panelW + panelGap);
    byRenderer.forEach(({ report: r }, c) => {
      const x = px + LABEL_W + c * (CELL_W + 2);
      if (r.reference) out.push(`<rect x="${x - 1}" y="${GRID_Y}" width="${CELL_W + 2}" height="${HEAD_H + col.length * PITCH}" rx="4" class="ref"/>`);
      const tx = x + CELL_W / 2 + 4, ty = bodyY - 8;
      out.push(`<text x="${tx}" y="${ty}" font-size="12" transform="rotate(-55 ${tx} ${ty})" data-renderer="${esc(r.renderer)}"${r.reference ? ' font-weight="700"' : ''}>${esc(r.renderer)}</text>`);
    });
    col.forEach((item, k) => {
      const y = bodyY + k * PITCH;
      if (item.tier) {
        out.push(`<text x="${px}" y="${y + 14}" font-size="12" font-weight="700" letter-spacing="1.5" class="muted">${esc(item.tier.toUpperCase())} · ${item.count}${item.cont ? ' (cont.)' : ''}</text>`);
        return;
      }
      const cells = byRenderer.map(({ rows: byType }, c) => cell(px + LABEL_W + c * (CELL_W + 2), y, byType[item.type]));
      out.push(`<g data-type="${esc(item.type)}"><text x="${px + LABEL_W - 8}" y="${y + 13}" font-size="13" text-anchor="end">${esc(item.type)}</text>${cells.join('')}</g>`);
    });
  });

  out.push(`<text x="${PAD}" y="${H - 28}" font-size="14" class="muted">Generated from conformance/*.json by scripts/generate-heatmap.mjs · pack stamp ${esc(stamp)} · rows grouped by x-tier in spec/blocks.schema.json</text>`);
  out.push(`</svg>\n`);
  return out.join('\n');
}

const { reports, types, errors } = readReports(root);
if (errors.length) {
  console.error(`conformance reports are not valid, nothing drawn:\n${errors.join('\n')}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, render(reports, types));
console.log(`wrote ${path.relative(root, OUT)}: ${types.length} types × ${reports.length} renderers`);
