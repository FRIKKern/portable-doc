// SPDX-License-Identifier: Apache-2.0
// GFM Markdown as PortableDoc blocks. The rules are Barkpark's FromMarkdown
// (api/lib/barkpark/portable_doc/from_markdown.ex); the README lists where
// this one differs. Fail-soft: odd Markdown never throws, and a parser
// failure gives the whole text back as one code block.

import { MAX_VALUE_DEPTH, validate, walkDepth } from '@portable-doc/validate';
import { everyBlockAllowed } from './fence-blocks.js';
import { IMPORT_WORK, planText } from './import-work.js';
import { MAX_NEST, attr, flattenText, inline, merge, parser, text, tree, visibleText } from './from-markdown-inline.js';
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

/**
 * A list item: its blocks joined by a space as one inline run, and its nested lists kept as
 * lists. In an item at depth MAX_NEST, a nested list is kept as its text instead (Barkpark's
 * @max_nest rule): its items and their blocks one space apart, joined to the item's own
 * text by one space; a list with no text adds nothing.
 */
function listItem(item, depth) {
  const out = [];
  const children = [];
  for (const child of item.children) {
    if (LISTS.has(child.type)) {
      if (depth < MAX_NEST) children.push(...list(child, depth + 1));
      else {
        const flat = flattenText([child]).trim();
        if (flat) out.push(...(out.length ? [text(' ')] : []), text(flat));
      }
      continue;
    }
    if (out.length) out.push(text(' '));
    if (child.type === 'fence' || child.type === 'code_block') out.push({ type: 'code', value: str(child.tok.content).replace(/\n+$/, '') });
    else out.push(...textOf(child));
  }
  return { content: merge(out), children };
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

/** A list as [block], or [] when no item has text or a nested list left. */
function list(node, depth = 0) {
  const ordered = node.type === 'ordered_list';
  const items = node.children
    .filter((c) => c.type === 'list_item')
    .map((li) => listItem(li, depth))
    .map((it) => ({ ...it, task: ordered ? null : taskItem(it.content) }))
    .filter((it) => it.children.length || !blank(it.task?.content ?? it.content));
  if (!items.length) return [];
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
      const t = flattenText(node.children).trim();
      return t ? [{ type: 'heading', level: Math.min(6, Math.max(1, Number(node.tok.tag.slice(1)) || 1)), text: t }] : [];
    }
    case 'paragraph': return paragraph(inline(node.children));
    case 'bullet_list': case 'ordered_list': return list(node);
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

// Each block of `nodes` onto `out`. Where the net first fires, its path is the block's place.
function convert(nodes, state, out = [], net = undefined) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const blocks = block(node, state);
    if (langOf(node) === 'mermaid' && caption(nodes[i + 1])) blocks[0].caption = caption(nodes[++i]);
    if (net?.fired && net.path === undefined) net.path = `/blocks/${out.length}`;
    for (const b of blocks) out.push(b);
  }
  return out;
}

export { IMPORT_WORK };

/**
 * GFM Markdown as { blocks, notices, work }. `blocks` pass @portable-doc/validate. `work` is the
 * import's work counted from the text (import-work.js). A line longer than limits.lineBytes, and
 * every line from where the work passes limits.budget, is kept as a top-level paragraph of plain
 * text, every word; `notices` then hold one { code, rule, path, line, lines } per rule ('line' or
 * 'budget'): the first such paragraph, the first line cut (from 1) and how many. Should
 * markdown-it's own count still pass the budget (the net), the rest of the deep text is kept as
 * plain text, with a notice of the same shape and rule 'net': `line` the first source line
 * kept so, `lines` how many. Never throws.
 */
export function readMarkdown(markdown, limits = IMPORT_WORK) {
  const md = typeof markdown === 'string' ? markdown : '';
  let plan = { work: 0, parts: [], notices: [] };
  try {
    plan = planText(md, limits);
    const read = readPlan(plan, limits);
    if (read) return { ...read, work: plan.work };
  } catch {
    // fall through: the text as one code block
  }
  return { blocks: md.trim() === '' ? [] : [codeBlock(md)], notices: [], work: plan.work };
}

/**
 * A plan from planText as { blocks, notices }, or null when the blocks do not validate. Each
 * part read is a fresh document for markdown-it; the net's count runs across them all. The
 * import-work test also reads a plan made with a wrong count here, to see the net catch it.
 */
export function readPlan(plan, limits) {
  const state = { ids: new Set() };
  const net = { work: 0, budget: limits.budget };
  const blocks = [];
  const paths = {};
  for (const part of plan.parts) {
    if (part.read !== undefined) convert(tree(parser.parse(part.read, { net, base: part.line })), state, blocks, net);
    else {
      paths[part.rule] ??= `/blocks/${blocks.length}`;
      blocks.push({ type: 'paragraph', content: [text(part.plain)] });
    }
  }
  if (!validate({ blocks }).ok) return null;
  const notices = plan.notices.map(({ rule, line, lines }) => ({ code: limits.notice, rule, path: paths[rule], line, lines }));
  if (net.fired) notices.push({ code: limits.notice, rule: 'net', path: net.path ?? `/blocks/${Math.max(0, blocks.length - 1)}`, line: net.line, lines: net.lines });
  return { blocks, notices };
}

/** GFM Markdown as PortableDoc blocks that pass @portable-doc/validate: readMarkdown's blocks. Never throws. */
export const fromMarkdown = (markdown) => readMarkdown(markdown).blocks;

/** For the import-work test: what markdown-it re-scans to read `markdown` whole, deep source included. */
export function parsedWork(markdown) {
  const env = {};
  convert(tree(parser.parse(markdown, env)), { ids: new Set() });
  return env.work ?? 0;
}
