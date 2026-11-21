// SPDX-License-Identifier: Apache-2.0
// GFM Markdown as PortableDoc blocks. The rules are Barkpark's FromMarkdown
// (api/lib/barkpark/portable_doc/from_markdown.ex); the README lists where
// this one differs. Fail-soft: odd Markdown never throws, and a parser
// failure gives the whole text back as one code block.

import { MAX_DEPTH, MAX_VALUE_DEPTH, validate, walkDepth } from '@portable-doc/validate';
import { everyBlockAllowed } from './fence-blocks.js';
import { IMPORT_WORK, planText } from './import-work.js';
import { attr, flattenText, inline, merge, parser, text, tree, visibleText, WORDS_ONLY } from './from-markdown-inline.js';
import { renderInline } from './inline.js';
import { currentNames } from './current-names.js';
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
// `level` is the value level of the list the text goes into (inline); `count`, when given, gets the
// nodes read on `visits` (a paragraph or heading is one); `past` gets `past: true` when marks past
// MAX_VALUE_DEPTH are kept as text (inline).
function textOf(node, level, count = undefined, past = undefined) {
  if (node.type !== 'paragraph' && node.type !== 'heading') return [text(flattenText([node], count).trim())];
  if (count) count.visits++;
  return inline(node.children, level, past);
}

// ── lists ───────────────────────────────────────────────────────────────

export const LIST_ITEM_SPLIT = 'list_item_split';
/** The code of the notice that the import fell back to keeping the whole text as one code block. */
export const IMPORT_FELL_BACK = 'import_fell_back';
/** The code of the notice that a fence's block held a field under two names with different values, and the import kept one. */
export const OLD_NAME_DROPPED = 'old_name_dropped';
/**
 * The code of the notice that a block holds, as text, levels nested past the import's limits:
 * blocks past MAX_DEPTH, or marks past MAX_VALUE_DEPTH. Every word is kept.
 */
export const NESTING_KEPT_AS_TEXT = 'nesting_kept_as_text';
// The notice for the block at `path`, from its token: its source lines, the first from 1.
function keptAsText(path, tok, base) {
  const line = lineOf(tok, 0, base) ?? base;
  return { code: NESTING_KEPT_AS_TEXT, path, line: line + 1, lines: (lineOf(tok, 1, base) ?? line + 1) - line };
}

// A token's line in the whole text, from 0: its parse starts at `base`. An item's own blocks
// are read in one tokenize call, at one level, so none after a kept nested list is deep source
// (whose map is the whole text's already).
const lineOf = (tok, i, base) => (tok.map ? base + tok.map[i] : undefined);

/**
 * A list item as one or more items: its blocks joined by a space as one inline run, and its
 * nested lists kept as lists. Text after a kept nested list starts a new item at the same
 * level, so the words stay in source order: an item's text always comes before its children.
 * Each new item carries `moved`, the source lines of its text: [first, end), from 0.
 * In a list MAX_DEPTH - 1 deep (the deepest validate allows), a nested list is kept as its text
 * instead: its items and their blocks one space apart, joined to the item's own text by one
 * space, in place; a list with no text adds nothing. A part that keeps such text, or marks
 * past MAX_VALUE_DEPTH, has `past`. `depth` is the list's own, from 0 at the top of the doc;
 * `base` is the line the parse starts at; `level` is the list block's value level. An item's text
 * is counted at the level it has in an item that holds nested lists, { content, children }: one
 * deeper than an item that is its content alone, so it fits either way.
 */
