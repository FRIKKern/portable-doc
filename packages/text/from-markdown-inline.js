// SPDX-License-Identifier: Apache-2.0
// markdown-it's token stream as a tree, the plain text of any part of it, and
// its inline tokens as PortableDoc inline nodes. The node shapes are
// Barkpark's FromMarkdown: strong, em, strikethrough and link carry
// `children`, code carries `value`.

import MarkdownIt from 'markdown-it';
import { MAX_DEPTH, MAX_VALUE_DEPTH } from '@portable-doc/validate';
import { asList, isMap, safeUrl, str } from './util.js';

// Blocks nest in the import as deep as validate allows them, MAX_DEPTH
// (packages/validate/index.js:31): one Markdown level is one format level. A list in a list
// item, and a block in a callout's body, are each one level down, counted together, as
// checkBlock counts them (packages/validate/index.js:224). Past it, the deeper levels are kept as text, with a
// NESTING_KEPT_AS_TEXT notice (from-markdown.js).

// markdown-it builds tokens to `maxNesting` levels (each list, list item and quote
// is one) and skips the lines deeper than that. The limit is set just past what
// MAX_DEPTH lists inside lists need, and the skipped lines are kept as one
// `deep_source` token: their source, with the outer quote and list markers already
// taken off, which flattenText parses when it reaches it. So no words are lost, and
// depth costs no stack: each parse goes PARSE_LEVELS deep at most.
const PARSE_LEVELS = 2 * (MAX_DEPTH + 2);
/** GFM: tables, strikethrough, bare-URL links; raw HTML read so its text can be kept. */
export const parser = new MarkdownIt('default', { html: true, linkify: true, typographer: false, maxNesting: PARSE_LEVELS });
// Every link is parsed, and its URL kept as written; util.js safeUrl decides which become links.
parser.validateLink = () => true;
parser.normalizeLink = (url) => url;

// What markdown-it re-scans, counted as it parses (env.work): each tokenize call adds the
// lines it took and their characters, so a line nested d deep counts d + 1 times, in
// whichever parse reaches it. The import's budget is counted from the text before parsing
// (import-work.js), and the test checks that count is never below this one. This count is
// the net behind it (env.net, shared by the import's parses). The net counts each container
// as it is entered, from the lines it will take, and settles the count when it is done; so
// should the work pass the budget, the container that would pass it is not parsed, at any
// level, the top one included: its text is kept as plain text, every word (flattenText),
// and the import gives a notice with rule 'net'. It fires only where the text's count is
// wrong, so a notice from it is a bug to report.

// markdown-it's own tokenize, except that where it would skip the lines too deep to
// parse (from the first non-blank line in this container to its end), or the net stops
// it, they are kept. Within one call the level does not change, so checking it once on
// entry is the same.
const tokenize = parser.block.tokenize.bind(parser.block);
parser.block.tokenize = (state, startLine, endLine) => {
  const env = state.env;
  env.work ??= 0;
  const line = state.skipEmptyLines(startLine);
  const end = ownEnd(state, line, endLine);
  // The work this call will take, counted on entry: its own lines and their characters.
  const ahead = env.net ? workOf(state, startLine, end) : 0;
  if (env.net) env.net.work += ahead;
  const cut = spent(env);
  if (state.level < state.md.options.maxNesting && !cut) {
    tokenize(state, startLine, endLine);
    const work = workOf(state, startLine, state.line);
    env.work += work;
    if (env.net) env.net.work += work - ahead;
    return;
  }
  if (env.net && !cut) env.net.work -= ahead; // read later, as deep source, and counted then
  if (line >= endLine || state.sCount[line] < state.blkIndent) return void (state.line = line);
  const tok = state.push('deep_source', '', 0);
  tok.content = state.getLines(line, end, state.blkIndent, false);
  tok.meta = env; // the parse's count and net, shared by every parse of its deep source
  tok.map = [(env.base ?? 0) + line, (env.base ?? 0) + end]; // its lines in the whole text, from 0
  tok.cut = cut; // the net stopped it: kept as plain text
  state.line = end;
};

