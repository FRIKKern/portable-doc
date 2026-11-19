// SPDX-License-Identifier: Apache-2.0
// App blocks: chat transcript rows, forms, schema fields, math, and the task
// family (board, list, detail, roadmap, status legend).

import { numberText, stringOf } from './number-text.js';
import { STATUS_ROLES, asList, capitalize, fence, fmtNum, isMap, nonblank, paras, parasOf, roleOf, roleLabel, safeUrl, statusText, str } from './util.js';
import { titled } from './blocks-layout.js';
import { diffLines } from './diff.js';
import { itemOf } from './read-aliases.js';

const one = (ctx, s) => ctx.text(s, { oneLine: true });
const STATUS_WORD = { allowed: '✓ allowed', denied: '⊘ denied', canceled: '— canceled' };
const chatStatus = (s) => STATUS_WORD[s] ?? s;
const chatHead = (ctx, title, status) => `${ctx.bold(one(ctx, title))} — ${one(ctx, chatStatus(status))}`;
const present = (b, k, dflt) => (b[k] == null ? dflt : str(b[k]));

/* ── chat ── */

function chatToolDiff(b, ctx) {
  const input = isMap(b.input) ? b.input : {};
  const lines = diffLines(input);
  if (!lines.length) return '';
  const added = lines.filter((l) => l.op === '+').length;
  const removed = lines.filter((l) => l.op === '-').length;
  const verb = typeof input.content === 'string' && !('old_string' in input) && !Array.isArray(input.edits) ? 'Write' : 'Edit';
  const file = str(input.file_path);
  const head = `${verb} ${ctx.md ? ctx.code(file) : file} (+${added} −${removed})`;
  const rows = lines.map((l) => (l.op === 'gap' ? '…' : `${l.op === '=' ? ' ' : l.op} ${l.text}`)).join('\n');
  return paras(head, ctx.md ? fence(rows, 'diff') : rows);
}

function chatTodo(b, ctx) {
  const todos = asList(b.todos);
  const done = todos.filter((t) => isMap(t) && t.status === 'completed').length;
  const head = `${ctx.bold('Update todos')}${todos.length ? ` · ${done}/${todos.length} done` : ''}`;
  if (!todos.length) return paras(head, 'no items');
  const items = todos.map((t) => {
    const m = isMap(t) ? t : {};
    const status = str(m.status) || 'pending';
    return { head: one(ctx, str(m.content) + (status === 'in_progress' ? ' (in progress)' : '')), checked: status === 'completed' };
  });
  return paras(head, ctx.list(items, { task: true }));
}

function chatThinking(b, ctx) {
  const label = Number.isInteger(b.tokens) ? `thought for ~${b.tokens} tokens` : 'thought';
  return ctx.md ? `*${label}*` : label;
}

function chatApproval(b, ctx) {
  const tool = present(b, 'tool_name', 'tool');
  const status = present(b, 'approval_status', 'pending');
  return paras(chatHead(ctx, status === 'pending' ? `Allow ${tool}?` : tool, status), ctx.text(nonblank(b.summary)));
}

function chatQuestion(b, ctx) {
  const questions = asList(b.questions).map((q) => {
    const m = isMap(q) ? q : {};
    const options = asList(m.options).map(str).filter(Boolean);
    return { head: one(ctx, str(m.question) + (options.length ? ` (${options.join(' / ')})` : '')) };
  });
  return paras(chatHead(ctx, 'Question', present(b, 'approval_status', 'pending')), questions.length ? ctx.list(questions) : 'no question');
}

const chatPlan = (b, ctx) =>
  paras(chatHead(ctx, present(b, 'title', 'Proposed plan'), present(b, 'approval_status', 'pending')), ctx.text(nonblank(b.preview)));

/* ── forms: one numbered question each, its choices as boxes ── */

function bound(v, dflt) {
  if (Number.isInteger(v)) return v;
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : NaN;
  return Number.isNaN(n) ? dflt : n;
}

function choices(q, ctx) {
  const opts = (box, labels) => ctx.list(labels.map((l) => ({ head: `${box} ${one(ctx, l)}` })));
  switch (str(q.type) || 'text') {
    case 'yesno': return opts('( )', ['Yes', 'No']);
    case 'single': return opts('( )', asList(q.options).map(str));
    case 'multi': return opts('[ ]', asList(q.options).map(str));
    case 'scale': {
      const scale = isMap(q.scale) ? q.scale : {};
      const min = bound(scale.min, 1);
      const max = Math.min(bound(scale.max, 5), min + 100);
      return max >= min ? `Scale: ${min} to ${max}` : '';
    }
    default: return '(free text)';
  }
}

