// SPDX-License-Identifier: Apache-2.0
// Prose blocks: headings, paragraphs, lists, quotes, callouts, code, media,
// buttons. Each handler takes (block, ctx) and returns a string ('' = nothing).

import { fieldOf, namesOf, readField } from './read-aliases.js';
import { asList, capitalize, fence, isMap, nonblank, paras, quote, safeUrl, str } from './util.js';

/**
 * A block's inline body. On a block type whose `text` is an old name for `content`, the field
 * read through read-aliases.js; on any other (a list item, a quote), a non-empty `content`
 * array, else its `text`. An inline array as it is, a `text` as a string; a `content` that is
 * not an array (read only when no name holds a value of its type) shows nothing.
 */
export function body(b) {
  if (typeof b.type === 'string' && namesOf(b.type, 'content').length > 1) {
    const { name, value } = readField(b, 'content');
    return Array.isArray(value) ? value : name === 'content' ? '' : str(value);
  }
  return Array.isArray(b.content) && b.content.length ? b.content : str(b.text);
}

function heading(b, ctx) {
  const t = ctx.inline(body(b), { oneLine: true });
  if (t === '' || !ctx.md) return t;
  const n = Number(b.level);
  const level = Number.isInteger(n) && n >= 1 && n <= 6 ? n : 2;
  return `${'#'.repeat(level)} ${t.replace(/(^|\s)(#+)$/, '$1\\$2')}`;
}

const headingAt = (level) => (b, ctx) => heading({ ...b, level }, ctx);

const paragraph = (b, ctx) => ctx.inline(body(b));

function pullquote(b, ctx) {
  const t = ctx.inline(body(b));
  if (t === '') return '';
  return ctx.md ? quote(t) : `“${t}”`;
}

function blockquote(b, ctx) {
  const t = ctx.inline(body(b));
  const cite = ctx.text(nonblank(fieldOf(b, 'cite')));
  if (t === '' && cite === '') return '';
  if (ctx.md) return quote(paras(t, cite && `— ${cite}`));
  return [t && `“${t}”`, cite && `— ${cite}`].filter(Boolean).join('\n');
}

const byline = (b, ctx) =>
  ctx.line(Array.isArray(b.items) ? b.items.map(str).filter(Boolean).join(' · ') : str(b.text));

/* ── lists ── */

const LIST_TYPES = ['list', 'bulletList', 'bullet_list', 'bulleted-list', 'bulleted_list', 'ordered-list', 'numbered_list'];

/** Nested lists under an item: only list blocks occupy that slot. */
const listChildren = (item) =>
  isMap(item) ? asList(item.children).filter((c) => isMap(c) && Array.isArray(c.items) && LIST_TYPES.includes(c.type)) : [];

/** A list item stored as a JSON-encoded inline array decodes to that array. */
function itemContent(item) {
  if (typeof item === 'string' && item.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(item.trim());
      if (Array.isArray(parsed) && parsed.length && isMap(parsed[0])) return parsed;
    } catch {
      /* plain text */
    }
  }
  return isMap(item) ? body(item) : item;
}

function list(b, ctx) {
  const ordered = b.ordered === true;
  const task = b.task === true;
  const start = ordered && !task && Number.isInteger(b.start) ? b.start : 1;
  const items = asList(b.items).map((item) => ({
    head: ctx.inline(itemContent(item)),
    checked: isMap(item) && item.checked === true,
    body: ctx.blocks(listChildren(item)),
  }));
  return ctx.list(items, { ordered, start, task });
}

const orderedList = (b, ctx) => list({ ...b, ordered: true }, ctx);

/* ── callout, code, divider ── */

const CALLOUT_TONES = ['success', 'warning', 'danger', 'neutral', 'loss', 'peace'];

