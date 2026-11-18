// SPDX-License-Identifier: Apache-2.0
// GFM Markdown as PortableDoc blocks. The rules are Barkpark's FromMarkdown
// (api/lib/barkpark/portable_doc/from_markdown.ex); the README lists where
// this one differs. Fail-soft: odd Markdown never throws, and a parser
// failure gives the whole text back as one code block.

import { validate } from '@portable-doc/validate';
import { MAX_NEST, attr, flattenText, inline, merge, parser, text, tree, visibleText } from './from-markdown-inline.js';
import { isMap, safeUrl, str } from './util.js';

const MAX_FENCE_BLOCKS = 50;
// Display blocks a ```portabledoc fence may hold; never fields, forms or bound blocks.
const FENCE_TYPES = new Set([
  'heading', 'paragraph', 'list', 'code', 'table', 'callout', 'divider', 'diagram',
  'chart', 'stat', 'stats', 'heatmap', 'pullquote', 'eyebrow',
]);
const TONES = new Set(['info', 'success', 'warning', 'danger', 'neutral']);
const TONE_ALIASES = { note: 'info', warn: 'warning', error: 'danger' };
const LISTS = new Set(['bullet_list', 'ordered_list']);

const codeBlock = (value, lang) => (lang ? { type: 'code', value, lang } : { type: 'code', value });
const paragraph = (content) => (content.length ? [{ type: 'paragraph', content }] : []);
const textOf = (node) => (node.type === 'paragraph' || node.type === 'heading' ? inline(node.children) : [text(flattenText([node]).trim())]);

// ── lists ───────────────────────────────────────────────────────────────

/** A list item as one inline run: its blocks joined by a space, a nested list's items each after " — ". */
function itemInline(item, depth) {
  const out = [];
  for (const child of item.children) {
    if (LISTS.has(child.type)) {
      for (const sub of child.children) {
        out.push(text(' — '), ...(depth >= MAX_NEST ? [text(flattenText([sub]))] : itemInline(sub, depth + 1)));
      }
      continue;
    }
    if (out.length) out.push(text(' '));
    if (child.type === 'fence' || child.type === 'code_block') out.push({ type: 'code', value: str(child.tok.content).replace(/\n+$/, '') });
    else out.push(...textOf(child));
  }
  return merge(out);
}

// `[ ] rest` / `[x] rest` at the head of an item: { content, checked }, else null.
function taskItem(content) {
  const first = content[0];
  const m = first?.type === 'text' ? /^\[( |x|X)\]\s+(.*)$/s.exec(first.value) : null;
  if (!m) return null;
  const rest = m[2] === '' && content.length === 1 ? [] : merge([text(m[2]), ...content.slice(1)]);
  return { content: rest, checked: m[1] !== ' ' };
}

function list(node) {
  const ordered = node.type === 'ordered_list';
  const items = node.children.filter((c) => c.type === 'list_item').map((li) => itemInline(li, 0));
  // GitHub task syntax (`- [ ] `, `- [x] `) makes the whole bullet list a checklist.
  const tasks = ordered ? [] : items.map(taskItem);
  if (tasks.some(Boolean)) {
    return { type: 'list', ordered: false, task: true, items: items.map((content, i) => tasks[i] ?? { content, checked: false }) };
  }
  const block = { type: 'list', ordered, items };
  const start = Number(attr(node, 'start') || 1);
  if (ordered && Number.isSafeInteger(start) && start !== 1) block.start = start;
  return block;
}

// ── quotes and callouts ─────────────────────────────────────────────────

const quoteContent = (children) => merge(children.flatMap((c, i) => [...(i ? [text(' ')] : []), ...textOf(c)]));

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
  const marker = calloutMarker(quoteContent(children));
  if (marker) return [{ type: 'callout', tone: marker.tone, content: marker.rest }];
  // A last paragraph "— Name" is the quote's cite, as toMarkdown writes it.
  const last = children.at(-1);
  const cite = children.length > 1 && last.type === 'paragraph' ? /^— (.+)$/s.exec(flattenText([last]).trim()) : null;
  if (cite) return [{ type: 'blockquote', content: quoteContent(children.slice(0, -1)), cite: cite[1] }];
  return [{ type: 'blockquote', content: quoteContent(children) }];
}

// ── code fences ─────────────────────────────────────────────────────────

/** Every non-blank block id in a parsed fence, or null when an `href` in it is unsafe. Iterative. */
function scan(value) {
  const ids = [];
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (!isMap(v) && !Array.isArray(v)) continue;
    if (isMap(v)) {
      if (typeof v.id === 'string' && v.id.trim() !== '' && typeof v.type === 'string') ids.push(v.id);
      if ('href' in v && safeUrl(v.href) === null) return null;
    }
    for (const child of Object.values(v)) stack.push(child);
  }
  return ids;
}

// A ```portabledoc fence holds a JSON array of blocks, spliced in when it is
// 1 to 50 blocks of the allowed types that validate, link only to safe URLs
// and reuse no id from an earlier fence. Anything else is a plain code block.
function fence(source, state) {
  let blocks;
  try {
    blocks = JSON.parse(source);
  } catch {
    return [codeBlock(source)];
  }
  const fits =
    Array.isArray(blocks) &&
    blocks.length > 0 &&
    blocks.length <= MAX_FENCE_BLOCKS &&
    blocks.every((b) => isMap(b) && FENCE_TYPES.has(b.type)) &&
    validate(blocks).ok;
  const ids = fits ? scan(blocks) : null;
  if (ids === null || ids.some((id) => state.ids.has(id))) return [codeBlock(source)];
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
    case 'heading': return [{ type: 'heading', level: Math.min(6, Math.max(1, Number(node.tok.tag.slice(1)) || 1)), text: flattenText(node.children) }];
    case 'paragraph': return paragraph(inline(node.children));
    case 'bullet_list': case 'ordered_list': return [list(node)];
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

function convert(nodes) {
  const state = { ids: new Set() };
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const blocks = block(node, state);
    if (langOf(node) === 'mermaid' && caption(nodes[i + 1])) blocks[0].caption = caption(nodes[++i]);
    for (const b of blocks) out.push(b);
  }
  return out;
}

/** GFM Markdown as PortableDoc blocks that pass @portable-doc/validate. Never throws. */
export function fromMarkdown(markdown) {
  const md = typeof markdown === 'string' ? markdown : '';
  try {
    const blocks = convert(tree(parser.parse(md, {})));
    if (validate({ blocks }).ok) return blocks;
  } catch {
    // fall through: the text as one code block
  }
  return md.trim() === '' ? [] : [codeBlock(md)];
}