function form(b, ctx) {
  const items = asList(b.questions)
    .filter(isMap)
    .map((q) => ({
      head: ctx.text(str(q.prompt)),
      body: paras(ctx.text(str(q.rationale)), str(q.recommendation) && `Recommendation: ${ctx.text(str(q.recommendation))}`, choices(q, ctx)),
      loose: str(q.rationale) !== '' || str(q.recommendation) !== '',
    }));
  return ctx.list(items, { ordered: true });
}

/* ── schema fields: "Label: value" ── */

const stringish = (v) => (typeof v === 'string' ? v : typeof v === 'number' ? numberText(v) : typeof v === 'boolean' ? stringOf(v) : '');
const dash = (s) => (s.trim() === '' ? '—' : s);

function row(b, ctx, value) {
  const label = one(ctx, stringish(b.label));
  return label === '' ? ctx.start(value) : `${ctx.md ? `**${label}:**` : `${label}:`} ${value}`;
}

const plain = (b, ctx) => row(b, ctx, one(ctx, dash(stringish(b.value))));
const shownValue = (b, key) => (stringish(b.value) === '' ? '—' : stringish(b[key]) || stringish(b.value));

/** A sub-value as one display string; maps list their keys in order. */
function scalar(v) {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.map(scalar).join(', ');
  if (isMap(v)) return Object.keys(v).sort().map((k) => `${k}: ${scalar(v[k])}`).join(', ');
  return stringish(v);
}

const subRows = (b, ctx, pairs) =>
  paras(row(b, ctx, '').trimEnd(), ctx.list(pairs.map(([label, key]) => ({ head: one(ctx, `${stringish(label)}: ${scalar(isMap(b.value) ? b.value[stringish(key)] : undefined)}`) }))));

function media(v) {
  const t = typeof v === 'string' ? v.trim() : stringish(v);
  if (t.startsWith('{')) {
    try {
      const u = JSON.parse(t).url;
      if (typeof u === 'string' && u) return u;
    } catch {
      /* the string itself */
    }
  }
  return t;
}

function fieldImage(b, ctx) {
  const url = safeUrl(media(b.value ?? ''));
  if (url === null) return row(b, ctx, 'No image');
  return row(b, ctx, ctx.md ? `![${one(ctx, stringish(b.label))}](${ctx.url(url)})` : url);
}

function fieldNumber(b, ctx) {
  const v = b.value;
  const t = typeof v === 'string' ? v.trim() : '';
  const n = typeof v === 'number' ? v : /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t) ? Number(t) : NaN;
  const unit = nonblank(b.unit);
  return row(b, ctx, one(ctx, Number.isFinite(n) ? fmtNum(n) + (unit && ` ${unit}`) : '—'));
}

function fieldSelect(b, ctx) {
  const hit = asList(b.options).find((o) => isMap(o) && o.value === b.value);
  return row(b, ctx, one(ctx, dash(isMap(hit) ? stringish('label' in hit ? hit.label : hit.value) : stringish(b.value))));
}

function arrayOf(b, ctx) {
  const els = b.value == null ? [] : Array.isArray(b.value) ? b.value : [b.value];
  if (!els.length) return row(b, ctx, '—');
  return paras(row(b, ctx, '').trimEnd(), ctx.list(els.map((e) => ({ head: one(ctx, scalar(e)) })), { ordered: true }));
}

const fieldHandlers = {
  'field-string': plain,
  'field-slug': plain,
  'field-text': (b, ctx) => row(b, ctx, ctx.text(dash(stringish(b.value)))),
  'field-boolean': (b, ctx) => row(b, ctx, b.value === true ? 'Yes' : 'No'),
  'field-select': fieldSelect,
  'field-datetime': (b, ctx) => row(b, ctx, one(ctx, dash(typeof b.value === 'string' ? b.value.replace(/T/g, ' ') : stringish(b.value)))),
  'field-color': plain,
  'field-reference': (b, ctx) => row(b, ctx, one(ctx, shownValue(b, '_ref_title'))),
  'field-image': fieldImage,
  'field-number': fieldNumber,
  composite: (b, ctx) =>
    subRows(b, ctx, asList(b.fields).map((f) => {
      const name = isMap(f) ? (f.name ?? '') : '';
      return [isMap(f) && f.title != null && f.title !== false ? f.title : name, name];
    })),
  arrayOf,
  codelist: (b, ctx) => row(b, ctx, one(ctx, shownValue(b, '_code_label'))),
  localizedText: (b, ctx) => subRows(b, ctx, asList(b.languages).map((l) => [l, l])),
};

