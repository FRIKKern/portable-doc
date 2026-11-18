// SPDX-License-Identifier: Apache-2.0
// Helpers the diff modules share.

export const isMap = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** How deep a doc may nest, in arrays and objects, before diff refuses it. */
export const MAX_NESTING = 1000;

/** True when a JSON value nests deeper than `limit` arrays and objects. Iterative, so any depth is safe to ask about. */
export function nestsDeeper(value, limit = MAX_NESTING) {
  const stack = [[value, 0]];
  while (stack.length) {
    const [v, d] = stack.pop();
    if (typeof v !== 'object' || v === null) continue;
    if (d >= limit) return true;
    for (const x of Array.isArray(v) ? v : Object.values(v)) stack.push([x, d + 1]);
  }
  return false;
}

/** JSON with keys sorted at every level: equal for docs that differ only in key order. */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isMap(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

export const blockType = (b) => (isMap(b) && typeof b.type === 'string' && b.type !== '' ? b.type : '(not a block)');
export const blockId = (b) => (isMap(b) && typeof b.id === 'string' && b.id !== '' ? b.id : null);
