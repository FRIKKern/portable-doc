// SPDX-License-Identifier: Apache-2.0
// GFM Markdown as PortableDoc blocks. The rules are Barkpark's FromMarkdown
// (api/lib/barkpark/portable_doc/from_markdown.ex); the README lists where
// this one differs. Fail-soft: odd Markdown never throws, and a parser
// failure gives the whole text back as one code block.

import { MAX_VALUE_DEPTH, validate, walkDepth } from '@portable-doc/validate';
import { everyBlockAllowed } from './fence-blocks.js';
import { IMPORT_WORK, MAX_NEST, attr, flattenText, inline, merge, parser, text, tree, visibleText } from './from-markdown-inline.js';
import { renderInline } from './inline.js';
import { ADDRESS_KEYS, isMap, safeUrl, str } from './util.js';

const MAX_FENCE_BLOCKS = 50;
// Display blocks a ```portabledoc fence may hold, at the top and nested anywhere the
// schema puts blocks; never fields, forms or bound blocks.
export const FENCE_TYPES = new Set([
  'heading', 'paragraph', 'list', 'code', 'table', 'callout', 'divider', 'diagram',
  'chart', 'stat', 'stats', 'heatmap', 'pullquote', 'eyebrow',
]);
const TONES = new Set(['info', 'success', 'warning', 'danger', 'neutral']);
const TONE_ALIASES = { note: 'info', warn: 'warning', error: 'danger' };
const LISTS = new Set(['bullet_list', 'ordered_list']);

const codeBlock = (value, lang) => (lang ? { type: 'code', value, lang } : { type: 'code', value });
// Inline content with nothing in it, by toMarkdown's own measure: it writes no text for it.
// Import can leave a block so (an unsafe image, a script, a blank code span), and such a
// heading, paragraph, list item or quote is dropped, never kept empty.
const blank = (content) => renderInline(content, true) === '';
const paragraph = (content) => (blank(content) ? [] : [{ type: 'paragraph', content }]);
const textOf = (node) => (node.type === 'paragraph' || node.type === 'heading' ? inline(node.children) : [text(flattenText([node]).trim())]);

// ── lists ───────────────────────────────────────────────────────────────

export const LIST_ITEM_SPLIT = 'list_item_split';

/**
 * A list item as one or more items: its blocks joined by a space as one inline run, and its
 * nested lists kept as lists. Text after a kept nested list starts a new item at the same
 * level, so the words stay in source order: an item's text always comes before its children.
 * Each new item carries `moved`, the source lines of its text: [first, end), from 0.
 * In an item at depth MAX_NEST, a nested list is kept as its text instead (Barkpark's
 * @max_nest rule): its items and their blocks one space apart, joined to the item's own
 * text by one space, in place; a list with no text adds nothing.
 */
function listItem(item, depth) {
  const parts = [];
  let part = { out: [], children: [], notes: [] };
  let after = null; // the line after the last kept nested list, while the part has one
  const close = () => parts.push({ content: merge(part.out), children: part.children, notes: part.notes, moved: part.moved });
  for (const child of item.children) {
    if (LISTS.has(child.type)) {
      if (depth < MAX_NEST) {
        const notes = [];
        const kept = list(child, depth + 1, notes);
        for (const n of notes) part.notes.push({ ...n, path: `/children/${part.children.length}${n.path}` });
        part.children.push(...kept);
        if (kept.length) after = child.tok.map?.[1] ?? after;
      } else {
        const flat = flattenText([child]).trim();
        if (flat) part.out.push(...(part.out.length ? [text(' ')] : []), text(flat));
      }
      continue;
    }
    if (part.children.length) {
      close();
      // Deep source past the work budget has no line map: its text starts after the list.
      const first = child.tok.map?.[0] ?? after ?? 0;
      part = { out: [], children: [], notes: [], moved: [first, first] };
      after = null;
    }
    if (part.moved) part.moved[1] = child.tok.map?.[1] ?? item.tok.map?.[1] ?? part.moved[1];
    if (part.out.length) part.out.push(text(' '));
    if (child.type === 'fence' || child.type === 'code_block') part.out.push({ type: 'code', value: str(child.tok.content).replace(/\n+$/, '') });
    else part.out.push(...textOf(child));
  }
  close();
  return parts;
}

// `[ ] rest` / `[x] rest` at the head of an item: { content, checked }, else null.
function taskItem(content) {
  const first = content[0];
  const m = first?.type === 'text' ? /^\[( |x|X)\]\s+(.*)$/s.exec(first.value) : null;
  if (!m) return null;
  const rest = m[2] === '' && content.length === 1 ? [] : merge([text(m[2]), ...content.slice(1)]);
  return { content: rest, checked: m[1] !== ' ' };
}

const withChildren = (item, children) => (children.length ? { ...item, children } : item);

