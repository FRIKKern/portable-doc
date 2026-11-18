// SPDX-License-Identifier: Apache-2.0
// Markdown inline tokens (from marked) as PortableDoc inline nodes, and the
// plain text of any token tree. The node shapes are Barkpark's FromMarkdown:
// strong, em, strikethrough and link carry `children`, code carries `value`.

import { asList, isMap, safeUrl, str } from './util.js';

/** Inline nesting deeper than this is kept as its plain text. */
export const MAX_NEST = 50;

// The named references decoded; any other `&name;` stays as written.
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '­',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  middot: '·', bull: '•', deg: '°', plusmn: '±', times: '×', divide: '÷',
  euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶',
};
const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g;

/** Text with its character references decoded, once. */
export function decode(s) {
  return str(s).replace(ENTITY, (m, dec, hex, name) => {
    if (name !== undefined) return Object.hasOwn(NAMED, name) ? NAMED[name] : m;
    const cp = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '�' : String.fromCodePoint(cp);
  });
}

/** The visible text of raw HTML: tags, comments, scripts and styles dropped. */
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
  return decode(out);
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

// A soft line break reads as a space; a hard one (`br`) is a "\n" in the text.
const soft = (s) => s.replace(/[ \t]*\n[ \t]*/g, ' ');

const BLOCK = new Set(['paragraph', 'heading', 'code', 'blockquote', 'list_item', 'table', 'html', 'hr']);
const SEP = Symbol('separator');

function kids(tok) {
  if (Array.isArray(tok.tokens)) return tok.tokens;
  if (Array.isArray(tok.items)) return tok.items;
  if (tok.type === 'table') return [...asList(tok.header), ...asList(tok.rows).flatMap(asList)];
  return null;
}

function leafText(tok) {
  switch (tok.type) {
    case 'text': return soft(decode(tok.text));
    case 'escape': case 'codespan': case 'code': return str(tok.text);
    case 'br': return '\n';
    case 'html': return visibleText(tok.text);
    case 'checkbox': case 'space': case 'def': case 'hr': return '';
    default: return decode(tok.text);
  }
}

/** The plain text of a token tree, block siblings joined by a space. Iterative, so depth costs no stack. */
export function flattenText(tokens) {
  let out = '';
  const stack = [...asList(tokens)].reverse();
  while (stack.length) {
    const tok = stack.pop();
    if (tok === SEP) {
      if (out !== '' && !/\s$/.test(out)) out += ' ';
      continue;
    }
    if (!isMap(tok)) continue;
    const children = kids(tok);
    if (BLOCK.has(tok.type)) stack.push(SEP);
    if (children) for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    else out += leafText(tok);
  }
  return out;
}

function link(href, children) {
  const url = safeUrl(href);
  if (url === null) return children;
  return [{ type: 'link', href: url, children: children.length ? children : [text(url)] }];
}

function node(tok, depth) {
  if (!isMap(tok)) return [];
  if (depth >= MAX_NEST) return [text(flattenText([tok]))];
  const inner = () => inline(tok.tokens, depth + 1);
  const wrap = (type) => {
    const children = inner();
    return children.length ? [{ type, children }] : [];
  };
  switch (tok.type) {
    case 'text': return Array.isArray(tok.tokens) ? inner() : [text(soft(decode(tok.text)))];
    case 'escape': return [text(str(tok.text))];
    case 'strong': return wrap('strong');
    case 'em': return wrap('em');
    case 'del': return wrap('strikethrough');
    case 'codespan': return [{ type: 'code', value: str(tok.text) }];
    case 'br': return [text('\n')];
    case 'link': return link(decode(tok.href), inner());
    case 'image': {
      // An image is a link to it, labelled by its alt text (Barkpark's chat rule).
      const src = decode(tok.href);
      const alt = flattenText(tok.tokens) || decode(tok.text);
      return link(src, [text(alt || src)]);
    }
    // An inline tag is dropped; the text around it is a token of its own.
    case 'html': case 'checkbox': case 'space': return [];
    default: return Array.isArray(tok.tokens) ? inner() : [text(decode(tok.text))];
  }
}

/** Inline tokens as PortableDoc inline nodes, neighbouring text joined. */
export function inline(tokens, depth = 0) {
  return merge(asList(tokens).flatMap((tok) => node(tok, depth)));
}
