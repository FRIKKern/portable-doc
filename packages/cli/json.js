// SPDX-License-Identifier: Apache-2.0
// JSON with a usable error: the line and column of the first character that
// makes the text invalid. Engine messages carry a position only sometimes.

const WS = new Set([' ', '\t', '\n', '\r']);
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const WORD = /true|false|null/y;

/** The offset of the first character that makes `text` invalid JSON, or null. */
export function errorOffset(text) {
  let i = 0;
  const bad = () => {
    throw i;
  };
  const ws = () => {
    while (WS.has(text[i])) i++;
  };
  const string = () => {
    i++;
    for (;;) {
      const c = text[i];
      if (c === undefined || c < ' ') bad();
      if (c === '"') return void i++;
      if (c !== '\\') {
        i++;
        continue;
      }
      const e = text[i + 1];
      if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) i += 6;
      else if (e !== undefined && '"\\/bfnrt'.includes(e)) i += 2;
      else (i++, bad());
    }
  };
  const scalar = () => {
    if (text[i] === '"') return string();
    for (const re of [NUMBER, WORD]) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m) return void (i += m[0].length);
    }
    bad();
  };
  const key = () => {
    ws();
    if (text[i] !== '"') bad();
    string();
    ws();
    if (text[i] !== ':') bad();
    i++;
  };
  // Iterative over containers, so deep nesting cannot overflow the stack.
  const open = [];
  // True when it opened a container whose first value comes next.
  const value = () => {
    ws();
    const c = text[i];
    if (c !== '{' && c !== '[') return scalar(), false;
    i++;
    ws();
    const close = c === '{' ? '}' : ']';
    if (text[i] === close) return i++, false;
    open.push(close);
    if (close === '}') key();
    return true;
  };
  try {
    let opened = value();
    while (open.length) {
      if (opened) {
        opened = value();
        continue;
      }
      ws();
      const close = open.at(-1);
      if (text[i] === ',') {
        i++;
        if (close === '}') key();
        opened = value();
      } else if (text[i] === close) {
        i++;
        open.pop();
      } else bad();
    }
    ws();
    if (i < text.length) bad();
    return null;
  } catch (at) {
    if (typeof at === 'number') return at;
    throw at;
  }
}

/** 1-based line and column of an offset. */
export function lineColumn(text, offset) {
  const before = text.slice(0, offset);
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
}

/** { ok: true, value } or { ok: false, line, column, message }. */
export function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    const offset = errorOffset(text);
    if (offset === null) return { ok: false, line: null, column: null, message: error.message };
    const found = text[offset] === undefined ? 'the text ends too early' : `unexpected ${JSON.stringify(text[offset])}`;
    return { ok: false, ...lineColumn(text, offset), message: found };
  }
}