/* ── math: the TeX source ── */

function equation(b, ctx) {
  const tex = str(b.tex).trim();
  if (tex === '') return 'equation — no tex source';
  if (!ctx.md) return tex;
  // A ```math fence or a $`…`$ span: the TeX can never become HTML or markup.
  return b.display === true ? fence(tex, 'math') : `$${ctx.code(tex)}$`;
}

/* ── tasks ── */

const priority = (p) => {
  const d = str(p).trim().replace(/[^0-9]/g, '');
  return str(p).trim() === '' ? '' : `P${d || '?'}`;
};
const criteria = (c) => {
  const met = isMap(c) && typeof c.met === 'number' ? numberText(c.met) : '';
  const total = isMap(c) && typeof c.total === 'number' && c.total > 0 ? numberText(c.total) : '';
  return met !== '' && total !== '' ? `${met}/${total}` : '';
};
const draft = (r) => (r.draft === true ? 'DRAFT ' : '');

function taskLine(r, ctx, { status = true } = {}) {
  const meta = [status ? statusText(r.status) : '', priority(r.priority), criteria(r.criteria), nonblank(r.blocked_by) && `! ${nonblank(r.blocked_by)}`, nonblank(r.worker)].filter(Boolean);
  const depth = typeof r.depth === 'number' && r.depth > 0 && r.depth < 6 ? '↳ ' : '';
  return one(ctx, `${depth}${draft(r)}${str(r.title)}${meta.length ? ` (${meta.join(' · ')})` : ''}`);
}

const BOARD_ROLES = [...STATUS_ROLES.map(([role]) => role).filter((r) => r !== 'cancel'), 'cancel'];

function taskBoard(b, ctx) {
  const rows = asList(b.snapshot).map((r) => (isMap(r) ? r : {}));
  if (!rows.length) return 'No tasks yet.';
  const by = new Map();
  for (const r of rows) {
    const role = BOARD_ROLES.includes(roleOf(r.status)) ? roleOf(r.status) : 'open';
    by.set(role, [...(by.get(role) ?? []), r]);
  }
  return parasOf(
    BOARD_ROLES.filter((role) => by.has(role)).map((role) =>
      paras(`${ctx.bold(capitalize(roleLabel(role)))} (${by.get(role).length})`, ctx.list(by.get(role).map((r) => ({ head: taskLine(r, ctx, { status: false }) })))),
    ),
  );
}

function tasks(b, ctx) {
  const rows = asList(b.snapshot).map((r) => (isMap(r) ? r : {}));
  if (!rows.length) return 'No tasks yet.';
  const count = (rs, role) => rs.filter((r) => roleOf(r.status) === role).length;
  const momentum = `${count(rows, 'progress')} in flight · ${count(rows, 'ready')} ready · ${count(rows, 'done')} done · ${Math.round((count(rows, 'done') / rows.length) * 100)}%`;
  const phases = new Map();
  for (const r of rows) {
    const key = nonblank(r.phase);
    phases.set(key, [...(phases.get(key) ?? []), r]);
  }
  const groups = [...phases].map(([name, rs]) =>
    paras(name && `${ctx.bold(one(ctx, name))} · ${count(rs, 'done')}/${rs.length}`, ctx.list(rs.map((r) => ({ head: taskLine(r, ctx) })))),
  );
  return parasOf([titled(ctx, nonblank(b.title)), momentum, ...groups]);
}

