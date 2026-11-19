// SPDX-License-Identifier: Apache-2.0
// Each line's depth for the import's count (import-work.js): how many containers markdown-it
// may read the line in, read from the text alone, one line after another.
//
// The count is a bound: a container counts as open until the reader is sure it has closed,
// and a marker counts as opening one unless the reader is sure it cannot. A line's depth is
// its own markers (`>`, and list markers) plus the list items open from earlier marker lines
// that its text is indented into. Every place the reader picks between two readings, and the
// one it takes (in doubt, the one that costs more):
//
//  1. A marker opens. Every `>` and list marker in a line's prefix counts, also where
//     markdown-it reads it as code, as text or as a rule (`- - -`). Costs more.
//  2. Indentation counts an item from its least content column (its marker's end plus one),
//     not from its content column as markdown-it sets it. Costs more.
//  3. A line right after a non-blank line keeps at least that line's depth: it may be lazy.
//     A blank line keeps the depth before it. Costs more.
//  4. A blank line closes every quote and the items in them: markdown-it ends a quote there.
//     After it, a line less indented than an item's least content column closes the item.
//     Sure.
//  5. A quote marker left of an item's least content column closes the item: it always ends
//     a paragraph that far left. Sure.
//  6. A list marker left of an item's least content column closes the item only at or left
//     of the item's own marker. Between the marker and the least content column, or when the
//     item is deeper in quotes than the line, the marker may continue the item's paragraph
//     lazily (markdown-it does not let a marker 4 columns past the enclosing item's content
//     end a paragraph), so the item stays open.
//  7. Any other line not after a blank line closes nothing: it may be lazy. Costs more.
//  8. An item closes with the item it was opened in (or after, on its own line): its quotes
//     and its content are inside that one. Recorded only while the items are exact (9), so
//     the one it closes with surely holds it. Sure.
//  9. The items are exact (the very ones markdown-it has open) only from a line where none
//     is open, until a line keeps one it may have closed: lazy (choices 6 and 7), deeper in
//     quotes than the line, or short of its content column; or a line has a marker that may
//     not be one: 4 or more columns past the content of the container before it (code, or a
//     paragraph's lazy text), or an ordered marker other than 1 right after a non-blank line
//     (a paragraph's text). Not exact costs more: no fence is trusted (10).
// 10. A fence: inside it a line is charged at the fence's opening line's depth, whatever it
//     holds, which can cost less, so a line counts as in a fence only where the tracker is
//     sure; in doubt it is any line. A fence ends at its closing fence, or at the first line
//     that leaves the opener's container (a quote line without its marker, a line indented
//     less than the item's content), whichever comes first. The tracker is not sure of a
//     fence-like line while the items are not exact, inside a possible HTML block or link
//     reference definition, of one whose indentation against its container is 3 to 5
//     columns, of one between an item's least and its true content column, nor of any after
//     a fence-like line it was not sure of, until the text is read afresh. A sure fence line
//     closes the items it is not in: a fence ends a paragraph that far left. Sure.

const SP = (ch) => ch === 32 || ch === 9;
export const isBlank = (line) => {
  for (let i = 0; i < line.length; i++) if (!SP(line.charCodeAt(i))) return false;
  return true;
};

/** A list marker's end in `line` at `i` (the index after it), or -1. */
function listMarker(line, i) {
  const end = (j) => j >= line.length || SP(line.charCodeAt(j));
  const ch = line.charCodeAt(i);
  if ((ch === 45 || ch === 43 || ch === 42) && end(i + 1)) return i + 1;
  let j = i;
  while (j < line.length && j - i < 9 && line.charCodeAt(j) >= 48 && line.charCodeAt(j) <= 57) j++;
  if (j > i && (line.charCodeAt(j) === 46 || line.charCodeAt(j) === 41) && end(j + 1)) return j + 1;
  return -1;
}

/**
 * The prefix of `line`: m markers, w whitespace columns among them, `at` where the text after
 * it starts and `col` its column, `quotes` its quote markers and `base` the column after the
 * last of them, and its containers in order as `{ quote: true }` or a list item
 * `{ col, q, mark, lo, hi }`: `col` its least content column in the line (its marker's end plus
 * one), `q` the quote markers before it, and `mark` its marker's column, `lo` and `hi` its least
 * content column and its content
 * column as markdown-it sets it (1 to 4 columns after the marker; one, when more or none
 * follow), both counted from the column after its q-th quote marker. After a `>`, one space
 * or one column of a tab belongs to the marker, as in markdown-it. Tabs run to the next stop
 * of 4.
 */