// The lines from startLine to end, and their characters. A list item or quote is given the
// outer end and stops early; bMarks keeps a last entry at the source's end (lineMax is no
// guide, as a quote shrinks it to its own end).
const workOf = (state, startLine, end) =>
  Math.max(0, end - startLine) + Math.max(0, (state.bMarks[end] ?? state.src.length) - state.bMarks[startLine]);

// The end of this container's own lines: a list item is given the outer end, and its own
// lines stop at the first line indented less than it, as markdown-it's own tokenize stops
// there. A quote's lazy lines (sCount -1, markdown-it's mark) are its own.
function ownEnd(state, line, endLine) {
  if (line >= endLine || state.sCount[line] < state.blkIndent) return line;
  let end = line;
  while (end < endLine && (state.isEmpty(end) || state.sCount[end] < 0 || state.sCount[end] >= state.blkIndent)) end++;
  return end;
}

/** Whether the parse's net is past its budget. */
const spent = (env) => env.net !== undefined && env.net.work > env.net.budget;

/** Flat open/close tokens as nodes: { type, tok, children }. Iterative. */
export function tree(tokens, count = undefined) {
  const root = { children: [] };
  const stack = [root];
  for (const tok of asList(tokens)) {
    if (count) count.tokens++;
    if (tok.nesting === -1) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = { type: tok.nesting === 1 ? tok.type.replace(/_open$/, '') : tok.type, tok, children: [] };
    stack.at(-1).children.push(node);
    if (tok.nesting === 1) stack.push(node);
    else if (Array.isArray(tok.children)) node.children = tree(tok.children, count);
  }
  return root.children;
}

export const attr = (node, name) => str(node.tok.attrGet?.(name));

/** The visible text of raw HTML: tags, comments, scripts and styles dropped, entities decoded. Linear. */
export function visibleText(html) {
  const s = str(html);
  const lower = s.toLowerCase();
  let out = '';
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt === -1) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, lt);
    if (lower.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4);
      if (end === -1) break;
      i = end + 3;
      continue;
    }
    const gt = s.indexOf('>', lt + 1);
    if (gt === -1) {
      out += s.slice(lt);
      break;
    }
    const hidden = /^<(script|style)[\s/>]/.exec(lower.slice(lt, lt + 8));
    if (hidden) {
      const close = lower.indexOf(`</${hidden[1]}`, gt + 1);
      const end = close === -1 ? -1 : s.indexOf('>', close);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    i = gt + 1;
  }
  return parser.utils.unescapeAll(out);
}

export const text = (value) => ({ type: 'text', value });

/** Join neighbouring text nodes and drop empty ones. */
export function merge(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'text') {
      if (n.value === '') continue;
      const last = out.at(-1);
      if (last?.type === 'text') {
        out[out.length - 1] = text(last.value + n.value);
        continue;
      }
    }
    out.push(n);
  }
  return out;
}

const BLOCK = new Set(['paragraph', 'heading', 'list_item', 'blockquote', 'th', 'td', 'fence', 'code_block', 'html_block']);
const SEP = Symbol('separator');

/**
 * The raw-text tag an inline HTML token opens or closes: given the tag being
 * skipped (or null), the one skipped after this token. Text inside an inline
 * <script> or <style> is not visible, so it is skipped like the tags.
 */
function rawTag(node, skipping) {
  if (node.type !== 'html_inline') return skipping;
  const m = /^<(\/?)(script|style)\b[^>]*?(\/?)>$/i.exec(str(node.tok.content).trim());
  if (!m) return skipping;
  const name = m[2].toLowerCase();
  if (m[1]) return skipping === name ? null : skipping;
  return skipping ?? (m[3] ? null : name);
}

function leafText(node) {
  switch (node.type) {
    case 'softbreak': return ' ';
    case 'hardbreak': return '\n';
    case 'html_block': return visibleText(node.tok.content);
    case 'html_inline': case 'hr': return '';
    default: return str(node.tok.content);
  }
}

/**
 * The plain text of some nodes, block siblings joined by a space. Iterative, so depth costs no
 * stack; a deep_source is parsed here and its nodes read in its place. `count`, when given,
 * gets each node read on `visits` and each token parsed here on `tokens`.
 */
