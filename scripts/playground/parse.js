// JSON parsing for the playground editor: on failure, say where (line and column)
// and what was found there, the same in every browser (engine messages differ).
import { utf8Length } from './share.js';

const LITERAL = /true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const WS = new Set([' ', '\t', '\n', '\r']);

// The offset of the first character that makes `text` invalid JSON, or null.
export function errorOffset(text) {
  let i = 0;
  const fail = () => {
    throw new RangeError(String(i));
  };
  const ws = () => {
    while (WS.has(text[i])) i += 1;
  };
  const string = () => {
    i += 1;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') {
        i += 1;
        return;
      }
      if (c === '\\') {
        const next = text[i + 1];
        if (next === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
            i += 2;
            fail();
          }
          i += 6;
        } else if (next !== undefined && '"\\/bfnrt'.includes(next)) i += 2;
        else {
          i += 1;
          fail();
        }
        continue;
      }
      if (c < ' ') fail();
      i += 1;
    }
    fail();
  };
  // Iterative over containers, so deep nesting cannot overflow the stack.
  const stack = [];
  const value = () => {
    ws();
    const c = text[i];
    if (c === '{' || c === '[') {
      i += 1;
      ws();
      const close = c === '{' ? '}' : ']';
      if (text[i] === close) {
        i += 1;
        return false;
      }
      stack.push(close);
      if (close === '}') key();
      return true;
    }
    if (c === '"') return string(), false;
    LITERAL.lastIndex = i;
    const match = LITERAL.exec(text);
    if (!match) fail();
    i += match[0].length;
    return false;
  };
  const key = () => {
    ws();
    if (text[i] !== '"') fail();
    string();
    ws();
    if (text[i] !== ':') fail();
    i += 1;
  };
  try {
    let opened = value();
    while (stack.length) {
      if (opened) {
        opened = value();
        continue;
      }
      ws();
      const close = stack.at(-1);
      if (text[i] === ',') {
        i += 1;
        if (close === '}') key();
        opened = value();
      } else if (text[i] === close) {
        i += 1;
        stack.pop();
      } else fail();
    }
    ws();
    if (i < text.length) fail();
    return null;
  } catch (error) {
    if (error instanceof RangeError && /^\d+$/.test(error.message)) return Number(error.message);
    throw error;
  }
}

export function lineColumn(text, offset) {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
}

// { ok: true, value } or { ok: false, error: { line, column, message } }.
export function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    const offset = errorOffset(text);
    if (offset === null) return { ok: false, error: { line: null, column: null, message: error.message } };
    const found = text[offset] === undefined ? 'the text ends too early' : `unexpected ${JSON.stringify(text[offset])}`;
    return { ok: false, error: { ...lineColumn(text, offset), message: found } };
  }
}

// A doc is a blocks array or an object with one; anything else renders nothing.
export function blocksOf(doc) {
  if (Array.isArray(doc)) return doc;
  if (doc && typeof doc === 'object' && Array.isArray(doc.blocks)) return doc.blocks;
  return [];
}

// The UTF-8 size of JSON.stringify(value, null, 2), counted without recursion. Stops
// and returns Infinity once it passes `stop`, so deep nesting costs little.
export function prettyBytes(value, stop = Infinity) {
  let total = 0;
  const stack = [[value, 0]];
  while (stack.length) {
    const [item, depth] = stack.pop();
    if (item === null || typeof item !== 'object') total += utf8Length(JSON.stringify(item));
    else {
      const keys = Array.isArray(item) ? null : Object.keys(item);
      const children = keys ? keys.map((key) => item[key]) : item;
      const n = children.length;
      // "[" + n × (newline + indent) + (n - 1) commas + newline + indent + "]"
      total += n === 0 ? 2 : 2 + n * (1 + 2 * (depth + 1)) + (n - 1) + 1 + 2 * depth;
      if (keys) for (const key of keys) total += utf8Length(JSON.stringify(key)) + 2;
      for (const child of children) stack.push([child, depth + 1]);
    }
    if (total > stop) return Infinity;
  }
  return total;
}

// A doc's text laid out with two-space indents, or the text as sent when it is not
// JSON or its laid-out form would pass `limit` bytes (deep nesting grows it fast).
export function tidyJson(text, limit) {
  const parsed = parseJson(text);
  if (!parsed.ok || prettyBytes(parsed.value, limit) > limit) return text;
  try {
    return JSON.stringify(parsed.value, null, 2);
  } catch {
    return text;
  }
}
