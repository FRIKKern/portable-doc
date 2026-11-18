// SPDX-License-Identifier: Apache-2.0
// Shared helpers: coercion, URL safety, Markdown escaping, and the list and
// table layouts both output modes use.

export const MAX_DEPTH = 100;
export const TOO_DEEP = 'Nested too deep to show';

export const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
export const asList = (v) => (Array.isArray(v) ? v : []);

/** A string as is, a finite number as its digits, anything else as ''. */
export function str(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return fmtNum(v);
  return '';
}

export const nonblank = (v) => str(v).trim();

/** Digits for a number: whole numbers in full, others to six significant digits. */
export function fmtNum(v) {
  if (!Number.isFinite(v)) return '';
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(6)));
}

export const capitalize = (s) => (s === '' ? s : s.charAt(0).toUpperCase() + s.slice(1));

/* ── URL safety: the renderer's allowlist (packages/react/src/inline.tsx safeUrl) ── */

const ALLOWED_SCHEME = /^(?:https?|mailto|tel):/i;
const IN_DOC = /^(#|\?|\.\/|\.\.\/)/;

/** The cleaned URL when its scheme is allowed, else null (emit the text only).
 * Allowed: http(s), mailto, tel, root-relative `/x` (not `//host`), and in-doc
 * `#`, `?`, `./`, `../` forms. */
export function safeUrl(href) {
  if (typeof href !== 'string') return null;
  const t = href.replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+/, '');
  if (t === '') return null;
  if (t.startsWith('/')) return /^\/[/\\]/.test(t) ? null : t;
  return ALLOWED_SCHEME.test(t) || IN_DOC.test(t) ? t : null;
}

/** A URL as a Markdown link destination: spaces, brackets and controls
 * encoded; `&` and `\` backslash-escaped, so a parser decodes no entity
 * (`/&#47;host` must stay a path, not become `//host`). */
export const mdUrl = (url) =>
  url
    .replace(/[\s()<>\x00-\x1f\x7f]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))
    .replace(/[&\\]/g, '\\$&');

/** The largest of a list of numbers, or `floor`. A loop, so a long list
 * cannot overflow the call stack the way Math.max(...list) does. */
export function maxOf(list, floor = -Infinity) {
  let m = floor;
  for (const v of list) if (v > m) m = v;
  return m;
}

/* ── Markdown escaping ── */

/** Escape the characters that start inline markup anywhere in a line. An
 * underscore inside a word cannot start emphasis, so it stays bare. */