export function prefix(line) {
  let i = 0;
  let m = 0;
  let w = 0;
  let col = 0;
  let quotes = 0;
  let base = 0;
  const containers = [];
  for (;;) {
    let ws = 0;
    while (i < line.length && SP(line.charCodeAt(i))) {
      const width = line.charCodeAt(i++) === 9 ? 4 - (col % 4) : 1;
      w += width;
      col += width;
      ws += width;
    }
    const last = containers.at(-1);
    if (last && !last.quote && last.hi === undefined) last.hi = (i >= line.length || ws > 4 ? last.col : last.col - 1 + ws) - base;
    if (line.charCodeAt(i) === 62) {
      m++;
      const mark = col - base;
      i++;
      col++;
      quotes++;
      base = i < line.length && SP(line.charCodeAt(i)) ? col + 1 : col;
      containers.push({ quote: true, mark });
      continue;
    }
    const end = listMarker(line, i);
    if (end === -1) return { m, w, at: i, col, quotes, base, containers };
    m++;
    const mark = col - base;
    col += end - i;
    i = end;
    containers.push({ col: col + 1, q: quotes, mark, lo: col + 1 - base });
  }
}

/**
 * The quote markers that lead `line` (before any list marker or text): { n, base, pos, idx }.
 * base[k] is the column after the k-th marker and the space it takes (base[0] = 0); pos[k]
 * and idx[k] the column and index of the first non-blank character from there (pos Infinity
 * when the rest is blank).
 */
function levels(line) {
  const base = [0];
  const pos = [];
  const idx = [];
  let i = 0;
  let col = 0;
  for (;;) {
    while (i < line.length && SP(line.charCodeAt(i))) col = line.charCodeAt(i++) === 9 ? col + 4 - (col % 4) : col + 1;
    pos.push(i < line.length ? col : Infinity);
    idx.push(i);
    if (line.charCodeAt(i) !== 62) return { n: base.length - 1, base, pos, idx };
    i++;
    col++;
    base.push(i < line.length && SP(line.charCodeAt(i)) ? col + 1 : col);
  }
}

/**
 * Where `line` goes on inside `containers` (from prefix), as { at, col }: the index after
 * their prefix and its column; or null when one of them ends. For the import's long-line rule.
 */
export function within(line, containers) {
  let i = 0;
  let col = 0;
  const space = () => {
    const tab = line.charCodeAt(i++) === 9;
    col = tab ? col + 4 - (col % 4) : col + 1;
  };
  for (const c of containers) {
    if (c.quote) {
      while (i < line.length && SP(line.charCodeAt(i))) space();
      if (line.charCodeAt(i) !== 62) return null;
      i++;
      col++;
    } else {
      while (i < line.length && col < c.col && SP(line.charCodeAt(i))) space();
      if (col < c.col && i < line.length) return null;
    }
  }
  return { at: i, col };
}

/** A fence opener at `at`: { char, len }, or null. */
export function opener(line, at) {
  const ch = line[at];
  if (ch !== '`' && ch !== '~') return null;
  let len = 0;
  while (line[at + len] === ch) len++;
  if (len < 3 || (ch === '`' && line.indexOf('`', at + len) !== -1)) return null;
  return { char: ch, len };
}

/** Whether `line` from `at` closes `fence`: its marker, at least as long, then only spaces and tabs. */
export function closes(line, at, fence) {
  let i = at;
  while (i < line.length && SP(line.charCodeAt(i))) i++;
  let len = 0;
  while (line[i + len] === fence.char) len++;
  return len >= fence.len && isBlank(line.slice(i + len));
}

// HTML blocks that a blank line does not end (markdown-it's kinds 1 to 5), and their end.
const HTML_LONG = [
  [/^<(script|pre|style|textarea)(\s|>|$)/i, /<\/(script|pre|style|textarea)>/i],
  [/^<!--/, /-->/],
  [/^<\?/, /\?>/],
  [/^<![A-Za-z]/, />/],
  [/^<!\[CDATA\[/, /\]\]>/],
];

// Where a fence marker sits against its container's content, in columns: sure a fence from
// 0 to 2, sure code from 6; between, the tracker is not sure (tabs and the space after `>`
// can shift markdown-it's columns from these).
const place = (rel) => (rel <= 2 ? 'fence' : rel >= 6 ? 'code' : 'doubt');

// Whether each marker of a line (prefix) surely is one: 0 to 3 columns past the content
// column of the container before it (from `contained`, the open items the line is inside).
// Four or more, markdown-it reads it as code, or as a paragraph's lazy text.
function markersSure(p, contained) {
  const hiAt = (q) => Math.max(0, ...contained.filter((it) => it.q === q).map((it) => it.hi));
  let content = hiAt(0);
  let q = 0;
  for (const c of p.containers) {
    if (c.mark < content || c.mark - content > 3) return false;
    content = c.quote ? hiAt(++q) : c.hi;
  }
  return true;
}

// An ordered marker numbered other than 1 in a line's prefix: right after a paragraph line,
// markdown-it reads it as the paragraph's text.
const otherOrdered = (head) => [...head.matchAll(/(\d+)[.)]/g)].some((m) => Number(m[1]) !== 1);