function listItem(item, depth, base, level) {
  const parts = [];
  let part = { out: [], children: [], notes: [], past: false };
  let after; // the line after the last kept nested list, while the part has one
  const close = () => parts.push({ content: merge(part.out), children: part.children, notes: part.notes, moved: part.moved, past: part.past });
  for (const child of item.children) {
    if (LISTS.has(child.type)) {
      if (depth + 1 < MAX_DEPTH) {
        const notes = [];
        const kept = list(child, depth + 1, notes, base, level + 4);
        for (const n of notes) part.notes.push({ ...n, path: `/children/${part.children.length}${n.path}` });
        for (const block of kept) part.children.push(block);
        if (kept.length) after = lineOf(child.tok, 1, base) ?? after;
      } else {
        const flat = flattenText([child]).trim();
        if (flat) {
          if (part.out.length) part.out.push(text(' '));
          part.out.push(text(flat));
          part.past = true;
        }
      }
      continue;
    }
    if (part.children.length) {
      close();
      const first = lineOf(child.tok, 0, base) ?? after ?? base;
      part = { out: [], children: [], notes: [], moved: [first, first], past: false };
      after = undefined;
    }
    if (part.moved) part.moved[1] = lineOf(child.tok, 1, base) ?? lineOf(item.tok, 1, base) ?? part.moved[1];
    if (part.out.length) part.out.push(text(' '));
    if (child.type === 'fence' || child.type === 'code_block') part.out.push({ type: 'code', value: str(child.tok.content).replace(/\n+$/, '') });
    else for (const node of textOf(child, level + 3, undefined, part)) part.out.push(node);
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
 * adds a LIST_ITEM_SPLIT notice to `notes`, its path from the list block, in source order, and
 * a list with an item that keeps deeper levels as text (`past`) adds one NESTING_KEPT_AS_TEXT
 * notice for itself, before its items' notices.
 */
function list(node, depth, notes, base, level) {
  const ordered = node.type === 'ordered_list';
  const items = node.children
    .filter((c) => c.type === 'list_item')
    .flatMap((li) => listItem(li, depth, base, level))
    // `[ ]` opens a task only at the head of an item in the source, never of a split-off one
    .map((it) => ({ ...it, task: ordered || it.moved ? null : taskItem(it.content) }))
    .filter((it) => it.children.length || !blank(it.task?.content ?? it.content));
  if (!items.length) return [];
  if (items.some((it) => it.past)) notes.push(keptAsText('', node.tok, base));
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

// A quote's last paragraph "— Name": its cite.
const CITE = /^— (.+)$/s;

/**
 * A quote. With a `[!tone]` marker at the head of its first paragraph it is a callout: that
 * paragraph is its content, and every block after it is read as blocks into `slots.body`,
 * fences and all. A plain quote holds inline content only, so it stays one run of all its text.
 * A callout MAX_DEPTH - 1 deep keeps its body as text too, joined to its content, as a list
 * that deep does: the doc stays within the depth validate allows, and the callout gets a
 * NESTING_KEPT_AS_TEXT notice (convert). Each child's text is read once, and a callout's body
 * only as blocks, so no part of the tree is read twice.
 */
function quote(node, state) {
  const children = node.children;
  const first = children.length ? textOf(children[0], state.level + 1, state.count, state.past) : [];
  const marker = calloutMarker(first);
  if (marker && state.depth + 1 < MAX_DEPTH) {
    const { at, blocks } = state;
    state.depth++;
    state.level += 3; // the callout's slots, its body, and the body's blocks
    state.blocks = `${at}/slots/body`;
    const body = convert(children.slice(1), state);
    state.blocks = blocks;
    state.level -= 3;
    state.depth--;
    const callout = { type: 'callout', tone: marker.tone, content: marker.rest };
    return [body.length ? { ...callout, slots: { body } } : callout];
  }
  const parts = [first, ...children.slice(1).map((child) => textOf(child, state.level + 1, state.count, state.past))];
  const content = joined(parts);
  if (marker) {
    if (children.length > 1) state.past.past = true;
    return [{ type: 'callout', tone: marker.tone, content: calloutMarker(content).rest }];
  }
  // A last paragraph "— Name" is the quote's cite, as toMarkdown writes it. Its words decide that;
  // the cite is its text, with the address an empty link in it shows.
  const last = children.at(-1);
  const said = children.length > 1 && last.type === 'paragraph' ? CITE.exec(flattenText([last], undefined, WORDS_ONLY).trim()) : null;
  const cite = said && (CITE.exec(flattenText([last]).trim()) ?? said)[1];
  if (cite) return [{ type: 'blockquote', content: joined(parts.slice(0, -1)), cite }];
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
// Anything else is a plain code block. A spliced block's old names (alias-table.js) are folded into
// their current names by the rule every reader uses (current-names.js), where the readers read
// blocks, and each value that fold loses adds an OLD_NAME_DROPPED notice. A fence kept as a code
// block adds one notice naming why (FENCE_KEPT_AS_CODE).

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
  // Counted again with old names under their current names, as the fence imports: a string read
  // as inline content is two levels deeper. A valid fence's blocks nest at most MAX_DEPTH deep,
  // so today no fold reaches MAX_VALUE_DEPTH (fence-notice.test.mjs holds that bound); this holds
  // the rule if those limits move.
  if (tooDeep(currentNames(blocks))) return { reason: 'depth' };
  if (ids.some((id) => usedIds.has(id))) return { reason: 'id' };
  return { ids };
}

/**
 * The code of the notice for each reason a ```portabledoc fence stays a code block, by checkFence's
 * reason ('json' when the fence is not JSON), and the fix the notice gives.
 */
export const FENCE_KEPT_AS_CODE = Object.freeze({
  json: Object.freeze({ code: 'fence_not_json', fix: 'write the fence as a JSON array of blocks' }),
  count: Object.freeze({ code: 'fence_block_count', fix: `write a JSON array of 1 to ${MAX_FENCE_BLOCKS} blocks in the fence` }),
  depth: Object.freeze({ code: 'fence_too_deep', fix: `nest the blocks at most ${MAX_VALUE_DEPTH} JSON levels deep, counted with old names under their current names` }),
  type: Object.freeze({ code: 'fence_block_type', fix: `use only these block types in a fence: ${[...FENCE_TYPES].join(', ')}` }),
  address: Object.freeze({ code: 'fence_unsafe_address', fix: 'use an http, https, mailto or tel address, or a link inside the document, in href, src, poster and url' }),
  invalid: Object.freeze({ code: 'fence_invalid', fix: 'fix the blocks until validate accepts them' }),
  id: Object.freeze({ code: 'fence_id_used', fix: 'give each block an id no earlier fence uses' }),
});

function fence(source, node, state) {
  // The fence's lines, its opening and closing ones too; its blocks start at the import's place.
  const first = lineOf(node.tok, 0, state.base) ?? state.base;
  const lines = (lineOf(node.tok, 1, state.base) ?? first + 1) - first;
  // A fence the import does not splice stays a code block, with one notice: why, and the fix.
  const kept = (reason) => {
    const { code, fix } = FENCE_KEPT_AS_CODE[reason];
    state.splits.push({ code, path: state.at, line: first + 1, lines, fix });
    return [codeBlock(source)];
  };
  let blocks;
  try {
    blocks = JSON.parse(source);
  } catch {
    return kept('json');
  }
  const check = checkFence(blocks, state.ids);
  if (check.reason) return kept(check.reason);
  for (const id of check.ids) state.ids.add(id);
  const dir = state.at.slice(0, state.at.lastIndexOf('/'));
  const start = Number(state.at.slice(state.at.lastIndexOf('/') + 1));
  const drop = ({ path, name, field }) => state.splits.push({ code: OLD_NAME_DROPPED, path, line: first + 1, lines, name, current: field, fix: `write ${field}` });
  return blocks.map((b, j) => currentNames(b, drop, `${dir}/${start + j}`));
}

// A fence's language: the first word of its info string.
const langOf = (node) => (node.type === 'fence' ? str(node.tok.info).trim().split(/\s+/)[0] : '');

function code(node, state) {
  const source = str(node.tok.content).replace(/\n+$/, '');
  const lang = langOf(node);
  if (lang === 'mermaid') return [{ type: 'diagram', source }];
  if (lang === 'portabledoc') return fence(source, node, state);
  return [codeBlock(source, lang)];
}

// ── blocks ──────────────────────────────────────────────────────────────

// A table at value level `level`: its head's cells are two levels down (head, cell), its rows' three
// (rows, row, cell).
function table(node, past, level) {
  const rows = (section, cell) =>
    node.children
      .filter((c) => c.type === section)
      .flatMap((s) => s.children.filter((r) => r.type === 'tr'))
      .map((r) => r.children.filter((c) => c.type === 'th' || c.type === 'td').map((c) => inline(c.children, cell, past)));
  const head = rows('thead', level + 2)[0];
  return head ? { type: 'table', head, rows: rows('tbody', level + 3) } : { type: 'table', rows: rows('tbody', level + 3) };
}

function block(node, state) {
  switch (node.type) {
    case 'heading': {
      // Inline content under the canonical name, marks and links kept, as a paragraph's.
      const content = inline(node.children, state.level + 1, state.past);
      return blank(content) ? [] : [{ type: 'heading', level: Math.min(6, Math.max(1, Number(node.tok.tag.slice(1)) || 1)), content }];
    }
    case 'paragraph': return paragraph(inline(node.children, state.level + 1, state.past));
    case 'bullet_list': case 'ordered_list': {
      const notes = [];
      const out = list(node, state.depth, notes, state.base, state.level);
      for (const n of notes) state.splits.push({ ...n, path: `${state.at}${n.path}` });
      return out;
    }
    case 'fence': case 'code_block': return code(node, state);
    case 'blockquote': return quote(node, state);
    case 'table': return [table(node, state.past, state.level)];
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

// A paragraph that is one emphasised run of words, right after a diagram, is its caption: its
// text, with the address an empty link in it shows.
function caption(node) {
  if (node?.type !== 'paragraph') return '';
  const runs = node.children.flatMap((c) => c.children).filter((c) => !(c.type === 'text' && c.tok.content === ''));
  if (runs.length !== 1 || runs[0].type !== 'em' || !flattenText(runs[0].children, undefined, WORDS_ONLY).trim()) return '';
  return flattenText(runs[0].children).trim();
}

/**
 * A read's state: the ids fences used, how many callouts deep the read is (quote()), and its
 * count: the tokens markdown-it made and the nodes read, so a test sees no part read twice.
 * `splits` holds a LIST_ITEM_SPLIT notice per list item split off, an OLD_NAME_DROPPED one per
 * value a fence's fold lost, one per fence kept as a code block (FENCE_KEPT_AS_CODE) and a
 * NESTING_KEPT_AS_TEXT one per block that keeps deeper levels as text, in source order; `blocks` is the path of the blocks being read, `at` the block's, `past`
 * the block's mark that it keeps such text (convert), `base` the line the parse starts at, and
 * `level` the value level of the blocks being read, counted as validate counts a doc object
 * ({ blocks }): the doc, its blocks, and a top-level block at 3.
 */
const readState = () => ({ ids: new Set(), depth: 0, level: 3, count: { tokens: 0, visits: 0 }, splits: [], blocks: '/blocks', at: '/blocks', base: 0 });

// Each block of `nodes` onto `out`, sharing `state`: the ids fences used, and how many callouts
// deep they are. Where the net first fires, its path is the block's place. A block that keeps
// deeper levels as text gets its notice ahead of any its body's blocks add.
function convert(nodes, state, out = [], net = undefined) {
  const outer = state.past;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    state.count.visits++;
    const at = (state.at = `${state.blocks}/${out.length}`);
    const past = (state.past = { past: false });
    const slot = state.splits.length;
    const blocks = block(node, state);
    state.past = outer;
    if (past.past) state.splits.splice(slot, 0, keptAsText(at, node.tok, state.base));
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
 * first from 1, and how many). Each value a fence's block loses when its old names fold into
 * their current names adds one { code: OLD_NAME_DROPPED, path, line, lines, name, current, fix }:
 * the dropped key's path, the fence's source lines, the name dropped, the current name, and the
 * fix, `write <current>`. Each block that keeps, as text, levels nested past the limits (blocks
 * past validate's MAX_DEPTH, marks past MAX_VALUE_DEPTH) adds one { code: NESTING_KEPT_AS_TEXT,
 * path, line, lines }: the block, and its source lines. Each ```portabledoc fence at block level
 * kept as a code block adds one { code, path, line, lines, fix } (FENCE_KEPT_AS_CODE): the code
 * naming why, the code block, the fence's source lines and the fix. A fence inside a list item is
 * read as inline code in the item and adds no notice yet. The notices come by kind: 'budget' and
 * 'line', then the splits, dropped names, fences kept as code and nesting kept as text in source
 * order, then 'net'. Should the read throw or give blocks that do not validate, the
 * whole text is kept as one code block with one { code: IMPORT_FELL_BACK, path, line, lines }
 * notice and no other. Never throws.
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
  // The last resort keeps the text whole, and always says so.
  const blocks = md.trim() === '' ? [] : [codeBlock(md)];
  const notice = { code: IMPORT_FELL_BACK, path: blocks.length ? '/blocks/0' : '/blocks', line: 1, lines: md.replace(/\n$/, '').split('\n').length };
  return { blocks, notices: [notice], work: plan.work };
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