export function escInline(s) {
  const word = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
  return s.replace(/[\\`*[\]~_<&]/g, (c, i) => {
    if (c === '_') return word(s[i - 1]) && word(s[i + 1]) ? c : '\\_';
    if (c === '<') return /[A-Za-z/!?]/.test(s[i + 1] ?? '') ? '\\<' : c;
    if (c === '&') return /^&#?[A-Za-z0-9]+;/.test(s.slice(i, i + 34)) ? '\\&' : c;
    return '\\' + c;
  });
}

/** Escape what would start a block at the head of a line: headings, quotes,
 * list markers, setext underlines. Leading spaces go (they could open code). */
export function escLineStart(line) {
  const l = line.replace(/^\s+/, '');
  if (/^[=-]+\s*$/.test(l)) return '\\' + l;
  if (/\|/.test(l) && /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l)) return '\\' + l; // a GFM table delimiter row
  if (/^[#>]/.test(l)) return '\\' + l;
  if (/^[-+](\s|$)/.test(l)) return '\\' + l;
  return l.replace(/^(\d{1,9})([.)])(?=\s|$)/, '$1\\$2');
}

/** A fenced code block whose fence is longer than any backtick run inside. */
export function fence(source, lang = '') {
  const longest = maxOf((source.match(/`+/g) ?? []).map((r) => r.length), 0);
  const f = '`'.repeat(Math.max(3, longest + 1));
  const info = str(lang).trim().split(/\s/)[0].replace(/[^\w+#.-]/g, '');
  return `${f}${info}\n${source.replace(/\n+$/, '')}\n${f}`;
}

/** An inline code span that survives backticks in its content. */
export function codeSpan(source) {
  const s = source.replace(/\n/g, ' ');
  const longest = maxOf((s.match(/`+/g) ?? []).map((r) => r.length), 0);
  const f = '`'.repeat(longest + 1);
  const pad = s.startsWith('`') || s.endsWith('`') ? ' ' : '';
  return `${f}${pad}${s}${pad}${f}`;
}

/* ── layout ── */

export const indent = (s, n) => s.split('\n').map((l) => (l === '' ? l : ' '.repeat(n) + l)).join('\n');

/** Markdown blockquote: every line behind `> `. */
export const quote = (s) => s.split('\n').map((l) => (l === '' ? '>' : '> ' + l)).join('\n');

/** Non-empty parts joined as separate paragraphs. */
export const paras = (...parts) => parts.filter((p) => typeof p === 'string' && p.trim() !== '').join('\n\n');

/**
 * A list. Each item is { head, checked?, body?, loose? }: `head` is the item's
 * first paragraph, `body` what nests under it (indented to the item's content
 * column), `loose` puts a blank line before the body.
 */
export function listOut(items, { ordered = false, start = 1, task = false } = {}) {
  return items
    .map((item, i) => {
      const marker = ordered ? `${start + i}.` : '-';
      const width = marker.length + 1;
      const box = task ? (item.checked ? '[x] ' : '[ ] ') : '';
      const [first = '', ...rest] = (item.head ?? '').split('\n');
      let out = `${marker} ${box}${first}`.trimEnd();
      if (rest.length) out += '\n' + indent(rest.join('\n'), width);
      if (item.body && item.body.trim() !== '') out += (item.loose ? '\n\n' : '\n') + indent(item.body, width);
      return out;
    })
    .join('\n');
}

const width = (s) => [...s].length;

/**
 * A table. Markdown: a GFM table (pipes in cells escaped; an empty header row
 * when there is none). Plain text: space-aligned columns, a dashed rule under
 * the header. Cells are single-line strings already rendered for the mode.
 */
export function tableOut(head, rows, md) {
  const n = maxOf(rows.map((r) => r.length), head?.length ?? 0);
  if (n === 0) return '';
  const fill = (r) => Array.from({ length: n }, (_, i) => (r[i] ?? '').replace(/\s*\n\s*/g, ' '));
  const h = head && head.length ? fill(head) : null;
  const body = rows.map(fill);
  if (md) {
    const row = (r) => `| ${r.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`.replace(/ {2,}\|/g, ' |');
    return [row(h ?? fill([])), `| ${Array(n).fill('---').join(' | ')} |`, ...body.map(row)].join('\n');
  }
  const all = h ? [h, ...body] : body;
  const widths = Array.from({ length: n }, (_, i) => maxOf(all.map((r) => width(r[i]))));
  const line = (r) => r.map((c, i) => c + ' '.repeat(widths[i] - width(c))).join('  ').trimEnd();
  const lines = body.map(line);
  if (h) lines.unshift(line(h), widths.map((w) => '-'.repeat(Math.max(w, 1))).join('  '));
  return lines.join('\n');
}

/* ── the status ladder (packages/react/src/status-vocab.gen.ts) ── */

export const STATUS_ROLES = [
  ['open', 'open', 'backlog — not ready yet'],
  ['ready', 'ready', 'unchecked — claim it now'],
  ['progress', 'in progress', 'being worked right now'],
  ['blocked', 'blocked', 'something is required first'],
  ['done', 'done', 'complete'],
  ['cancel', 'cancelled', 'abandoned or superseded'],
  ['considering', 'considering', 'a candidate being weighed'],
  ['researching', 'researching', 'under active investigation'],
];
const STATUS_TO_ROLE = {
  open: 'open', ready: 'ready', in_progress: 'progress', blocked: 'blocked', done: 'done',
  closed: 'done', cancelled: 'cancel', considering: 'considering', researching: 'researching',
};
const ROLE_LABEL = Object.fromEntries(STATUS_ROLES.map(([role, label]) => [role, label]));

/** A stored status's ladder role: absent is `open`, unrecognized is `unknown`. */
export function roleOf(status) {
  const s = str(status);
  if (s === '') return 'open';
  return Object.hasOwn(STATUS_TO_ROLE, s) ? STATUS_TO_ROLE[s] : 'unknown';
}

/** A status as words: its role's label, or the stored word when unrecognized. */
export function statusText(status) {
  const role = roleOf(status);
  return role === 'unknown' ? str(status) : ROLE_LABEL[role];
}

export const roleLabel = (role) => ROLE_LABEL[role] ?? role;
