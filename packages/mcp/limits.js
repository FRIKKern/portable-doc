import { MAX_VALUE_DEPTH, walkDepth } from '@portable-doc/validate';

export const MAX_NODES = 200_000;
// The arguments object holds the doc one level down. That is the only level the
// argument limit adds, so a doc at the format's own limit always fits.
export const ARGS_LEVEL = 1;
export const MAX_ARGS_DEPTH = MAX_VALUE_DEPTH + ARGS_LEVEL;

const JSON_TEXT = /^[ \t\n\r]*[[{]/;

// Where the normalizer puts what it decodes (ops/persist.js): listItem keeps a
// decoded list in the string's place, and legacyInline flattens a list there but
// wraps a decoded map as [map], one level down. So a map is counted inside a list.
function decoded(string) {
  try {
    const value = JSON.parse(string);
    return [Array.isArray(value) ? value : [value]];
  } catch {
    return [];
  }
}

// Nodes count every value, scalars too. Depth is walkDepth's, as validate counts
// it; with `strings`, the JSON inside a string is walked where the normalizer
// puts it when it decodes the string: a list in the string's place, a map one
// level down, inside a list.
export function measure(value, { strings = false } = {}) {
  const read = new Map();
  const expand = strings
    ? (v) => {
        if (typeof v !== 'string' || !JSON_TEXT.test(v)) return [];
        if (!read.has(v)) read.set(v, decoded(v));
        return read.get(v);
      }
    : undefined;
  let nodes = 0;
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (++nodes > MAX_NODES) return { nodes, depth: null, over: 'nodes' };
    if (v !== null && typeof v === 'object') for (const child of Object.values(v)) stack.push(child);
    else if (expand) for (const inner of expand(v)) stack.push(inner);
  }
  const depth = walkDepth(value, { limit: MAX_ARGS_DEPTH, expand });
  return { nodes, depth, over: depth > MAX_ARGS_DEPTH ? 'depth' : null };
}