/**
 * A list as [block], or [] when no item has text or a nested list left. Each item split off
 * adds a LIST_ITEM_SPLIT notice to `notes`, its path from the list block, in source order.
 */
function list(node, depth = 0, notes = []) {
  const ordered = node.type === 'ordered_list';
  const items = node.children
    .filter((c) => c.type === 'list_item')
    .flatMap((li) => listItem(li, depth))
    // `[ ]` opens a task only at the head of an item in the source, never of a split-off one
    .map((it) => ({ ...it, task: ordered || it.moved ? null : taskItem(it.content) }))
    .filter((it) => it.children.length || !blank(it.task?.content ?? it.content));
  if (!items.length) return [];
  items.forEach((it, i) => {
    if (it.moved) notes.push({ code: LIST_ITEM_SPLIT, path: `/items/${i}`, line: it.moved[0] + 1, lines: it.moved[1] - it.moved[0] });
    for (const n of it.notes) notes.push({ ...n, path: `/items/${i}${n.path}` });
  });
  // GitHub task syntax (`- [ ] `, `- [x] `) makes the whole bullet list a checklist.
  if (items.some((it) => it.task)) {
    return [{
      type: 'list',
      ordered: false,
      task: true,
      items: items.map((it) => withChildren(it.task ?? { content: it.content, checked: false }, it.children)),
    }];
  }
  const block = {
    type: 'list',
    ordered,
    items: items.map((it) => (it.children.length ? { content: it.content, children: it.children } : it.content)),
  };
  const start = Number(attr(node, 'start') || 1);
  if (ordered && Number.isSafeInteger(start) && start !== 1) block.start = start;
  return [block];
}

// ── quotes and callouts ─────────────────────────────────────────────────

const joined = (parts) => merge(parts.flatMap((p, i) => [...(i ? [text(' ')] : []), ...p]));

// `[!type]` (or `[!type]+`, `[!type]-`) at the head of a quote: { tone, rest }, else null.
function calloutMarker(content) {
  const first = content[0];
  const m = first?.type === 'text' ? /^\[!(\w+)\][+-]?[ \t]*(.*)$/s.exec(first.value) : null;
  if (!m) return null;
  const raw = m[1].toLowerCase();
  const tone = TONES.has(raw) ? raw : Object.hasOwn(TONE_ALIASES, raw) ? TONE_ALIASES[raw] : 'info';
  return { tone, rest: merge([text(m[2]), ...content.slice(1)]) };
}

function quote(node) {
  const children = node.children;
  // Each child's text once: deep source in it is parsed again each time it is read.
  const parts = children.map(textOf);
  const content = joined(parts);
  const marker = calloutMarker(content);
  if (marker) return [{ type: 'callout', tone: marker.tone, content: marker.rest }];
  // A last paragraph "— Name" is the quote's cite, as toMarkdown writes it.
  const last = children.at(-1);
  const cite = children.length > 1 && last.type === 'paragraph' ? /^— (.+)$/s.exec(flattenText([last]).trim()) : null;
  if (cite) return [{ type: 'blockquote', content: joined(parts.slice(0, -1)), cite: cite[1] }];
  return blank(content) ? [] : [{ type: 'blockquote', content }];
}

// ── code fences ─────────────────────────────────────────────────────────

// A fence's array becomes the doc's blocks array, so its depth is counted inside
// the doc's { blocks: [...] } envelope.
const tooDeep = (blocks) => walkDepth({ blocks }) > MAX_VALUE_DEPTH;

/** Every non-blank block id in a parsed fence, or null when an address in it (ADDRESS_KEYS) is unsafe. Iterative. */
function scan(value) {
  const ids = [];
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (!isMap(v) && !Array.isArray(v)) continue;
    if (isMap(v)) {
      if (typeof v.id === 'string' && v.id.trim() !== '' && typeof v.type === 'string') ids.push(v.id);
      for (const key of ADDRESS_KEYS) if (Object.hasOwn(v, key) && safeUrl(v[key]) !== v[key]) return null;
    }
    for (const child of Object.values(v)) stack.push(child);
  }
  return ids;
}

// A ```portabledoc fence holds a JSON array of blocks, spliced in when it is
// 1 to 50 blocks, every block in it of the allowed types, nested no deeper than MAX_VALUE_DEPTH, that
// validate, hold only safe addresses (href, src, poster, url) and reuse no id from an earlier fence.
// Anything else is a plain code block.
function fence(source, state) {
  let blocks;
  try {
    blocks = JSON.parse(source);
  } catch {
    return [codeBlock(source)];
  }
  const shaped =
    Array.isArray(blocks) &&
    blocks.length > 0 &&
    blocks.length <= MAX_FENCE_BLOCKS &&
    !tooDeep(blocks) &&
    everyBlockAllowed(blocks, FENCE_TYPES);
  const ids = shaped ? scan(blocks) : null;
  if (ids === null || !validate(blocks).ok || ids.some((id) => state.ids.has(id))) return [codeBlock(source)];
  for (const id of ids) state.ids.add(id);
  return blocks;
}

