// SPDX-License-Identifier: Apache-2.0
// markdown-it's token stream as a tree, the plain text of any part of it, and
// its inline tokens as PortableDoc inline nodes. The node shapes are
// Barkpark's FromMarkdown: strong, em, strikethrough and link carry
// `children`, code carries `value`.

import MarkdownIt from 'markdown-it';
import { asList, isMap, safeUrl, str } from './util.js';

/** Inline nesting deeper than this is kept as its plain text. */
export const MAX_NEST = 50;

/** GFM: tables, strikethrough, bare-URL links; raw HTML read so its text can be kept. */
export const parser = new MarkdownIt('default', { html: true, linkify: true, typographer: false });
// Every link is parsed, and its URL kept as written; util.js safeUrl decides which become links.
parser.validateLink = () => true;
parser.normalizeLink = (url) => url;

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

function leafText(node) {
  switch (node.type) {
    case 'softbreak': return ' ';
    case 'hardbreak': return '\n';
    case 'html_block': return visibleText(node.tok.content);
    case 'html_inline': case 'hr': return '';
    default: return str(node.tok.content);
  }
}

/** The plain text of some nodes, block siblings joined by a space. Iterative, so depth costs no stack. */
export function flattenText(nodes) {
  let out = '';
  const stack = [...asList(nodes)].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (node === SEP) {
      if (out !== '' && !/\s$/.test(out)) out += ' ';
      continue;
    }
    if (!isMap(node)) continue;
    if (BLOCK.has(node.type)) stack.push(SEP);
    if (node.children.length) for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
    else out += leafText(node);
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
      // An image is a link to it, labelled by its alt text (Barkpark's chat rule).
      const src = attr(node, 'src');
      const alt = flattenText(node.children) || str(node.tok.content);
      return link(src, [text(alt || src)]);
    }
    // An inline tag is dropped; the text around it is a token of its own.
    case 'html_inline': return [];
    default: return node.children.length ? inner() : [text(str(node.tok.content))];
  }
}

/** Inline nodes (the children of markdown-it `inline` nodes) as PortableDoc inline content. */
export function inline(nodes, depth = 0) {
  return merge(asList(nodes).flatMap((n) => (n.type === 'inline' ? inline(n.children, depth) : inlineNode(n, depth))));
}
