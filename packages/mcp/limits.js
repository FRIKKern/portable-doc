export const MAX_NODES = 200_000;
export const MAX_DEPTH = 1_000;

export function measure(value) {
  let nodes = 0;
  let depth = 0;
  const stack = [[value, 1]];
  while (stack.length) {
    const [v, d] = stack.pop();
    if (++nodes > MAX_NODES) return { nodes, depth, over: 'nodes' };
    depth = Math.max(depth, d);
    if (v !== null && typeof v === 'object') for (const child of Object.values(v)) stack.push([child, d + 1]);
  }
  return { nodes, depth, over: depth > MAX_DEPTH ? 'depth' : null };
}
