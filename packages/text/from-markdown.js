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
// schema puts blocks; never fields, forms or bound blocks. pre-gate-badge stays out for
// good: it is a notice the renderer adds, and Markdown must not be able to forge it.
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

/**
 * A quote. With a `[!tone]` marker at the head of its first paragraph it is a callout: that
 * paragraph is its content, and every block after it is read as blocks into `slots.body`,
 * fences and all. A plain quote holds inline content only, so it stays one run of all its text.
 */
function quote(node, state) {
  const children = node.children;
  // Each child's text once: deep source in it is parsed again each time it is read.
  const parts = children.map(textOf);
  const marker = calloutMarker(parts[0] ?? []);
  if (marker) {
    const body = blocksOf(children.slice(1), state);
    const callout = { type: 'callout', tone: marker.tone, content: marker.rest };
    return [body.length ? { ...callout, slots: { body } } : callout];
  }
  const content = joined(parts);
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

/**
 * Whether a fence's parsed value is spliced, given the ids earlier fences used: { ids } (the
 * block ids it adds) or { reason }, why it stays a code block. toMarkdown's round-trip mode asks
 * the same question, so writer and reader share one rule.
 */
export function checkFence(blocks, usedIds) {
  if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > MAX_FENCE_BLOCKS) return { reason: 'count' };
  if (tooDeep(blocks)) return { reason: 'depth' };
  if (!everyBlockAllowed(blocks, FENCE_TYPES)) return { reason: 'type' };
  const ids = scan(blocks);
  if (ids === null) return { reason: 'address' };
  if (!validate(blocks).ok) return { reason: 'invalid' };
  if (ids.some((id) => usedIds.has(id))) return { reason: 'id' };
  return { ids };
}

function fence(source, state) {
  let blocks;
  try {
    blocks = JSON.parse(source);
  } catch {
    return [codeBlock(source)];
  }
  const check = checkFence(blocks, state.ids);
  if (check.reason) return [codeBlock(source)];
  for (const id of check.ids) state.ids.add(id);
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
    case 'bullet_list': case 'ordered_list': return list(node);
    case 'fence': case 'code_block': return code(node, state);
    case 'blockquote': return quote(node, state);
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

/**
 * Sibling nodes as blocks, in order, sharing `state` (the ids fences used). `each(n)` runs
 * after a node is read, with the count of blocks before it.
 */
function blocksOf(nodes, state, each) {
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const blocks = block(node, state);
    if (langOf(node) === 'mermaid' && caption(nodes[i + 1])) blocks[0].caption = caption(nodes[++i]);
    each?.(out.length);
    for (const b of blocks) out.push(b);
  }
  return out;
}

// `env` is the parse's: when its work budget ran out while reading a top-level block,
// that block's place is where the plain-text rest starts.
const convert = (nodes, env) =>
  blocksOf(nodes, { ids: new Set() }, (at) => {
    if (env.spent && env.spent.path === undefined) env.spent.path = `/blocks/${at}`;
  });

export { IMPORT_WORK };

/**
 * GFM Markdown as { blocks, notices, work }. `blocks` pass @portable-doc/validate. `work` is
 * the import's count of lines × nesting depth re-scanned. Past IMPORT_WORK.budget the rest
 * of the deeply nested text is kept as plain text, every word, and `notices` holds one
 * { code: IMPORT_WORK.notice, path, work }: the block where that starts, and the count when
 * it did. Never throws.
 */
export function readMarkdown(markdown) {
  const md = typeof markdown === 'string' ? markdown : '';
  const env = {};
  try {
    const blocks = convert(tree(parser.parse(md, env)), env);
    if (validate({ blocks }).ok) {
      const notices = env.spent ? [{ code: IMPORT_WORK.notice, path: env.spent.path, work: env.spent.work }] : [];
      return { blocks, notices, work: env.work ?? 0 };
    }
  } catch {
    // fall through: the text as one code block
  }
  return { blocks: md.trim() === '' ? [] : [codeBlock(md)], notices: [], work: env.work ?? 0 };
}

/** GFM Markdown as PortableDoc blocks that pass @portable-doc/validate: readMarkdown's blocks. Never throws. */
export const fromMarkdown = (markdown) => readMarkdown(markdown).blocks;
