// SPDX-License-Identifier: Apache-2.0
// Inline content (text leaves, marks, links, inline nodes) to Markdown or
// plain text. The inline tree is first flattened into leaves that each carry
// their marks; the leaves are then emitted with the fewest delimiters, so
// neighbouring leaves that share a mark share one `**…**` or one link.

import { MAX_VALUE_DEPTH } from '@portable-doc/validate';
import { TOO_DEEP, asList, codeSpan, escInline, escLineStart, isMap, mdUrl, safeUrl, str } from './util.js';
import { itemOf, readItem } from './read-aliases.js';

const STRONG = { key: 'strong' };
const EM = { key: 'em' };
const STRIKE = { key: 'strike' };
const link = (href) => {
  const url = safeUrl(href);
  return url === null ? null : { key: `link:${url}`, url };
};

/** A text leaf's payload: `value`, else its old name `text`, through the alias table. Any node flattened as text reads so. */
export const leafValue = (n) => str(itemOf(n, 'inline:text', 'value'));

/** An inline code node's text: `value`, else its old name `children` read as flat text, through the alias table. */
export function codeValue(n) {
  const { name, value } = readItem(n, 'inline:code', 'value');
  return name === 'value' ? str(value) : inlineText(value);
}

/**
 * The flat text of an inline tree, no marks. It counts one level for each list and each node, as
 * validate counts a value's levels, against validate's MAX_VALUE_DEPTH: an inline tree sits below
 * the doc's own levels, so no valid doc reaches it. Past it, the too-deep notice in its place.
 */
export function inlineText(nodes, depth = 0) {
  if (depth >= MAX_VALUE_DEPTH) return TOO_DEEP;
  if (typeof nodes === 'string' || typeof nodes === 'number') return str(nodes);
  if (Array.isArray(nodes)) return nodes.map((n) => inlineText(n, depth + 1)).join('');
  if (!isMap(nodes)) return '';
  return leafValue(nodes) || inlineText(nodes.children, depth + 1);
}

/** An inline object's display text: the first non-empty text, title, label, name, value. */
export function objectText(n) {
  for (const k of ['text', 'title', 'label', 'name', 'value']) if (typeof n[k] === 'string' && n[k] !== '') return n[k];
  return '';
}

const markName = (m) => (typeof m === 'string' ? m : isMap(m) ? str(m.type) : '');
const markAttr = (m, k) => {
  if (!isMap(m)) return '';
  const v = (isMap(m.attrs) ? m.attrs[k] : undefined) ?? m[k];
  return typeof v === 'string' ? v : '';
};

const hasLink = (marks) => marks.some((m) => m.url !== undefined);

/** A text leaf's own marks, and the text a replacing mark (tag, blockref, …) puts in its place. */
function leafMarks(node, inherited) {
  let text = leafValue(node);
  let code = false;
  const own = [];
  const raw = asList(node.marks);
  for (let i = raw.length - 1; i >= 0; i--) {
    const m = raw[i];
    switch (markName(m)) {
      case 'bold': case 'strong': own.unshift(STRONG); break;
      case 'italic': case 'em': own.unshift(EM); break;
      case 'strike': case 's': case 'strikethrough': own.unshift(STRIKE); break;
      case 'code': code = true; break;
      case 'link': {
        const l = link(markAttr(m, 'href'));
        if (l && !hasLink(inherited) && !hasLink(own)) own.unshift(l);
        break;
      }
      case 'wikilink': text = markAttr(m, 'alias') || text; break;
      case 'blockref': text = `^${markAttr(m, 'anchor')}`; break;
      case 'tag': text = `#${markAttr(m, 'name')}`; break;
      case 'valueref': text = markAttr(m, 'fallback'); break;
      default: break;
    }
  }
  return { text, code, marks: [...inherited, ...own] };
}

/** Replace a block wrapper inside an inline run (a node with a non-empty `content` list) by its content. */
const unwrap = (nodes) => nodes.flatMap((n) => (isMap(n) && Array.isArray(n.content) && n.content.length ? n.content : [n]));

/**
 * Inline content as leaves, each with the marks over it. It counts levels as inlineText does, one
 * for each list and each node against validate's MAX_VALUE_DEPTH, so no valid doc reaches the cap.
 * Past it, the words above are kept and the too-deep notice is written once, in place of the rest.
 */
