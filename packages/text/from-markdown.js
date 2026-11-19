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
// `count`, when given, gets the nodes read on `visits` (a paragraph or heading is one).
function textOf(node, count = undefined) {
  if (node.type !== 'paragraph' && node.type !== 'heading') return [text(flattenText([node], count).trim())];
  if (count) count.visits++;
  return inline(node.children);
}

// ── lists ───────────────────────────────────────────────────────────────

export const LIST_ITEM_SPLIT = 'list_item_split';

// A token's line in the whole text, from 0: its parse starts at `base`. An item's own blocks
// are read in one tokenize call, at one level, so none after a kept nested list is deep source
// (whose map is the whole text's already).
const lineOf = (tok, i, base) => (tok.map ? base + tok.map[i] : undefined);

/**
 * A list item as one or more items: its blocks joined by a space as one inline run, and its
 * nested lists kept as lists. Text after a kept nested list starts a new item at the same
 * level, so the words stay in source order: an item's text always comes before its children.
 * Each new item carries `moved`, the source lines of its text: [first, end), from 0.
 * In an item at depth MAX_NEST, a nested list is kept as its text instead (Barkpark's
 * @max_nest rule): its items and their blocks one space apart, joined to the item's own
 * text by one space, in place; a list with no text adds nothing. `base` is the line the
 * parse starts at.
 */
function listItem(item, depth, base) {
  const parts = [];
  let part = { out: [], children: [], notes: [] };
  let after; // the line after the last kept nested list, while the part has one
  const close = () => parts.push({ content: merge(part.out), children: part.children, notes: part.notes, moved: part.moved });
  for (const child of item.children) {
    if (LISTS.has(child.type)) {
      if (depth < MAX_NEST) {
        const notes = [];
        const kept = list(child, depth + 1, notes, base);
        for (const n of notes) part.notes.push({ ...n, path: `/children/${part.children.length}${n.path}` });
        part.children.push(...kept);
        if (kept.length) after = lineOf(child.tok, 1, base) ?? after;
      } else {
        const flat = flattenText([child]).trim();
        if (flat) part.out.push(...(part.out.length ? [text(' ')] : []), text(flat));
      }
      continue;
    }
    if (part.children.length) {
      close();
      const first = lineOf(child.tok, 0, base) ?? after ?? base;
      part = { out: [], children: [], notes: [], moved: [first, first] };
      after = undefined;
    }
    if (part.moved) part.moved[1] = lineOf(child.tok, 1, base) ?? lineOf(item.tok, 1, base) ?? part.moved[1];
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
function list(node, depth = 0, notes = [], base = 0) {
  const ordered = node.type === 'ordered_list';
  const items = node.children
    .filter((c) => c.type === 'list_item')
    .flatMap((li) => listItem(li, depth, base))
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

/**
 * A quote. With a `[!tone]` marker at the head of its first paragraph it is a callout: that
 * paragraph is its content, and every block after it is read as blocks into `slots.body`,
 * fences and all. A plain quote holds inline content only, so it stays one run of all its text.
 * A callout MAX_NEST callouts deep keeps its body as text too, joined to its content, as a
 * list that deep does: the doc stays within the depth validate allows. Each child's text is
 * read once, and a callout's body only as blocks, so no part of the tree is read twice.
 */
function quote(node, state) {
  const children = node.children;
  const first = children.length ? textOf(children[0], state.count) : [];
  const marker = calloutMarker(first);
  if (marker && state.depth < MAX_NEST) {
    const { at, blocks } = state;
    state.depth++;
    state.blocks = `${at}/slots/body`;
    const body = convert(children.slice(1), state);
    state.blocks = blocks;
    state.depth--;
    const callout = { type: 'callout', tone: marker.tone, content: marker.rest };
    return [body.length ? { ...callout, slots: { body } } : callout];
  }
  const parts = [first, ...children.slice(1).map((child) => textOf(child, state.count))];
  const content = joined(parts);
  if (marker) return [{ type: 'callout', tone: marker.tone, content: calloutMarker(content).rest }];
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
    case 'bullet_list': case 'ordered_list': {
      const notes = [];
      const out = list(node, 0, notes, state.base);
      for (const n of notes) state.splits.push({ ...n, path: `${state.at}${n.path}` });
      return out;
    }
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
 * A read's state: the ids fences used, how many callouts deep the read is (quote()), and its
 * count: the tokens markdown-it made and the nodes read, so a test sees no part read twice.
 * `splits` holds a LIST_ITEM_SPLIT notice per list item split off; `blocks` is the path of the
 * blocks being read, `at` the block's, and `base` the line the parse starts at.
 */
const readState = () => ({ ids: new Set(), depth: 0, count: { tokens: 0, visits: 0 }, splits: [], blocks: '/blocks', at: '/blocks', base: 0 });

// Each block of `nodes` onto `out`, sharing `state`: the ids fences used, and how many callouts
// deep they are. Where the net first fires, its path is the block's place.
function convert(nodes, state, out = [], net = undefined) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    state.count.visits++;
    state.at = `${state.blocks}/${out.length}`;
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
 * kept so, `lines` how many. Each list item split off at text after its nested list adds one
 * { code: LIST_ITEM_SPLIT, path, line, lines }: the new item, and its text's source lines (the
 * first from 1, and how many), in source order. Never throws.
 */
export function readMarkdown(markdown, limits = IMPORT_WORK) {
  const md = typeof markdown === 'string' ? markdown : '';
  let plan = { work: 0, parts: [], notices: [] };
  try {
    plan = planText(md, limits);
    const read = readPlan(plan, limits);
    if (read) return { blocks: read.blocks, notices: read.notices, work: plan.work };
  } catch {
    // fall through: the text as one code block
  }
  return { blocks: md.trim() === '' ? [] : [codeBlock(md)], notices: [], work: plan.work };
}

/**
 * A plan from planText as { blocks, notices }, or null when the blocks do not validate. Each
 * part read is a fresh document for markdown-it; the net's count runs across them all. The
 * import-work test also reads a plan made with a wrong count here, to see the net catch it;
 * `parsed` is markdown-it's own count and `count` the read's (readState), for the tests.
 */
export function readPlan(plan, limits) {
  const state = readState();
  const net = { work: 0, budget: limits.budget };
  const blocks = [];
  const paths = {};
  for (const part of plan.parts) {
    state.base = part.line;
    if (part.read !== undefined) convert(tree(parser.parse(part.read, { net, base: part.line }), state.count), state, blocks, net);
    else {
      paths[part.rule] ??= `/blocks/${blocks.length}`;
      blocks.push({ type: 'paragraph', content: [text(part.plain)] });
    }
  }
  if (!validate({ blocks }).ok) return null;
  const notices = plan.notices.map(({ rule, line, lines }) => ({ code: limits.notice, rule, path: paths[rule], line, lines }));
  for (const split of state.splits) notices.push(split); // a loop: a spread of this many arguments overflows the stack
  if (net.fired) notices.push({ code: limits.notice, rule: 'net', path: net.path ?? `/blocks/${Math.max(0, blocks.length - 1)}`, line: net.line, lines: net.lines });
  return { blocks, notices, parsed: net.work, count: state.count };
}

/** GFM Markdown as PortableDoc blocks that pass @portable-doc/validate: readMarkdown's blocks. Never throws. */
export const fromMarkdown = (markdown) => readMarkdown(markdown).blocks;

/** For the import-work test: what markdown-it re-scans to read `markdown` whole, deep source included. */
export function parsedWork(markdown) {
  const env = {};
  convert(tree(parser.parse(markdown, env)), readState());
  return env.work ?? 0;
}
