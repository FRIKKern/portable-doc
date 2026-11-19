// SPDX-License-Identifier: Apache-2.0
// Test helper: which keys do the renderers read on a block that the block leaves out?
// Each block is wrapped in a Proxy that records every get of an absent string key, with
// its path, on the block and on every object and array inside it. Shared by the tests
// that ask what a doc could fill that the goldens do not.

import fs from 'node:fs';

const GOLDENS = new URL('../../goldens/blocks/', import.meta.url);

// Keys a renderer or the runtime asks any object for that are not fields of a doc:
// promise and JSON checks, React's element checks, and the prototype's own.
export const NOT_FIELDS = new Set(['then', 'toJSON', 'constructor', '$$typeof', 'length', '__proto__', 'valueOf', 'toString', 'nodeType', 'props', 'key', 'ref', '_owner', '_store']);

/** Every golden block whose type is in `types`, as { file, block }, in file order. */
export function goldenBlocks(types) {
  const out = [];
  for (const file of fs.readdirSync(GOLDENS).filter((f) => f.endsWith('.golden.json')).sort()) {
    const { input } = JSON.parse(fs.readFileSync(new URL(file, GOLDENS), 'utf8'));
    for (const block of Array.isArray(input) ? input : (input?.blocks ?? [input])) if (block && types.has(block.type)) out.push({ file, block });
  }
  return out;
}

/**
 * Every key that `renders` read on `block`, as { path, present }: each render is called with
 * [proxied block]. A path is a list of keys, with array positions as numbers; `present` is
 * whether the block has the key. Throws what a render throws.
 */
export function reads(block, renders) {
  const seen = new Map();
  const wrap = (v, path) =>
    new Proxy(v, {
      get(t, k, r) {
        if (typeof k === 'string' && !NOT_FIELDS.has(k) && !Array.isArray(t)) {
          const id = JSON.stringify([...path, k]);
          if (!seen.has(id)) seen.set(id, { path: [...path, k], present: k in t });
        }
        const x = Reflect.get(t, k, r);
        return typeof k === 'string' && x && typeof x === 'object' ? wrap(x, [...path, Array.isArray(t) ? Number(k) : k]) : x;
      },
    });
  for (const render of Object.values(renders)) render([wrap(block, [])]);
  return [...seen.values()];
}

/** The paths of the absent keys that `renders` read on `block`. */
export const readsMissing = (block, renders) => reads(block, renders).filter((r) => !r.present).map((r) => r.path);

/** A path's name, with every array position as []: ['items', 2, 'body'] in stats is "stats.items[].body". */
export const pathName = (type, path) => path.reduce((name, key) => (typeof key === 'number' ? `${name}[]` : `${name}.${key}`), type);

/** The names of every key present in `block`, at any depth, as pathName writes them. Iterative. */
export function filledNames(block) {
  const names = new Set();
  const stack = [[block, []]];
  while (stack.length) {
    const [value, path] = stack.pop();
    if (!value || typeof value !== 'object') continue;
    for (const [key, child] of Object.entries(value)) {
      const at = [...path, Array.isArray(value) ? Number(key) : key];
      if (!Array.isArray(value)) names.add(pathName(block.type, at));
      stack.push([child, at]);
    }
  }
  return names;
}
