export const MAX_NODES = 200_000;
export const MAX_DEPTH = 1_000;

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
    depth = Math.max(depth, d);
    if (v !== null && typeof v === 'object') for (const child of Object.values(v)) stack.push([child, d + 1]);
    else if (strings && typeof v === 'string' && JSON_TEXT.test(v)) for (const inner of decoded(v)) stack.push([inner, d + 1]);
  }
  return { nodes, depth, over: depth > MAX_DEPTH ? 'depth' : null };
}
