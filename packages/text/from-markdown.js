// SPDX-License-Identifier: Apache-2.0
// GFM Markdown as PortableDoc blocks. The rules are Barkpark's FromMarkdown
// (api/lib/barkpark/portable_doc/from_markdown.ex); the README lists where
// this one differs. Fail-soft: odd Markdown never throws, and a parser
// failure gives the whole text back as one code block.

import { Marked } from 'marked';
import { validate } from '@portable-doc/validate';
import { MAX_NEST, flattenText, inline, merge, text, visibleText } from './from-markdown-inline.js';
import { asList, isMap, safeUrl, str } from './util.js';

const parser = new Marked({ gfm: true, breaks: false, pedantic: false });

const MAX_FENCE_BLOCKS = 50;
// Display blocks a ```portabledoc fence may hold; never fields, forms or bound blocks.
const FENCE_TYPES = new Set([
  'heading', 'paragraph', 'list', 'code', 'table', 'callout', 'divider', 'diagram',
  'chart', 'stat', 'stats', 'heatmap', 'pullquote', 'eyebrow',
]);
const TONES = new Set(['info', 'success', 'warning', 'danger', 'neutral']);
const TONE_ALIASES = { note: 'info', warn: 'warning', error: 'danger' };

const codeBlock = (value, lang) => (lang ? { type: 'code', value, lang } : { type: 'code', value });
const paragraph = (content) => (content.length ? [{ type: 'paragraph', content }] : []);
const live = (tokens) => asList(tokens).filter((t) => isMap(t) && t.type !== 'space');

// ── lists ───────────────────────────────────────────────────────────────

/** A list item as one inline run: its paragraphs joined by a space, a nested list's items each after " — ". */
function itemInline(item, depth) {
  const out = [];
  for (const tok of live(item.tokens)) {
    if (tok.type === 'checkbox') continue;
    if (tok.type === 'list') {
      for (const sub of asList(tok.items)) {
        out.push(text(' — '), ...(depth >= MAX_NEST ? [text(flattenText(sub.tokens))] : itemInline(sub, depth + 1)));
      }
      continue;
    }
    if (out.length) out.push(text(' '));
    if (tok.type === 'paragraph' || tok.type === 'text' || tok.type === 'heading') out.push(...inline(tok.tokens ?? [tok]));
    else if (tok.type === 'code') out.push({ type: 'code', value: str(tok.text) });
    else out.push(text(flattenText([tok])));
  }
  return merge(out);
}

function list(tok) {
  const ordered = tok.ordered === true;
  const items = asList(tok.items).filter(isMap).map((item) => ({ item, content: itemInline(item, 0) }));
  // GitHub task syntax (`- [ ] `, `- [x] `) makes the whole bullet list a checklist.
  if (!ordered && items.some(({ item }) => item.task)) {
    return { type: 'list', ordered: false, task: true, items: items.map(({ item, content }) => ({ content, checked: item.task === true && item.checked === true })) };
  }
  const block = {
    type: 'list',
    ordered,
    items: items.map(({ item, content }) => (ordered && item.task ? merge([text(item.checked ? '[x] ' : '[ ] '), ...content]) : content)),
  };
  if (ordered && Number.isInteger(tok.start) && tok.start !== 1) block.start = tok.start;
  return block;
}

// ── quotes and callouts ─────────────────────────────────────────────────

const quoteContent = (children) =>
  merge(children.flatMap((k, i) => [...(i ? [text(' ')] : []), ...(k.type === 'paragraph' ? inline(k.tokens) : [text(flattenText([k]))])]));

// `[!type]` (or `[!type]+`, `[!type]-`) at the head of a quote: { tone, rest }, else null.
function calloutMarker(content) {
  const first = content[0];
  if (first?.type !== 'text') return null;
  const m = /^\[!(\w+)\][+-]?[ \t]*(.*)$/s.exec(first.value);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  const tone = TONES.has(raw) ? raw : Object.hasOwn(TONE_ALIASES, raw) ? TONE_ALIASES[raw] : 'info';
  return { tone, rest: m[2] === '' ? content.slice(1) : [text(m[2]), ...content.slice(1)] };
}

function quote(tok) {
  const children = live(tok.tokens);
  const marker = calloutMarker(quoteContent(children));
  if (marker) return [{ type: 'callout', tone: marker.tone, content: marker.rest }];
  // A last paragraph "— Name" is the quote's cite, as toMarkdown writes it.
  const last = children.at(-1);
  const cite = children.length > 1 && last.type === 'paragraph' ? /^— (.+)$/s.exec(flattenText(last.tokens).trim()) : null;
  if (cite) return [{ type: 'blockquote', content: quoteContent(children.slice(0, -1)), cite: cite[1] }];
  return [{ type: 'blockquote', content: quoteContent(children) }];
}

// ── code fences ─────────────────────────────────────────────────────────

/** Every non-blank block id in a parsed fence, and whether every `href` in it is safe. Iterative. */
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
const langOf = (tok) => (tok.codeBlockStyle === 'indented' ? '' : str(tok.lang).trim().split(/\s+/)[0]);

function code(tok, state) {
  const source = str(tok.text).replace(/\n+$/, '');
  const lang = langOf(tok);
  if (lang === 'mermaid') return [{ type: 'diagram', source }];
  if (lang === 'portabledoc') return fence(source, state);
  return [codeBlock(source, lang)];
}

// ── blocks ──────────────────────────────────────────────────────────────

function block(tok, state) {
  switch (tok.type) {
    case 'heading': return [{ type: 'heading', level: Math.min(6, Math.max(1, Number(tok.depth) || 1)), text: flattenText(tok.tokens) }];
    case 'paragraph': return paragraph(inline(tok.tokens));
    case 'text': return paragraph(inline(tok.tokens ?? [tok]));
    case 'list': return [list(tok)];
    case 'code': return code(tok, state);
    case 'blockquote': return quote(tok);
    case 'table': {
      const cells = (row) => asList(row).map((cell) => inline(cell?.tokens));
      return [{ type: 'table', head: cells(tok.header), rows: asList(tok.rows).map(cells) }];
    }
    case 'hr': return [{ type: 'divider' }];
    case 'def': return [];
    case 'html': {
      const visible = visibleText(tok.text).trim();
      return paragraph(visible ? [text(visible)] : []);
    }
    default: {
      const visible = flattenText([tok]).trim();
      return paragraph(visible ? [text(visible)] : []);
    }
  }
}

// A paragraph that is one emphasised run, right after a diagram, is its caption.
function caption(tok) {
  const only = tok?.type === 'paragraph' && asList(tok.tokens).length === 1 ? tok.tokens[0] : null;
  return only?.type === 'em' ? flattenText(only.tokens).trim() : '';
}

function convert(tokens) {
  const state = { ids: new Set() };
  const list = live(tokens);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const tok = list[i];
    const blocks = block(tok, state);
    if (tok.type === 'code' && langOf(tok) === 'mermaid' && caption(list[i + 1])) blocks[0].caption = caption(list[++i]);
    for (const b of blocks) out.push(b);
  }
  return out;
}

/** GFM Markdown as PortableDoc blocks that pass @portable-doc/validate. Never throws. */
export function fromMarkdown(markdown) {
  const md = typeof markdown === 'string' ? markdown : '';
  try {
    const blocks = convert(parser.lexer(md));
    if (validate({ blocks }).ok) return blocks;
  } catch {
    // fall through: the text as one code block
  }
  return md.trim() === '' ? [] : [codeBlock(md)];
}