/** A reader of lines, one after another: next(line) gives its depth; reset() starts a new document. */
export function depthReader() {
  let before;
  let afterBlank;
  let items; // list items open from earlier marker lines: { q, lo, hi }, as prefix gives them
  let code; // the fence the tracker is sure of: { chain, needQ, innerHi, char, len, D }
  let doubt; // a fence-like line the tracker was not sure of: no fence trusted after it
  let html; // a possible HTML block: { end } (a pattern, or null: a blank line ends it)
  let ref; // the lines since the last blank line include one that starts with '['
  let loose; // the open items may hold one markdown-it has closed: no fence is trusted
  const reset = () => {
    before = 0;
    afterBlank = true;
    items = [];
    code = null;
    doubt = false;
    html = null;
    ref = false;
    loose = false;
  };
  reset();

  // A line inside the sure fence: its depth, or undefined when it is read as any line.
  const inCode = (line, blank) => {
    if (blank) {
      if (code.needQ === 0) return code.D;
      code = null; // a blank line ends a quote, and the fence in it
      return undefined;
    }
    const L = levels(line);
    if (L.n < code.needQ || code.chain.some((it) => L.pos[it.q] - L.base[it.q] < it.hi)) {
      code = null; // it left the opener's container
      return undefined;
    }
    const D = code.D;
    const i = L.idx[code.needQ];
    let len = 0;
    while (line[i + len] === code.char) len++;
    if (len >= code.len && isBlank(line.slice(i + len))) {
      const kind = place(L.pos[code.needQ] - L.base[code.needQ] - code.innerHi);
      if (kind === 'doubt') {
        code = null;
        doubt = true;
        return undefined;
      }
      if (kind === 'fence') code = null; // the closing fence, charged as code
    }
    return D;
  };

  // Close the items `keep` turns down, and every item inside one of them.
  const close = (keep) => {
    const gone = new Set();
    for (const it of items) if (!keep(it) || gone.has(it.up)) gone.add(it); // parents come first
    if (gone.size) items = items.filter((it) => !gone.has(it));
  };

  const next = (line) => {
    const blank = isBlank(line);
    if (code) {
      const D = inCode(line, blank);
      if (D !== undefined) {
        before = D;
        afterBlank = blank;
        return D;
      }
    }
    if (blank) {
      afterBlank = true;
      ref = false;
      if (html !== null && html.end === null) html = null;
      return before;
    }
    const p = prefix(line);
    const L = levels(line);
    const rel = (q) => (q <= L.n ? L.pos[q] - L.base[q] : -Infinity);
    const own = p.containers.filter((c) => !c.quote);
    // A list marker after the leading quotes never continues a paragraph lazily.
    const listFirst = p.containers.length > L.n;
    // Items this line surely closes (choices 4 to 8 above); every other stays open.
    const open = (it) => {
      if (afterBlank) return it.q === 0 && rel(0) >= it.lo;
      if (it.q < L.n) return rel(it.q) >= it.lo;
      if (!listFirst || rel(it.q) >= it.lo) return true;
      // A list marker that may continue the item's paragraph lazily stays open (choice 6).
      return it.q === L.n ? rel(it.q) > it.mark : true;
    };
    close(open);
    const contained = items.filter((it) => it.q <= L.n && rel(it.q) >= it.hi);
    const sure = markersSure(p, contained) && (afterBlank || !otherOrdered(line.slice(0, p.at)));
    // Whether the items are exactly those markdown-it has open (choice 9): not when one kept may be
    // closed (lazy, past a quote this line leaves, or short of its content column), nor when
    // this line's markers may not be markers.
    let exact = (!loose || items.length === 0) && sure && !items.some((it) => it.q > L.n || rel(it.q) < it.hi);
    let K = 0;
    for (const it of items) if (it.q <= L.n && rel(it.q) >= it.lo) K++;
    const D = afterBlank ? p.m + K : Math.max(p.m + K, before);
    const f = opener(line, p.at);
    if (f) {
      const straddle = items.some((it) => it.q <= L.n && rel(it.q) >= it.lo && rel(it.q) < it.hi);
      const chain = [...contained, ...own];
      const innerHi = Math.max(0, ...chain.filter((it) => it.q === p.quotes).map((it) => it.hi));
      const kind = doubt || (loose && items.length > 0) || !sure || html !== null || (ref && !afterBlank) || straddle ? 'doubt' : place(p.col - p.base - innerHi);
      if (kind === 'doubt') doubt = true;
      else if (kind === 'fence') {
        const inFence = new Set(contained);
        close((it) => inFence.has(it)); // a fence never continues a paragraph: the others close here
        exact = true;
        code = { chain, needQ: p.quotes, innerHi, ...f, D };
      }
    } else {
      const text = line.slice(p.at);
      if (html !== null && html.end !== null && html.end.test(text)) html = null;
      else if (html === null && text.startsWith('<')) {
        const kind = HTML_LONG.find(([start]) => start.test(text));
        html = { end: kind ? kind[1] : null };
        if (kind && kind[1].test(text.slice(1))) html = null;
      }
      if (text.startsWith('[')) ref = true;
    }
    // An item opened while the items are exact is inside the innermost the line is in, or its
    // own marker before it (`up`): it closes with it.
    let up = exact ? (contained.at(-1) ?? null) : null;
    for (const c of own) {
      const it = { q: c.q, mark: c.mark, lo: c.lo, hi: c.hi, up };
      items.push(it);
      if (exact) up = it;
    }
    loose = !exact && items.length > 0;
    before = D;
    afterBlank = false;
    return D;
  };
  return { next, reset };
}