function taskDetail(b, ctx) {
  const t = isMap(b.task) ? b.task : b;
  const title = nonblank(t.title);
  if (title === '') return 'No matching tasks.';
  const truthy = (v) => v === true || v === 'true' || v === 1;
  const meta = [str(t.status) && statusText(t.status), priority(t.priority), str(t.kind), str(t.worker)].filter(Boolean).join(' · ');
  const stamp = [nonblank(t.created) && `created ${nonblank(t.created)}`, nonblank(t.updated) && `updated ${nonblank(t.updated)}`].filter(Boolean).join(' · ');
  const timeline = asList(t.timeline).map((s) => (isMap(s) ? `${str(s.label)} (${statusText(s.status)})` : '')).filter(Boolean).join(' → ');
  const crit = asList(t.criteria).map((c) => (isMap(c) ? c : {}));
  const critOwner = t === b ? 'task-detail.criteria[]' : 'task-detail.task.criteria[]';
  const critList = crit.length
    ? paras(`Criteria · ${crit.filter((c) => truthy(c.met)).length}/${crit.length}`, ctx.list(crit.map((c) => ({ head: one(ctx, str(itemOf(c, critOwner, 'text'))), checked: truthy(c.met), body: nonblank(c.evidence) && `↳ ${one(ctx, nonblank(c.evidence))}` })), { task: true }))
    : '';
  const nBlocks = typeof t.blocks === 'number' ? t.blocks : 0;
  const nBlocked = typeof t.blocked_by === 'number' ? t.blocked_by : 0;
  const deps = [nBlocks > 0 && `blocks ${nBlocks} ${nBlocks === 1 ? 'task' : 'tasks'}`, nBlocked > 0 && `blocked by ${nBlocked}`].filter(Boolean).join(' · ');
  const children = asList(t.children).map((r) => (isMap(r) ? r : {}));
  const childList = children.length
    ? paras(`Children · ${children.filter((r) => roleOf(r.status) === 'done').length}/${children.length} done`, ctx.list(children.map((r) => ({ head: taskLine(r, ctx) }))))
    : '';
  const papers = asList(t.papers).map(str).filter(Boolean);
  const labels = asList(t.labels).map(str).filter(Boolean);
  return paras(
    ctx.bold(one(ctx, title)),
    ctx.line(meta),
    ctx.line(stamp),
    ctx.line(timeline),
    ctx.text(nonblank(t.description)),
    critList,
    deps && `Dependencies: ${deps}`,
    childList,
    papers.length ? paras('Papers', ctx.list(papers.map((p) => ({ head: one(ctx, p) })))) : '',
    labels.length ? `Labels: ${one(ctx, labels.join(' · '))}` : '',
  );
}

/** A lane's place on the scale: the scale cells its left/width percentages cover. */
function period(r, scale) {
  if (!scale.length || (typeof r.left !== 'number' && typeof r.width !== 'number')) return '';
  const left = typeof r.left === 'number' ? Math.min(Math.max(r.left, 0), 100) : 0;
  const w = typeof r.width === 'number' ? Math.min(Math.max(r.width, 1), 100 - left) : Math.max(1, 100 - left);
  const n = scale.length;
  const from = Math.min(Math.floor((left / 100) * n), n - 1);
  const to = Math.max(from, Math.min(Math.ceil(((left + w) / 100) * n) - 1, n - 1));
  return from === to ? scale[from] : `${scale[from]}–${scale[to]}`;
}

function roadmap(b, ctx) {
  const rows = asList(b.snapshot).map((r) => (isMap(r) ? r : {}));
  if (!rows.length) return 'No roadmap items.';
  const placeable = (r) => typeof r.left === 'number' || typeof r.width === 'number';
  if (!rows.some(placeable)) return paras('No schedule to place these items on.', tasks({ snapshot: rows }, ctx));
  const scale = asList(b.scale).map(str);
  const items = rows.map((r) => {
    const when = placeable(r) ? period(r, scale) : 'not scheduled';
    const title = one(ctx, draft(r) + str(r.title));
    return { head: [r.phase_row === true || r.phase_row === 'true' ? ctx.bold(title) : title, statusText(r.status), when].filter(Boolean).join(' — ') };
  });
  return paras(scale.length ? ctx.line(scale.join(' · ')) : '', ctx.list(items));
}

const statusLegend = (_b, ctx) => ctx.list(STATUS_ROLES.map(([, label, meaning]) => ({ head: `${label}: ${meaning}` })));

export const appHandlers = {
  'chat-tool-diff': chatToolDiff,
  'chat-todo': chatTodo,
  'chat-thinking': chatThinking,
  'chat-approval': chatApproval,
  'chat-question': chatQuestion,
  'chat-plan': chatPlan,
  form,
  questionnaire: form,
  ...fieldHandlers,
  equation,
  'task-board': taskBoard,
  tasks,
  'task-list': tasks,
  'task-detail': taskDetail,
  roadmap,
  'status-legend': statusLegend,
};
