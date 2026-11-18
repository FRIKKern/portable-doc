// SPDX-License-Identifier: Apache-2.0
// Helpers the diff modules share.

export const isMap = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** JSON with keys sorted at every level: equal for docs that differ only in key order. */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isMap(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

export const blockType = (b) => (isMap(b) && typeof b.type === 'string' && b.type !== '' ? b.type : '(not a block)');
export const blockId = (b) => (isMap(b) && typeof b.id === 'string' && b.id !== '' ? b.id : null);
