import { MAX_VALUE_DEPTH } from '@portable-doc/validate';

export const MAX_NODES = 200_000;
// The arguments object holds the doc one level down, so a doc at the format's
// own limit (MAX_VALUE_DEPTH, counted from the doc) always fits.
export const MAX_DEPTH = MAX_VALUE_DEPTH + 1;

const JSON_TEXT = /^[ \t\n\r]*[[{]/;

function decoded(string) {
  try {
    return [JSON.parse(string)];
  } catch {
    return [];
  }
}

export function measure(value, { strings = false } = {}) {
  let nodes = 0;
  let depth = 0;
  const stack = [[value, 1]];
  while (stack.length) {
    const [v, d] = stack.pop();
    if (++nodes > MAX_NODES) return { nodes, depth, over: 'nodes' };
    // Depth counts arrays and objects only, as validate does: a scalar adds no level.
    if (v !== null && typeof v === 'object') {
      depth = Math.max(depth, d);
      for (const child of Object.values(v)) stack.push([child, d + 1]);
    }
    else if (strings && typeof v === 'string' && JSON_TEXT.test(v)) for (const inner of decoded(v)) stack.push([inner, d + 1]);
  }
  return { nodes, depth, over: depth > MAX_DEPTH ? 'depth' : null };
}
