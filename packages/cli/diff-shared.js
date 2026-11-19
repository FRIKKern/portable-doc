// SPDX-License-Identifier: Apache-2.0
// Helpers the diff modules share.

export const isMap = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

class Text {
  constructor(text) {
    this.text = text;
  }
}
const [OPEN_LIST, CLOSE_LIST, OPEN_MAP, CLOSE_MAP, COMMA] = ['[', ']', '{', '}', ','].map((t) => new Text(t));

/**
 * JSON with keys sorted at every level: equal for docs that differ only in key order.
 * Iterative, and every part is joined once at the end, so a deep value costs its size, not depth × size.
 */
export function canon(value) {
  const parts = [];
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (v instanceof Text) parts.push(v.text);
    else if (Array.isArray(v)) {
      stack.push(CLOSE_LIST);
      for (let i = v.length - 1; i >= 0; i--) {
        stack.push(v[i]);
        if (i) stack.push(COMMA);
      }
      stack.push(OPEN_LIST);
    } else if (isMap(v)) {
      const keys = Object.keys(v).sort();
      stack.push(CLOSE_MAP);
      for (let i = keys.length - 1; i >= 0; i--) stack.push(v[keys[i]], new Text(`${i ? ',' : ''}${JSON.stringify(keys[i])}:`));
      stack.push(OPEN_MAP);
    } else parts.push(JSON.stringify(v) ?? 'null');
  }
  return parts.join('');
}

export const blockType = (b) => (isMap(b) && typeof b.type === 'string' && b.type !== '' ? b.type : '(not a block)');
export const blockId = (b) => (isMap(b) && typeof b.id === 'string' && b.id !== '' ? b.id : null);
