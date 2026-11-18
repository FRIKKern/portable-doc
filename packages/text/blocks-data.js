// SPDX-License-Identifier: Apache-2.0
// Data blocks: stats, charts, heatmaps, comparisons, gauges, routes, tables
// and sheets. A picture turns into its numbers: a small table or list.

import { asList, fmtNum, isMap, maxOf, paras, str, tableOut } from './util.js';
import { titled } from './blocks-layout.js';

const get = (m, k) => (isMap(m) ? m[k] : undefined);

/** A figure's display string: trimmed text, or a number's digits. */
function shown(v) {
  if (typeof v === 'string') return v.trim();
  return typeof v === 'number' ? fmtNum(v) : '';
}

/** A number, or a string that is wholly a number; else null. */
function numeric(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v.trim())) return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : null;
}

const numbers = (v) => asList(v).map(numeric).filter((n) => n !== null);
const noData = (kind) => `${kind} — no data`;
const one = (ctx, s) => ctx.text(s, { oneLine: true });

/* ── provenance: a figure's `source` ref (commit:, paper:, task:, https://) ── */

function sourceRef(ref) {
  if (typeof ref !== 'string') return null;
  if (/^commit:[0-9a-f]{7,40}$/.test(ref)) return { raw: ref, label: ref.slice(0, 14), href: null };
  if (/^paper:[a-z0-9][a-z0-9-]*$/.test(ref) || /^task:[A-Za-z0-9._-]+$/.test(ref)) return { raw: ref, label: ref, href: null };
  if (ref.startsWith('https://') && ref.length > 8) return { raw: ref, label: ref.replace(/^https:\/\//, '').replace(/\/+$/, ''), href: ref };
  return null;
}

/** One "Source: …" line for the datum-bearing items, deduped in first-use order. */
function sources(ctx, items, dflt, isDatum) {
  const seen = new Map();
  for (const it of items) {
    if (!isDatum(it)) continue;
    const ref = sourceRef(shown(get(it, 'source')) || dflt);
    if (ref && !seen.has(ref.raw)) seen.set(ref.raw, ref);
  }
  if (!seen.size) return '';
  const refs = [...seen.values()].map((r) => (r.href === null ? one(ctx, r.label) : ctx.md ? ctx.link(one(ctx, r.label), r.href) : r.href));
  return `${refs.length > 1 ? 'Sources' : 'Source'}: ${refs.join(' · ')}`;
}

/* ── stat / stats ── */

/** "71/118 units — label (2 of 10)", the number in bold. */
function statHead(m, ctx) {
  const value = shown(get(m, 'value'));
  if (value === '') return '';
  const denom = shown(get(m, 'denom'));
  const unit = shown(get(m, 'unit'));
  const figure = ctx.bold(one(ctx, value)) + (denom ? `/${one(ctx, denom)}` : '') + (unit ? ` ${one(ctx, unit)}` : '');
  const dots = get(m, 'dots');
  const of = Number(get(dots, 'of'));
  const on = Number(get(dots, 'on'));
  const dotsText = Number.isInteger(of) && of >= 1 && Number.isInteger(on) ? ` (${Math.min(Math.max(on, 0), of)} of ${of})` : '';
  const label = shown(get(m, 'label'));
  return figure + (label ? ` — ${one(ctx, label)}` : '') + dotsText;
}

function stat(b, ctx) {
  const head = statHead(b, ctx);
  if (head === '') return noData('stat');
  const spark = numbers(get(b, 'spark'));
  return paras(
    head,
    ctx.text(shown(get(b, 'body'))),
    spark.length ? `Trend: ${spark.map(fmtNum).join(', ')}` : '',
    sources(ctx, [b], '', () => true),
  );
}

function stats(b, ctx) {
  const items = asList(get(b, 'items')).filter(isMap);
  if (!items.length) return noData('stats');
  const rows = items.map((it) => {
    const body = shown(get(it, 'body'));
    return { head: [statHead(it, ctx) || noData('stat'), body && one(ctx, body)].filter(Boolean).join(': ') };
  });
  return paras(ctx.list(rows), sources(ctx, items, shown(get(b, 'sourceDefault')), (it) => shown(get(it, 'value')) !== ''));
}

/* ── duel, lineage ── */

function duel(b, ctx) {
  const a = shown(get(b, 'legendA'));
  const z = shown(get(b, 'legendB'));
  const rows = asList(get(b, 'rows'))
    .filter(isMap)
    .filter((r) => ['label', 'valueA', 'valueB'].some((k) => shown(get(r, k)) !== ''));
  if (!rows.length || a === '' || z === '') return noData('duel');
  const withUnit = (r, k) => [shown(get(r, k)), shown(get(r, 'unit'))].filter(Boolean).join(' ');
  const hasDelta = rows.some((r) => shown(get(r, 'delta')) !== '');
  const head = ['', a, z, ...(hasDelta ? ['Change'] : [])].map((s) => one(ctx, s));
  const body = rows.map((r) => [shown(get(r, 'label')), withUnit(r, 'valueA'), withUnit(r, 'valueB'), ...(hasDelta ? [shown(get(r, 'delta'))] : [])].map((s) => one(ctx, s)));
  const isDatum = (r) => shown(get(r, 'valueA')) !== '' || shown(get(r, 'valueB')) !== '';
  return paras(tableOut(head, body, ctx.md), sources(ctx, rows, shown(get(b, 'sourceDefault')), isDatum));
}

function lineage(b, ctx) {
  const nodes = asList(get(b, 'nodes'))
    .filter(isMap)
    .filter((n) => ['overline', 'title', 'body', 'value'].some((k) => shown(get(n, k)) !== ''));
  if (!nodes.length) return noData('lineage');
  const items = nodes.map((n) => {
    const title = titled(ctx, shown(get(n, 'title')));
    const over = shown(get(n, 'overline'));
    const head = title ? title + (over ? ` (${one(ctx, over)})` : '') : one(ctx, over);
    const value = [shown(get(n, 'value')), shown(get(n, 'unit'))].filter(Boolean).join(' ');
    return { head: [head, one(ctx, value), one(ctx, shown(get(n, 'body')))].filter(Boolean).join(' — ') };
  });
  return paras(ctx.list(items, { ordered: true }), sources(ctx, nodes, shown(get(b, 'sourceDefault')), (n) => shown(get(n, 'value')) !== ''));
}

/* ── heatmap ── */

function heatmap(b, ctx) {
  const grid = asList(get(b, 'cells'))
    .map((row) => asList(row).map((v) => numeric(v) ?? 0))
    .filter((row) => row.length);
  if (!grid.length) return noData('heatmap');
  const rowLabels = asList(get(b, 'rowLabels')).map(shown);
  const colLabels = asList(get(b, 'colLabels')).map(shown);
  const marginals = get(b, 'marginals') === true;
  const cols = maxOf(grid.map((r) => r.length));
  const gutter = rowLabels.length > 0 || marginals;
  const head = [...(gutter ? [''] : []), ...Array.from({ length: cols }, (_, j) => colLabels[j] ?? String(j + 1)), ...(marginals ? ['Σ'] : [])];
  const sum = (xs) => xs.reduce((a, v) => a + v, 0);
  const rows = grid.map((row, i) => [
    ...(gutter ? [rowLabels[i] ?? ''] : []),
    ...Array.from({ length: cols }, (_, j) => (j < row.length ? fmtNum(row[j]) : '')),
    ...(marginals ? [fmtNum(sum(row))] : []),
  ]);
  if (marginals) {
    const colSums = Array.from({ length: cols }, (_, j) => sum(grid.map((r) => r[j] ?? 0)));
    rows.push(['Σ', ...colSums.map(fmtNum), fmtNum(sum(colSums))]);
  }
  return tableOut(head.map((s) => one(ctx, s)), rows.map((r) => r.map((s) => one(ctx, s))), ctx.md);
}

/* ── chart: its title, then the series as a table ── */

function chart(b, ctx) {
  const series = asList(get(b, 'series'))
    .map((s, i) => ({ label: shown(get(s, 'label')) || `series ${i + 1}`, points: numbers(get(s, 'points')) }))
    .filter((s) => s.points.length);
  if (!series.length) return noData('chart');
  const kind = shown(get(b, 'kind')) === 'bars' ? 'bar chart' : 'line chart';
  const caption = shown(get(b, 'caption'));
  const xLabels = asList(get(get(b, 'axes'), 'xLabels')).map(shown);
  const n = maxOf(series.map((s) => s.points.length));
  const head = ['', ...series.map((s) => s.label)].map((s) => one(ctx, s));
  const rows = Array.from({ length: n }, (_, i) => [one(ctx, xLabels[i] || String(i + 1)), ...series.map((s) => (i < s.points.length ? fmtNum(s.points[i]) : ''))]);
  const title = caption ? `${ctx.bold(one(ctx, caption))} (${kind})` : capitalizeFirst(kind);
  return paras(title, tableOut(head, rows, ctx.md));
}

const capitalizeFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ── proportional bars: gauge-list, bar-chart, criteria-progress ── */

function gaugeRows(b) {
  const mode = shown(get(b, 'mode')).toLowerCase();
  const share = mode === 'share' || (mode !== 'count' && isMap(b) && 'rows' in b && !('snapshot' in b));
  if (share) {
    const items = asList(get(b, 'rows')).filter(isMap);
    const total = items.reduce((a, it) => a + (numeric(get(it, 'value')) ?? 0), 0);
    const max = numeric(get(b, 'max'));
    const denom = max !== null && max > 0 ? max : total > 0 ? total : 1;
    return items.map((it) => {
      const prop = Math.min(Math.max((numeric(get(it, 'value')) ?? 0) / denom, 0), 1);
      return [shown(get(it, 'label')), `${Math.round(prop * 100)}%`, shown(get(it, 'note'))];
    });
  }
  const groupBy = shown(get(b, 'groupBy')) || 'status';
  if (groupBy === 'epic') return 'epic';
  const counts = new Map();
  for (const r of asList(get(b, 'snapshot')).filter(isMap)) {
    const raw = shown(get(r, groupBy));
    const key = raw === '' ? '(none)' : groupBy === 'priority' ? `P${raw}` : raw;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((x, y) => (x[1] !== y[1] ? y[1] - x[1] : x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .map(([label, count]) => [label, String(count), '']);
}

function gaugeList(b, ctx) {
  const title = titled(ctx, shown(get(b, 'title')));
  const rows = gaugeRows(b);
  if (rows === 'epic') return paras(title, 'groupBy "epic" is unbacked here — needs the epic resolver');
  if (!rows.length) return noData('gauge-list');
  const items = rows.map(([label, digit, note]) => ({ head: one(ctx, `${label}: ${digit}${note ? ` — ${note}` : ''}`) }));
  return paras(title, ctx.list(items));
}

function barChart(b, ctx) {
  const bars = asList(get(b, 'bars')).filter(isMap);
  if (!bars.length) return noData('bar-chart');
  return ctx.list(bars.map((bar) => ({ head: one(ctx, `${shown(get(bar, 'label'))}: ${fmtNum(numeric(get(bar, 'value')) ?? 0)}`) })));
}

function criteriaProgress(b, ctx) {
  let rows = asList(get(b, 'rows')).filter(isMap);
  if (!rows.length) return noData('criteria-progress');
  const count = (r, k) => numeric(get(r, k)) ?? 0;
  if (get(b, 'detail') === 'total') {
    rows = [{ label: 'Total', met: rows.reduce((a, r) => a + count(r, 'met'), 0), total: rows.reduce((a, r) => a + count(r, 'total'), 0) }];
  }
  return ctx.list(rows.map((r) => ({ head: one(ctx, `${shown(get(r, 'label'))}: ${fmtNum(count(r, 'met'))}/${fmtNum(count(r, 'total'))}`) })));
}

function route(b, ctx) {
  const meta = ['sport', 'distance', 'elevation', 'duration'].map((k) => shown(get(b, k))).filter(Boolean).join(' · ');
  const caption = shown(get(b, 'caption'));
  if (!meta && !caption) return noData('route');
  return ctx.start([caption && ctx.bold(one(ctx, caption)), one(ctx, meta)].filter(Boolean).join(' — '));
}

/* ── tables ── */

/** Cells a span covers (all but its origin), as "r,c" keys. Spans are applied
 * in order until the cells they cover would exceed the table's own. */
function coveredCells(spans, lens) {
  const covered = new Set();
  let left = lens.reduce((n, l) => n + l, 0);
  for (const [r0, c0, rs, cs] of spans) {
    if (r0 >= lens.length || c0 >= lens[r0]) continue;
    const end = Math.min(r0 + rs, lens.length);
    let cells = 0;
    for (let r = r0; r < end; r++) cells += Math.max(Math.min(c0 + cs, lens[r]) - c0, 0);
    const cost = Math.max(cells, end - r0);
    if (cost > left) break;
    for (let r = r0; r < end; r++) for (let c = c0; c < Math.min(c0 + cs, lens[r]); c++) if (r !== r0 || c !== c0) covered.add(`${r},${c}`);
    left -= cost;
  }
  return covered;
}

const TABLE_CELL_CAP = 10_000;
const DELTA = ['▼', '-', '▲'];

const rowCells = (row) => (isMap(row) && Array.isArray(row.cells) ? row.cells : asList(row));

function cellContent(cell) {
  if (!isMap(cell)) return cell;
  if (typeof cell.text === 'string') return cell.text;
  if (!Array.isArray(cell.content)) return cell;
  return cell.content.flatMap((n) => (isMap(n) && Array.isArray(n.content) ? n.content : [n]));
}

const int = (v, min) => {
  const n = typeof v === 'string' && /^[+-]?\d+$/.test(v) ? Number(v) : v;
  return Number.isInteger(n) && n >= min ? n : null;
};

function table(b, ctx) {
  let head = asList(b.head ?? b.header);
  let rows = asList(b.rows);
  const columns = asList(b.columns);
  const maps = columns.length && columns.every(isMap);
  const keyed = maps && !columns.every((c) => typeof c.text === 'string') && columns.every((c) => typeof c.key === 'string' && c.key !== '');
  const rowTotal = Array.isArray(b.rows) ? b.rows.length : b.rows == null ? 0 : 1;
  if (keyed && rowTotal * columns.length > TABLE_CELL_CAP) return 'Table too large to show';
  if (!head.length && maps) {
    head = columns.map((c) => c.text ?? c.label ?? (typeof c.key === 'string' ? c.key : ''));
    if (columns.every((c) => typeof c.key === 'string' && c.key !== '')) rows = rows.map((r) => (isMap(r) ? columns.map((c) => r[c.key] ?? '') : r));
  } else if (!head.length && rows.length && isMap(rows[0]) && (rows[0].header || rowCells(rows[0]).every((c) => isMap(c) && !!c.header))) {
    head = rowCells(rows[0]);
    rows = rows.slice(1);
  }
  const types = asList(b.cols).map((c) => (isMap(c) ? String(c.type ?? '') : ''));
  const cell = (c) => ctx.inline(cellContent(c), { oneLine: true });
  const typed = (c, type) => {
    const n = typeof c === 'number' ? c : typeof c === 'string' && c.trim() !== '' && Number.isFinite(Number(c)) ? Number(c) : null;
    if (type === 'delta' && n !== null) return `${DELTA[Math.sign(n) + 1]} ${fmtNum(Math.abs(n))}`;
    if (type === 'spark' && Array.isArray(c)) return numbers(c).map(fmtNum).join(' ');
    return cell(c);
  };
  const cells = rows.map(rowCells);
  const spans = asList(b.spans)
    .filter(isMap)
    .flatMap((s) => {
      const [r, c, cs, rs] = [int(s.row, 0), int(s.col, 0), int(s.colspan, 1) ?? 1, int(s.rowspan, 1) ?? 1];
      if (r === null || c === null || r >= cells.length || c >= (cells[0]?.length ?? 0)) return [];
      return [[r, c, Math.min(rs, cells.length - r), Math.min(cs, (cells[0]?.length ?? 0) - c)]];
    });
  const covered = coveredCells(spans, cells.map((r) => r.length));
  const body = cells.map((r, i) => r.map((c, j) => (covered.has(`${i},${j}`) ? '' : typed(c, types[j] ?? ''))));
  if (!head.length && !body.length) return '';
  return tableOut(head.length ? head.map((c) => cell(c)) : null, body, ctx.md);
}

function sheet(b, ctx) {
  const snap = isMap(b.snapshot) ? b.snapshot : {};
  const text = (v) => one(ctx, typeof v === 'string' ? v : typeof v === 'number' ? fmtNum(v) : '');
  const head = asList(snap.head).map(text);
  const rows = asList(snap.rows).map((r) => asList(r));
  const merges = asList(snap.merges).filter(
    (m) => Array.isArray(m) && m.length === 4 && m.every(Number.isInteger) && m[0] >= 0 && m[1] >= 0 && m[2] >= 1 && m[3] >= 1 && m[2] * m[3] <= 10_000,
  );
  const covered = coveredCells(merges, rows.map((r) => r.length));
  const body = rows.map((r, i) => r.map((c, j) => (covered.has(`${i},${j}`) ? '' : text(c))));
  const note = snap.truncated === true ? `Sheet truncated — showing the first ${rows.length} rows` : '';
  return paras(tableOut(head.length ? head : null, body, ctx.md), note);
}

export const dataHandlers = {
  stat,
  stats,
  'stat-grid': stats,
  duel,
  lineage,
  heatmap,
  chart,
  'gauge-list': gaugeList,
  'bar-chart': barChart,
  'criteria-progress': criteriaProgress,
  route,
  table,
  sheet,
};