function flatten(nodes, marks, out, depth) {
  if (depth >= MAX_VALUE_DEPTH) return void out.push({ text: TOO_DEEP, marks, code: false });
  if (typeof nodes === 'string' || typeof nodes === 'number') return void out.push({ text: str(nodes), marks, code: false });
  if (Array.isArray(nodes)) {
    for (const n of unwrap(nodes)) flatten(n, marks, out, depth + 1);
    return;
  }
  if (!isMap(nodes)) return;
  const n = nodes;
  const kids = (extra) => flatten(asList(n.children), extra ? [...marks, extra] : marks, out, depth + 1);
  const leaf = (text, code = false) => out.push({ text, marks, code });
  switch (str(n.type)) {
    case 'text': return void out.push(leafMarks(n, marks));
    case 'strong': case 'bold': return kids(STRONG);
    case 'em': case 'italic': return kids(EM);
    case 'strike': case 's': case 'strikethrough': return kids(STRIKE);
    case 'underline': return kids(null);
    case 'code': return leaf(codeValue(n), true);
    case 'link': return kids(hasLink(marks) ? null : link(str(n.href)));
    case 'wikilink': return leaf(str(n.alias) || inlineText(n.children) || str(n.target));
    case 'blockref': return leaf(`^${str(n.anchor)}`);
    case 'tag': return leaf(`#${str(n.name)}`);
    case 'chip': return leaf([str(n.text), str(n.note)].filter(Boolean).join(' — '));
    case 'valueref': return leaf(typeof n.resolved === 'string' && n.resolved !== '' ? n.resolved : str(n.fallback));
    default:
      if (asList(n.children).length || 'content' in n) return kids(null);
      return leaf(objectText(n));
  }
}

const OPEN = { strong: '**', em: '*', strike: '~~' };

/** Emit leaves. `md` writes delimiters; plain text writes a link's URL once, after its text. */
function emit(leaves, md) {
  let out = '';
  let pending = '';
  const stack = [];
  const close = (m) => {
    if (m.url === undefined) return void (out += OPEN[m.key]);
    if (md) return void (out += `](${mdUrl(m.url)})`);
    const label = out.slice(m.start).trim();
    if (!m.url.startsWith('#') && label !== m.url && label !== m.url.replace(/^(mailto|tel):/i, '')) out += ` (${m.url})`;
  };
  for (const leaf of leaves) {
    const marks = md ? leaf.marks : leaf.marks.filter((m) => m.url !== undefined);
    const core = leaf.text.trim();
    const lead = leaf.text.slice(0, leaf.text.length - leaf.text.trimStart().length);
    const trail = leaf.text.slice(leaf.text.trimEnd().length);
    if (core === '') {
      pending += leaf.text;
      continue;
    }
    let keep = 0;
    while (keep < stack.length && marks.some((m) => m.key === stack[keep].key)) keep++;
    while (stack.length > keep) close(stack.pop());
    out += pending + lead;
    pending = '';
    for (const m of marks) {
      if (stack.some((s) => s.key === m.key)) continue;
      if (m.url !== undefined) {
        if (md) out += '[';
        stack.push({ ...m, start: out.length });
      } else {
        out += OPEN[m.key];
        stack.push(m);
      }
    }
    out += !md ? core : leaf.code ? codeSpan(core) : escInline(core);
    pending = trail;
  }
  while (stack.length) close(stack.pop());
  return out + pending;
}

/**
 * Inline content as Markdown or plain text. In Markdown a line break becomes a
 * hard break and a blank line a new paragraph, each line escaped against
 * starting a block. With `oneLine` (text placed inside a line: headings, table
 * cells, "Label: value") every break becomes a space and only `lineStart`
 * asks for the line-start escape.
 */
export function renderInline(nodes, md, { oneLine = false, lineStart = false } = {}) {
  const leaves = [];
  flatten(nodes, [], leaves, 0);
  const s = emit(leaves, md).replace(/\r\n?/g, '\n');
  if (oneLine) {
    const flat = s.replace(/\s*\n\s*/g, ' ').trim();
    return md && lineStart ? escLineStart(flat) : flat;
  }
  if (!md) return s.trim();
  return s
    .trim()
    .split(/\n[ \t]*\n\s*/)
    .map((p) => p.split('\n').map((l) => escLineStart(l).trimEnd()).join('\\\n'))
    .join('\n\n');
}