// A fence's language: the first word of its info string.
const langOf = (node) => (node.type === 'fence' ? str(node.tok.info).trim().split(/\s+/)[0] : '');

function code(node, state) {
  const source = str(node.tok.content).replace(/\n+$/, '');
  const lang = langOf(node);
  if (lang === 'mermaid') return [{ type: 'diagram', source }];
  if (lang === 'portabledoc') return fence(source, state);
  return [codeBlock(source, lang)];
}

// ── blocks ──────────────────────────────────────────────────────────────

function table(node) {
  const rows = (section) =>
    node.children
      .filter((c) => c.type === section)
      .flatMap((s) => s.children.filter((r) => r.type === 'tr'))
      .map((r) => r.children.filter((c) => c.type === 'th' || c.type === 'td').map((c) => inline(c.children)));
  const head = rows('thead')[0];
  return head ? { type: 'table', head, rows: rows('tbody') } : { type: 'table', rows: rows('tbody') };
}

function block(node, state) {
  switch (node.type) {
    case 'heading': {
      // Inline content under the canonical name, marks and links kept, as a paragraph's.
      const content = inline(node.children);
      return blank(content) ? [] : [{ type: 'heading', level: Math.min(6, Math.max(1, Number(node.tok.tag.slice(1)) || 1)), content }];
    }
    case 'paragraph': return paragraph(inline(node.children));
    case 'bullet_list': case 'ordered_list': return list(node, 0, (state.notes = []));
    case 'fence': case 'code_block': return code(node, state);
    case 'blockquote': return quote(node);
    case 'table': return [table(node)];
    case 'hr': return [{ type: 'divider' }];
    case 'html_block': {
      const visible = visibleText(node.tok.content).trim();
      return paragraph(visible ? [text(visible)] : []);
    }
    default: {
      const visible = flattenText([node]).trim();
      return paragraph(visible ? [text(visible)] : []);
    }
  }
}

// A paragraph that is one emphasised run, right after a diagram, is its caption.
function caption(node) {
  if (node?.type !== 'paragraph') return '';
  const runs = node.children.flatMap((c) => c.children).filter((c) => !(c.type === 'text' && c.tok.content === ''));
  return runs.length === 1 && runs[0].type === 'em' ? flattenText(runs[0].children).trim() : '';
}

// `env` is the parse's: when its work budget ran out while reading a top-level block,
// that block's place is where the plain-text rest starts.
function convert(nodes, env) {
  const state = { ids: new Set() };
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const blocks = block(node, state);
    if (langOf(node) === 'mermaid' && caption(nodes[i + 1])) blocks[0].caption = caption(nodes[++i]);
    if (env.spent && env.spent.path === undefined) env.spent.path = `/blocks/${out.length}`;
    for (const n of state.notes ?? []) (env.splits ??= []).push({ ...n, path: `/blocks/${out.length}${n.path}` });
    state.notes = null;
    for (const b of blocks) out.push(b);
  }
  return out;
}

export { IMPORT_WORK };

/**
 * GFM Markdown as { blocks, notices, work }. `blocks` pass @portable-doc/validate. `work` is
 * the import's count of lines × nesting depth re-scanned. Past IMPORT_WORK.budget the rest
 * of the deeply nested text is kept as plain text, every word, and `notices` holds one
 * { code: IMPORT_WORK.notice, path, work }: the block where that starts, and the count when
 * it did. Each list item split off at text after a nested list adds one
 * { code: LIST_ITEM_SPLIT, path, line, lines }: the new item, and its text's source lines
 * (the first from 1, and how many), in source order. Never throws.
 */
export function readMarkdown(markdown) {
  const md = typeof markdown === 'string' ? markdown : '';
  const env = {};
  try {
    const blocks = convert(tree(parser.parse(md, env)), env);
    if (validate({ blocks }).ok) {
      const spent = env.spent ? [{ code: IMPORT_WORK.notice, path: env.spent.path, work: env.spent.work }] : [];
      const notices = [...spent, ...(env.splits ?? [])];
      return { blocks, notices, work: env.work ?? 0 };
    }
  } catch {
    // fall through: the text as one code block
  }
  return { blocks: md.trim() === '' ? [] : [codeBlock(md)], notices: [], work: env.work ?? 0 };
}

/** GFM Markdown as PortableDoc blocks that pass @portable-doc/validate: readMarkdown's blocks. Never throws. */
export const fromMarkdown = (markdown) => readMarkdown(markdown).blocks;
