// SPDX-License-Identifier: Apache-2.0
// Test helper: which keys do the renderers read on a block that the block leaves out?
// Each block is wrapped in a Proxy that records every get of an absent string key, with
// its path, on the block and on every object and array inside it. Shared by the tests
// that ask what a doc could fill that the goldens do not.

import fs from 'node:fs';
import { blockSchema, validate } from '@portable-doc/validate';

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

// ── the behaviour net ────────────────────────────────────────────────────
// A renderer that copies an object (`{ ...item }`) before reading it reads the copy, which no
// Proxy sees. So a key counts as read when giving it a valid value changes what a render
// writes. The candidates at each object of a block are the keys the schema declares there,
// and the keys the Proxy sees read there. An object the schema leaves open (a stats item, an
// inline node) gets every key the schema declares anywhere. Each candidate is tried with
// the samples for each type the schema gives it.

const TEXT = 'Sample text';
// One sample table, keyed by schema type: each row gives the valid values to try.
const SAMPLES = {
  string: (node) => node.enum ?? (node.const !== undefined ? [node.const] : [TEXT]),
  integer: (node) => [Math.min(Math.max(3, node.minimum ?? 3), node.maximum ?? 3)],
  number: (node) => [Math.min(Math.max(7.5, node.minimum ?? 7.5), node.maximum ?? 7.5)],
  boolean: () => [true, false],
  array: (node, depth) => sampleValues(node.items ?? {}, depth + 1).slice(0, 1).map((item) => [item, item, item]),
  object: (node, depth) => [Object.fromEntries(Object.entries(node.properties ?? {}).map(([key, child]) => [key, sampleValues(child, depth + 1)[0]]))],
  inline: () => [{ type: 'text', value: TEXT }],
  block: () => [{ type: 'paragraph', content: [{ type: 'text', value: TEXT }] }],
};
// The types to try for a key the schema names nowhere.
const ANY_TYPE = [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'array', items: { type: 'string' } }];

/** A schema node with its $ref followed, or 'inline' / 'block' for the two shared definitions. */
function deref(node) {
  if (node?.$ref === '#') return 'block';
  if (node?.$ref === '#/definitions/inline') return 'inline';
  return node?.$ref ? node.$ref.split('/').slice(1).reduce((at, key) => at[key], blockSchema) : node;
}

/** The plain branches of a schema node: refs followed, anyOf and oneOf spread. */
function branches(node) {
  const out = [];
  const stack = [node];
  while (stack.length) {
    const at = deref(stack.pop());
    if (at === undefined) continue;
    if (typeof at === 'object' && (at.anyOf || at.oneOf)) stack.push(...(at.anyOf ?? at.oneOf));
    else out.push(at);
  }
  return out;
}

/** The valid values to try for a schema node, from SAMPLES. */
function sampleValues(node, depth = 0) {
  if (depth > 3) return [];
  return branches(node).flatMap((at) => {
    if (typeof at === 'string') return SAMPLES[at]();
    if (at.const !== undefined) return [at.const];
    const types = Array.isArray(at.type) ? at.type : [at.type ?? (at.properties ? 'object' : at.items ? 'array' : 'string')];
    return types.flatMap((type) => SAMPLES[type]?.(at, depth) ?? []);
  });
}

// Every key the schema declares anywhere, with each schema node it is declared with.
const DECLARED = new Map();
for (const stack = [blockSchema]; stack.length; ) {
  const node = stack.pop();
  if (!node || typeof node !== 'object') continue;
  if (node.properties && !Array.isArray(node.properties)) {
    for (const [key, child] of Object.entries(node.properties)) DECLARED.set(key, [...(DECLARED.get(key) ?? []), child]);
  }
  stack.push(...Object.values(node));
}

/** The keys the schema declares for the object at `path` in a block of `type`, as key → schema nodes; null where it leaves the object open. */
function declaredAt(type, path) {
  let nodes = [blockSchema.definitions.blocks[type] ?? {}];
  for (const key of path) nodes = branches({ anyOf: nodes }).flatMap((at) => (typeof at !== 'object' ? [] : typeof key === 'number' ? (at.items ? [at.items] : []) : (at.properties?.[key] ? [at.properties[key]] : [])));
  const keys = new Map();
  for (const at of branches({ anyOf: nodes })) {
    if (typeof at === 'object') for (const [key, child] of Object.entries(at.properties ?? {})) if (key !== 'type') keys.set(key, [...(keys.get(key) ?? []), child]);
  }
  return keys.size ? keys : null;
}