function callout(b, ctx) {
  const tone = CALLOUT_TONES.includes(str(b.tone)) ? str(b.tone) : 'info';
  const label = ctx.text(nonblank(b.title) || capitalize(tone), { oneLine: true });
  const inner = ctx.inline(body(b)) || ctx.blocks(isMap(b.slots) ? asList(b.slots.body) : []);
  const head = ctx.md ? `**${label}:**` : `${label}:`;
  const out = inner === '' ? head.replace(/:(\**)$/, '$1') : /\n/.test(inner) ? `${head}\n\n${inner}` : `${head} ${inner}`;
  return ctx.md ? quote(out) : out;
}

/** A code block's source: its `value`, read through read-aliases.js; an inline array as its text. */
export function codeSource(b) {
  const v = fieldOf(b, 'value');
  return Array.isArray(v) ? v.map((n) => (typeof n === 'string' ? n : isMap(n) ? str(n.value) || str(n.text) : '')).join('') : str(v);
}

// An empty code block is a real block: Markdown writes its empty fence (with its
// language), so it imports back as the same block. Plain text writes nothing.
function code(b, ctx) {
  const source = codeSource(b);
  const lang = str(fieldOf(b, 'lang'));
  if (source.trim() === '') return ctx.md ? fence(source, lang) : '';
  return ctx.md ? fence(source, lang) : source.replace(/\n+$/, '');
}

const divider = (_b, ctx) => (ctx.md ? '---' : '§');

/* ── media and buttons ── */

/** `label` linked to `href` when its scheme is allowed, else the label alone. */
export function linked(ctx, label, href) {
  const url = safeUrl(href);
  return url === null ? label : ctx.link(label, url);
}

function image(b, ctx) {
  const src = str(b.src).trim();
  if (src === '') return '';
  const url = safeUrl(src);
  const alt = ctx.text(str(b.alt), { oneLine: true });
  if (ctx.md) return url === null ? ctx.start(alt) : `![${alt}](${ctx.url(url)})`;
  return [alt ? `Image: ${alt}` : 'Image', url && `(${url})`].filter(Boolean).join(' ');
}

function caption(b, ctx) {
  const c = ctx.text(str(b.caption));
  return c === '' ? '' : ctx.md ? `*${c}*` : c;
}

const figure = (b, ctx) => paras(isMap(b.child) ? ctx.blocks([b.child]) : '', caption(b, ctx));

function diagram(b, ctx) {
  const source = str(b.source);
  // Like code, an empty diagram writes its empty fence in Markdown, so it round-trips.
  const src = ctx.md ? fence(source, 'mermaid') : source.trim() === '' ? '' : source.replace(/\n+$/, '');
  return paras(src, caption(b, ctx));
}

function asciicast(b, ctx) {
  const cap = ctx.text(str(b.caption), { oneLine: true });
  const label = linked(ctx, cap || (ctx.md ? 'Terminal recording' : ''), b.src);
  return cap || !ctx.md ? `Terminal recording: ${label}`.trimEnd().replace(/:$/, '') : label;
}

function video(b, ctx) {
  if (str(b.src).trim() === '') return '';
  return linked(ctx, 'Video', str(b.src).trim());
}

const action = (b, ctx) => ctx.start(linked(ctx, ctx.text(str(b.label), { oneLine: true }), str(b.href)));

/** A one-line paragraph of an unknown block's text, or nothing. */
export function unknown(b, ctx) {
  if (Array.isArray(b.content) && b.content.length) return ctx.inline(b.content);
  return ctx.text(typeof b.text === 'string' ? b.text : '');
}

const preGateBadge = (b, ctx) => ctx.line(str(b.label));

const eyebrow = paragraph;

export const proseHandlers = {
  heading,
  h1: headingAt(1),
  h2: headingAt(2),
  h3: headingAt(3),
  paragraph,
  eyebrow,
  ingress: paragraph,
  pullquote,
  blockquote,
  quote: blockquote,
  byline,
  'pre-gate-badge': preGateBadge,
  list,
  bulletList: list,
  bullet_list: list,
  'bulleted-list': list,
  bulleted_list: list,
  'ordered-list': orderedList,
  numbered_list: orderedList,
  callout,
  code,
  divider,
  image,
  figure,
  diagram,
  asciicast,
  video,
  action,
};
