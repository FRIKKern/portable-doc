// SPDX-License-Identifier: Apache-2.0
// markdown-it's token stream as a tree, the plain text of any part of it, and
// its inline tokens as PortableDoc inline nodes. The node shapes are
// Barkpark's FromMarkdown: strong, em, strikethrough and link carry
// `children`, code carries `value`.

import MarkdownIt from 'markdown-it';
import { asList, isMap, safeUrl, str } from './util.js';

/**
 * Lists inside lists, and inline marks inside marks, deeper than this are kept as
 * their plain text. A list past it becomes the text of the deepest item kept: its
 * items and their blocks one space apart, after the item's own text.
 */
export const MAX_NEST = 50;

// markdown-it builds tokens to `maxNesting` levels (each list, list item and quote
// is one) and skips the lines deeper than that. The limit is set just past what
// MAX_NEST lists inside lists need, and the skipped lines are kept as one
// `deep_source` token: their source, with the outer quote and list markers already
// taken off, which flattenText parses when it reaches it. So no words are lost, and
// depth costs no stack: each parse goes PARSE_LEVELS deep at most.
const PARSE_LEVELS = 2 * (MAX_NEST + 2);
// Parsing deep source again costs markdown-it time per level, and on some lines
// (`- - - - …`) it rescans the rest of the line at each one. So one import parses
// deep source of at most DEEP_PARSE_FACTOR times its own length; past that, the
// rest is kept as its raw text, whitespace collapsed: every word, with any list or
// quote markers in it. Only hostile input, thousands of levels deep, gets there.
const DEEP_PARSE_FACTOR = 4;

/** GFM: tables, strikethrough, bare-URL links; raw HTML read so its text can be kept. */
export const parser = new MarkdownIt('default', { html: true, linkify: true, typographer: false, maxNesting: PARSE_LEVELS });
// Every link is parsed, and its URL kept as written; util.js safeUrl decides which become links.
parser.validateLink = () => true;
parser.normalizeLink = (url) => url;

// markdown-it's own tokenize, except that where it would skip the lines too deep to
// parse (from the first non-blank line in this container to its end) they are kept.
// Within one call the level does not change, so checking it once on entry is the same.
const tokenize = parser.block.tokenize.bind(parser.block);
parser.block.tokenize = (state, startLine, endLine) => {
  if (state.level < state.md.options.maxNesting) return tokenize(state, startLine, endLine);
  const line = state.skipEmptyLines(startLine);
  if (line >= endLine || state.sCount[line] < state.blkIndent) return void (state.line = line);
  const tok = state.push('deep_source', '', 0);
  tok.content = state.getLines(line, endLine, state.blkIndent, false);
  state.env.deepLeft ??= DEEP_PARSE_FACTOR * state.src.length;
  tok.meta = state.env; // the import's budget, shared by every parse of its deep source
  state.line = endLine;
};

/** Flat open/close tokens as nodes: { type, tok, children }. Iterative. */
export function tree(tokens) {
  const root = { children: [] };
  const stack = [root];
  for (const tok of asList(tokens)) {
    if (tok.nesting === -1) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = { type: tok.nesting === 1 ? tok.type.replace(/_open$/, '') : tok.type, tok, children: [] };
    stack.at(-1).children.push(node);
    if (tok.nesting === 1) stack.push(node);
    else if (Array.isArray(tok.children)) node.children = tree(tok.children);
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
 * stack; a deep_source is parsed here and its nodes read in its place.
 */
export function flattenText(nodes) {
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
    if (node.type === 'deep_source') {
      const { content, meta: env } = node.tok;
      stack.push(SEP);
      if (env.deepLeft >= content.length) {
        env.deepLeft -= content.length;
        const nodes = tree(parser.parse(content, env));
        for (let i = nodes.length - 1; i >= 0; i--) stack.push(nodes[i]);
      } else if (!skipping) out += `${out === '' || /\s$/.test(out) ? '' : ' '}${content.replace(/\s+/g, ' ').trim()}`;
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

function inlineNode(node, depth) {
  if (depth >= MAX_NEST) return [text(flattenText([node]))];
  const inner = () => inline(node.children, depth + 1);
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

/** Inline nodes (the children of markdown-it `inline` nodes) as PortableDoc inline content. */
export function inline(nodes, depth = 0) {
  const out = [];
  let skipping = null;
  for (const n of asList(nodes)) {
    if (n.type === 'html_inline') {
      skipping = rawTag(n, skipping);
      continue;
    }
    if (skipping) continue;
    out.push(...(n.type === 'inline' ? inline(n.children, depth) : inlineNode(n, depth)));
  }
  return merge(out);
}
