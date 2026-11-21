// SPDX-License-Identifier: Apache-2.0
// @portable-doc/text: a PortableDoc document as Markdown or as plain text.

import { MAX_DEPTH, TOO_DEEP, codeSpan, escInline, escLineStart, isMap, listOut, mdUrl, str } from './util.js';
import { renderInline } from './inline.js';
import { proseHandlers, unknown } from './blocks-prose.js';
import { layoutHandlers } from './blocks-layout.js';
import { dataHandlers } from './blocks-data.js';
import { appHandlers } from './blocks-apps.js';
import { roundTrip } from './round-trip.js';

const HANDLERS = { ...proseHandlers, ...layoutHandlers, ...dataHandlers, ...appHandlers };

/** Every block type (aliases included) with its own text handler. */
export const BLOCK_TYPES = Object.freeze(Object.keys(HANDLERS).sort());

// `state` is shared by the whole render: the embeds being expanded and how many
// have been, so a document that embeds itself, or doubles its embeds level by
// level, stays small.
function makeCtx(md, options, depth, state) {
  const ctx = {
    md,
    options,
    depth,
    state,
    inline: (nodes, o) => renderInline(nodes, md, o),
    text: (s, o) => renderInline(str(s), md, o),
    // A string as one line that starts a line: escaped so it cannot open a block.
    line: (s) => renderInline(str(s), md, { oneLine: true, lineStart: true }),
    // An already-rendered string placed at a line start.
    start: (s) => (md ? s.replace(/^[^\n]*/, escLineStart) : s),
    list: (items, o) => listOut(md ? items.map((i) => ({ ...i, head: ctx.start(i.head ?? '') })) : items, o),
    blocks: (list) => renderBlocks(list, makeCtx(md, options, depth + 1, state)),
    bold: (t) => (md && t !== '' ? `**${t}**` : t),
    code: (s) => (md ? codeSpan(s) : s),
    url: mdUrl,
    // `label` is already rendered for the mode; `url` already passed safeUrl.
    link: (label, url) => {
      if (md) return `[${label || escInline(url)}](${mdUrl(url)})`;
      return label === '' || label === url ? url : url.startsWith('#') ? label : `${label} (${url})`;
    },
  };
  return ctx;
}

function renderBlock(b, ctx) {
  if (!isMap(b)) return '';
  if (ctx.depth >= MAX_DEPTH) return TOO_DEEP;
  const type = str(b.type);
  const handler = Object.hasOwn(HANDLERS, type) ? HANDLERS[type] : unknown;
  try {
    const out = handler(b, ctx);
    return typeof out === 'string' ? out : '';
  } catch {
    return '';
  }
}

const LIST_LINE = /^(?:([-*])|\d{1,9}([.)]))(?: |$)/;
const listKind = (line) => {
  const m = LIST_LINE.exec(line);
  return m ? m[1] ?? m[2] : null;
};
const topLevel = (s) => s.split('\n').filter((l) => l !== '' && !/^\s/.test(l));
const SWAP = { '-': '*', '*': '-', '.': ')', ')': '.' };

/** Two Markdown lists in a row would merge into one: switch the second's marker. */
function separateList(prev, cur) {
  const last = topLevel(prev).at(-1);
  const kind = last === undefined ? null : listKind(last);
  if (kind === null || listKind(cur.split('\n')[0]) !== kind) return cur;
  let inList = true;
  return cur
    .split('\n')
    .map((l) => {
      if (!inList || l === '' || /^\s/.test(l)) return l;
      if (listKind(l) !== kind) return (inList = false), l;
      return /^\d/.test(l) ? l.replace(/^(\d+)[.)]/, `$1${SWAP[kind]}`) : SWAP[kind] + l.slice(1);
    })
    .join('\n');
}

function renderBlocks(list, ctx) {
  if (!Array.isArray(list)) return '';
  const chunks = [];
  for (const b of list) {
    const out = renderBlock(b, ctx).trimEnd().replace(/^\n+/, '');
    if (out === '') continue;
    chunks.push(ctx.md && chunks.length ? separateList(chunks.at(-1), out) : out);
  }
  return chunks.join('\n\n');
}

/** A doc's blocks: the array itself, or `blocks` of an object. */
const blocksOf = (doc) => (Array.isArray(doc) ? doc : isMap(doc) && Array.isArray(doc.blocks) ? doc.blocks : []);

function render(doc, md, options) {
  const blocks = blocksOf(doc);
  const out = renderBlocks(blocks, makeCtx(md, isMap(options) ? options : {}, 0, { open: [], expanded: 0 }));
  return out === '' ? '' : `${out}\n`;
}

export { FENCE_KEPT_AS_CODE, IMPORT_FELL_BACK, IMPORT_WORK, LINE_NOTICES_CAPPED, LIST_ITEM_SPLIT, MAX_LINE_NOTICES, NESTING_KEPT_AS_TEXT, OLD_NAME_DROPPED, fromMarkdown, readMarkdown } from './from-markdown.js';

/**
 * The document as CommonMark with GFM tables, task lists and strikethrough: readable, one way.
 * With `{ mode: 'round-trip' }`, { markdown, lost }: Markdown that fromMarkdown reads back as the
 * same blocks, for each block import accepts, and the blocks it could not keep that way (round-trip.js).
 */
export const toMarkdown = (doc, options) =>
  isMap(options) && options.mode === 'round-trip' ? roundTrip(blocksOf(doc), (blocks) => render(blocks, true, options)) : render(doc, true, options);

/** The document as readable plain text: no markup, links as "text (url)". */
export const toPlainText = (doc, options) => render(doc, false, options);