export function flattenText(nodes, count = undefined) {
  let out = '';
  let skipping = null;
  const stack = [...asList(nodes)].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (node === SEP) {
      skipping = null;
      if (out !== '' && !/\s$/.test(out)) out += ' ';
      continue;
    }
    if (!isMap(node)) continue;
    if (count) count.visits++;
    if (node.type === 'deep_source') {
      const { content, meta: env } = node.tok;
      stack.push(SEP);
      if (node.tok.cut || spent(env)) {
        // The net: the rest as plain text, and the import says so: from which line, and how many.
        const { net } = env;
        net.fired = true;
        net.line = Math.min(net.line ?? Infinity, node.tok.map[0] + 1);
        net.lines = (net.lines ?? 0) + content.replace(/\n+$/, '').split('\n').length;
        if (!skipping) out += `${out === '' || /\s$/.test(out) ? '' : ' '}${content.replace(/\s+/g, ' ').trim()}`;
        continue;
      }
      const base = env.base;
      env.base = node.tok.map[0]; // the deep source's lines count from its first line
      const nodes = tree(parser.parse(content, env), count);
      env.base = base;
      for (let i = nodes.length - 1; i >= 0; i--) stack.push(nodes[i]);
      continue;
    }
    if (BLOCK.has(node.type)) stack.push(SEP);
    if (node.children.length) for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
    else if (node.type === 'html_inline') skipping = rawTag(node, skipping);
    else if (!skipping) out += leafText(node);
  }
  return out;
}

function link(href, children) {
  const url = safeUrl(href);
  if (url === null) return children;
  return [{ type: 'link', href: url, children: children.length ? children : [text(url)] }];
}

// A mark, link or image is a node over a list of children: its own level, the list's and its
// children's, as validate counts a value's levels. It keeps its shape while its children stay within
// MAX_VALUE_DEPTH; past that it is its plain text, and every word is kept. `level` is the level of
// the list the node goes into.
function inlineNode(node, level, past) {
  if (node.children.length && level + 3 > MAX_VALUE_DEPTH) {
    if (past) past.past = true;
    return [text(flattenText([node]))];
  }
  const inner = () => inline(node.children, level + 2, past);
  const wrap = (type) => {
    const children = inner();
    return children.length ? [{ type, children }] : [];
  };
  switch (node.type) {
    case 'text': case 'text_special': return [text(str(node.tok.content))];
    case 'strong': return wrap('strong');
    case 'em': return wrap('em');
    case 's': return wrap('strikethrough');
    case 'code_inline': return [{ type: 'code', value: str(node.tok.content) }];
    case 'softbreak': return [text(' ')];
    case 'hardbreak': return [text('\n')];
    case 'link': return link(attr(node, 'href'), inner());
    case 'image': {
      // An image is a link to it, labelled by its alt text (Barkpark's chat rule), or by its
      // address when that is safe. An unsafe address never shows, not even as text.
      const src = attr(node, 'src');
      const alt = flattenText(node.children) || str(node.tok.content);
      const label = alt || (safeUrl(src) === null ? '' : src);
      return link(src, label ? [text(label)] : []);
    }
    // An inline tag is dropped; the text around it is a token of its own.
    case 'html_inline': return [];
    default: return node.children.length ? inner() : [text(str(node.tok.content))];
  }
}

/**
 * Inline nodes (the children of markdown-it `inline` nodes) as PortableDoc inline content, for a
 * list at value level `level` of the doc object ({ blocks }). Marks kept as text past
 * MAX_VALUE_DEPTH set `past.past`, when `past` is given.
 */
export function inline(nodes, level, past = undefined) {
  const out = [];
  let skipping = null;
  for (const n of asList(nodes)) {
    if (n.type === 'html_inline') {
      skipping = rawTag(n, skipping);
      continue;
    }
    if (skipping) continue;
    for (const node of n.type === 'inline' ? inline(n.children, level, past) : inlineNode(n, level, past)) out.push(node);
  }
  return merge(out);
}
