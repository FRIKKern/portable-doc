// SPDX-License-Identifier: Apache-2.0
// Containers and composed blocks: sections, columns, tabs, steps, cards,
// notes, pipelines, tables of contents, file trees, diffs, embeds.

import { asList, codeSpan, fence, isMap, maxOf, nonblank, paras, str, tableOut } from './util.js';
import { body, linked } from './blocks-prose.js';

/** A bold title line (plain: the title alone). */
export const titled = (ctx, raw) => {
  const t = ctx.text(raw, { oneLine: true });
  return t === '' ? '' : ctx.bold(t);
};

function section(b, ctx) {
  return paras(b.title != null ? titled(ctx, str(b.title)) : '', ctx.blocks(asList(b.blocks)));
}

const columns = (b, ctx) => ctx.blocks(asList(b.columns).flatMap((col) => asList(col)));

function terminal(b, ctx) {
  const live = b.live === true || b.live === 'true' || b.live === 'live';
  const title = [ctx.text(str(b.title), { oneLine: true }), live ? '(live)' : ''].filter(Boolean).join(' ');
  return paras(title && ctx.bold(title), ctx.blocks(asList(b.children ?? b.blocks)), ctx.text(str(b.footer)));
}

const tabs = (b, ctx) =>
  paras(...asList(b.tabs).filter(isMap).map((t) => paras(titled(ctx, str(t.label)), ctx.blocks(asList(t.blocks)))));

function codeTabs(b, ctx) {
  return paras(
    ...asList(b.tabs)
      .filter(isMap)
      .map((t) => {
        const source = str(t.value ?? t.code);
        const src = source.trim() === '' ? '' : ctx.md ? fence(source, str(t.language)) : source.replace(/\n+$/, '');
        return paras(titled(ctx, str(t.label)), src);
      }),
  );
}

function apiEndpoint(b, ctx) {
  const head = [str(b.method).toUpperCase(), str(b.path)].filter(Boolean).join(' ');
  if (head === '') return '';
  const rows = asList(b.params)
    .filter(isMap)
    .map((p) => {
      const required = p.required === true || String(p.required).trim().toLowerCase() === 'true';
      return [...['name', 'in', 'type'].map((k) => ctx.text(str(p[k]), { oneLine: true })), required ? 'Yes' : 'No'];
    });
  const table = rows.length ? tableOut(['Name', 'In', 'Type', 'Required'], rows, ctx.md) : '';
  return paras(ctx.md ? codeSpan(head) : head, table);
}

const expandable = (b, ctx) => paras(titled(ctx, str(b.summary)), ctx.blocks(asList(b.blocks ?? b.children)));

function footnote(b, ctx) {
  const items = asList(b.notes)
    .filter((n) => isMap(n) && str(n.text) !== '')
    .map((n) => ({ head: ctx.text(str(n.text)) }));
  return ctx.list(items, { ordered: true });
}

function steps(b, ctx) {
  const items = asList(b.steps)
    .filter(isMap)
    .map((s) => ({ title: str(s.title), blocks: asList(s.blocks ?? s.children) }))
    .filter((s) => s.title !== '' || s.blocks.length)
    .map((s) => ({ head: titled(ctx, s.title), body: ctx.blocks(s.blocks), loose: s.title !== '' }));
  return ctx.list(items, { ordered: true });
}

/** A static outline: `depth` relative levels from the shallowest, optional 1 / 1.1 numbering. */
function toc(b, ctx) {
  const items = asList(b.items)
    .filter((it) => isMap(it) && str(it.text) !== '')
    .map((it) => ({ text: str(it.text), level: Math.max(1, Number(it.level) || 1), anchor: str(it.anchor) }));
  if (!items.length) return '';
  const depth = Number.isInteger(b.depth) && b.depth > 0 ? Math.min(b.depth, 6) : 2;
  const min = -maxOf(items.map((i) => -i.level));
  const counters = new Array(depth + 1).fill(0);
  const lines = [];
  let prev = 0;
  for (const item of items) {
    const rel = item.level - min + 1;
    if (rel > depth) continue;
    counters[rel] += 1;
    for (let l = rel + 1; l <= depth; l++) counters[l] = 0;
    const label = (b.numbered === true ? `${counters.slice(1, rel + 1).join('.')}. ` : '') + item.text;
    const text = item.anchor !== '' && ctx.md ? linked(ctx, ctx.text(label, { oneLine: true }), `#${item.anchor}`) : ctx.text(label, { oneLine: true });
    const nest = Math.min(rel - 1, prev);
    prev = nest + 1;
    lines.push(`${'  '.repeat(nest)}- ${ctx.start(text)}`);
  }
  return lines.join('\n');
}

/* ── notes and cards ── */

function noteLine(m, ctx) {
  const label = ctx.text(str(m.label), { oneLine: true });
  const lead = ctx.text(nonblank(m.lead), { oneLine: true });
  const text = ctx.inline(body(m));
  const head = label && (ctx.md ? `**${label}:**` : `${label}:`);
  return [head, lead && ctx.bold(lead), lead && text ? `— ${text}` : text].filter(Boolean).join(' ');
}

const note = (b, ctx) => noteLine(b, ctx);
const notes = (b, ctx) => ctx.list(asList(b.items).map((it) => ({ head: noteLine(isMap(it) ? it : {}, ctx) })));