const outputs = (blocks, renders) =>
  JSON.stringify(Object.values(renders).map((render) => {
    try {
      return render(blocks);
    } catch (error) {
      return `threw: ${error.message}`;
    }
  }));

const objectAt = (block, path) => path.reduce((at, key) => at[key], block);

/** Unique valid-looking values for `nodes`, from SAMPLES. */
const valuesFor = (nodes) => [...new Map(nodes.flatMap((node) => sampleValues(node)).map((value) => [JSON.stringify(value), value])).values()];

/**
 * Does `key` on the object at `path` of `block` change what `renders` write, against
 * `before` (the outputs of `block` as it is)? A key the object has: does taking it out
 * change them? A key it leaves out: does some value from `nodes` that passes validate?
 * Works on `block` in place and puts it back.
 */
function probe(block, path, key, nodes, renders, before) {
  const at = objectAt(block, path);
  if (Object.hasOwn(at, key)) {
    const kept = at[key];
    delete at[key];
    const changed = outputs([block], renders) !== before;
    at[key] = kept;
    return changed;
  }
  for (const value of valuesFor(nodes)) {
    at[key] = value;
    const changed = outputs([block], renders) !== before && validate({ blocks: [block] }).ok === true;
    delete at[key];
    if (changed) return true;
  }
  return false;
}

/** Does `key` on the object at `path` change a render? See probe; `block` is not changed. */
export function changesRender(block, path, key, renders, nodes = DECLARED.get(key) ?? ANY_TYPE) {
  const copy = structuredClone(block);
  return probe(copy, path, key, nodes, renders, outputs([copy], renders));
}

/**
 * For each object in `block`, once per pathName, the keys a doc could fill there that the
 * object leaves out: the keys the schema declares at it (every key the schema declares
 * anywhere, where it leaves the object open) and the keys the Proxy sees `renders` read
 * there. As { path, declared, keys: [{ key, nodes }] }, `nodes` being the schema nodes to
 * draw sample values from.
 */
export function candidates(block, renders) {
  const seen = new Map();
  for (const { path } of reads(block, renders)) {
    const at = JSON.stringify(path.slice(0, -1));
    seen.set(at, new Set([...(seen.get(at) ?? []), path.at(-1)]));
  }
  const out = [];
  const done = new Set();
  const stack = [[block, []]];
  while (stack.length) {
    const [value, path] = stack.pop();
    if (!value || typeof value !== 'object') continue;
    for (const [key, child] of Object.entries(value)) stack.push([child, [...path, Array.isArray(value) ? Number(key) : key]]);
    const name = pathName(block.type, path);
    if (Array.isArray(value) || done.has(name)) continue;
    done.add(name);
    const declared = declaredAt(block.type, path);
    const keys = [...new Set([...(declared ?? DECLARED).keys(), ...(seen.get(JSON.stringify(path)) ?? [])])]
      .filter((key) => key !== 'type' && !NOT_FIELDS.has(key) && !Object.hasOwn(value, key))
      .map((key) => ({ key, nodes: declared?.get(key) ?? DECLARED.get(key) ?? ANY_TYPE }));
    out.push({ path, declared, keys });
  }
  return out;
}

/**
 * The paths of the keys `block` leaves out that change a render when given a valid value.
 * A key that changes nothing alone is tried again with each boolean the schema declares
 * beside it flipped, since a key can matter only under a flag (a list's start, once ordered).
 */
export function behaviourReads(block, renders) {
  const copy = structuredClone(block);
  const before = outputs([copy], renders);
  const found = [];
  for (const { path, declared, keys } of candidates(block, renders)) {
    const quiet = keys.filter(({ key, nodes }) => {
      if (!probe(copy, path, key, nodes, renders, before)) return true;
      found.push([...path, key]);
      return false;
    });
    const flags = [...(declared ?? new Map())].filter(([, nodes]) => nodes.some((node) => node.type === 'boolean')).map(([flag]) => flag);
    for (const flag of flags) {
      const at = objectAt(copy, path);
      const had = Object.hasOwn(at, flag);
      const kept = at[flag];
      at[flag] = !kept;
      const flipped = outputs([copy], renders);
      for (const { key, nodes } of quiet) if (key !== flag && !found.some((p) => p.at(-1) === key && p.length === path.length + 1) && probe(copy, path, key, nodes, renders, flipped)) found.push([...path, key]);
      if (had) at[flag] = kept;
      else delete at[flag];
    }
  }
  return found;
}

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