function cards(b, ctx) {
  const items = asList(b.items).map((it) => {
    const m = isMap(it) ? it : {};
    const title = titled(ctx, str(m.title));
    const text = ctx.text(str(m.text));
    return { head: [title, text].filter(Boolean).join(' — ') };
  });
  return ctx.list(items);
}

function card(b, ctx) {
  const slot = (name) => (isMap(b.slots) ? asList(b.slots[name]) : []);
  const media = slot('media').map((el) => (isMap(el) && !('type' in el) ? { ...el, type: 'image' } : el));
  return ctx.blocks([...media, ...slot('title'), ...slot('body'), ...slot('action')]);
}

/* ── pipeline and stage ── */

function nodeLine(n, ctx) {
  const title = titled(ctx, str(n.title));
  const kind = ctx.text(str(n.kind), { oneLine: true });
  const head = [title, kind && `(${kind})`].filter(Boolean).join(' ');
  const rest = [str(n.detail), str(n.files), typeof n.source === 'string' ? n.source : '']
    .filter(Boolean)
    .map((s) => ctx.text(s, { oneLine: true }));
  return [head, rest.join(' · ')].filter(Boolean).join(' — ');
}

const pipeline = (b, ctx) => ctx.list(asList(b.nodes).map((n) => ({ head: nodeLine(isMap(n) ? n : {}, ctx) })), { ordered: true });

function stage(b, ctx) {
  const field = (name) => {
    const els = isMap(b.slots) ? asList(b.slots[name]) : [];
    return els.length ? els.map((e) => (isMap(e) ? str(e.text) : str(e))).join('') : b[name];
  };
  return nodeLine({ kind: field('kind'), title: field('title'), detail: field('detail'), files: b.files, source: b.source }, ctx);
}

/* ── paper links ── */

function paperLinks(b, ctx) {
  const resolved = isMap(b._paper_links) ? b._paper_links : {};
  const reasons = isMap(b.reasons) ? b.reasons : {};
  const items = asList(b.refs)
    .map((raw) => (typeof raw === 'string' ? { slug: raw } : isMap(raw) ? raw : null))
    .filter((ref) => ref && nonblank(ref.slug) !== '')
    .map((ref) => {
      const slug = nonblank(ref.slug);
      const live = isMap(resolved[slug]) ? resolved[slug] : {};
      const title = nonblank(live.title) || nonblank(ref.title) || slug;
      const description = nonblank(live.description) || nonblank(ref.description);
      const reason = nonblank(ref.reason) || nonblank(reasons[slug]);
      const same = (a, c) => a.replace(/\.+$/, '').toLowerCase() === c.replace(/\.+$/, '').toLowerCase();
      const head = linked(ctx, ctx.text(title, { oneLine: true }), `/papers/${slug}`);
      const why = reason && !same(reason, description) ? `Why it matters: ${reason}` : '';
      return { head: [head, [description, why].filter(Boolean).map((s) => ctx.text(s, { oneLine: true })).join(' ')].filter(Boolean).join(' — ') };
    });
  if (!items.length) return '';
  return paras(titled(ctx, nonblank(b.title) || 'Explore the work'), ctx.text(nonblank(b.description)), ctx.list(items));
}

/* ── verbatim: file trees and diffs ── */

const verbatim = (ctx, source, lang) => (source.trim() === '' ? '' : ctx.md ? fence(source, lang) : source.replace(/\n+$/, ''));

const filetree = (b, ctx) => paras(verbatim(ctx, str(b.text), ''), ctx.text(str(b.legend)));

function diff(b, ctx) {
  const file = str(b.file).trim();
  return paras(file && (ctx.md ? codeSpan(file) : file), verbatim(ctx, str(b.diff), 'diff'));
}

/* ── references to other documents ── */

/** At most this many embeds expand in one render; the rest show their target. */
const MAX_EMBEDS = 100;

function embed(b, ctx) {
  const target = str(b.target);
  const embeds = isMap(ctx.options.embeds) ? ctx.options.embeds : {};
  const doc = Object.hasOwn(embeds, target) ? embeds[target] : undefined;
  const blocks = Array.isArray(doc) ? doc : isMap(doc) && Array.isArray(doc.blocks) ? doc.blocks : null;
  const { state } = ctx;
  if (!blocks || state.open.includes(target) || state.expanded >= MAX_EMBEDS) return ctx.line(`↪ ${target}`);
  state.expanded++;
  state.open.push(target);
  try {
    return ctx.blocks(blocks);
  } finally {
    state.open.pop();
  }
}

function masterRef(b, ctx) {
  const master = str(b.master);
  const version = str(b.version);
  return ctx.line(`↪ ${master || 'master'}${version ? ` (version ${version})` : ''}`);
}

export const layoutHandlers = {
  section,
  columns,
  terminal,
  tabs,
  'code-tabs': codeTabs,
  'api-endpoint': apiEndpoint,
  expandable,
  footnote,
  steps,
  toc,
  note,
  notes,
  cards,
  card,
  pipeline,
  stage,
  'paper-links': paperLinks,
  filetree,
  diff,
  embed,
  'master-ref': masterRef,
};
