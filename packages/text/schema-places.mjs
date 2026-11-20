// SPDX-License-Identifier: Apache-2.0
// Test helper: where readers read text and blocks, against where spec/blocks.schema.json types
// them (schema-places.test.mjs). Readers are run on blocks, each wrapped in a Proxy that records
// every key and array position read. Each read is followed down
// the schema: a place the schema types as blocks starts again at the nested block's own type, and
// a place it types as inline content ends the walk. A read the schema cannot follow is a
// difference, named at its first untyped step ("table.rows[]").

import { blockSchema } from '@portable-doc/validate';
import { isInline } from './current-names.js';
import { NOT_FIELDS, READ_ALIASES } from './golden-reads.mjs';
import { BLOCK_TYPES } from './index.js';

const TYPES = new Set(BLOCK_TYPES);

const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const resolve = (ref) => ref.slice(1).split('/').filter(Boolean).reduce((n, k) => (isMap(n) ? n[k] : undefined), blockSchema);
const DEFINITIONS = new Map();
for (const rule of blockSchema.allOf ?? []) {
  const type = rule?.if?.properties?.type?.const;
  if (typeof type === 'string' && typeof rule?.then?.$ref === 'string') DEFINITIONS.set(type, resolve(rule.then.$ref));
}
const BLOCK = Symbol('blocks');
const INLINE = Symbol('inline');

/** The schema nodes `nodes` stand for, their refs and anyOf/oneOf/allOf opened: BLOCK or INLINE where a ref ends in one. */
function open(nodes) {
  const out = [];
  const stack = [...nodes];
  while (stack.length) {
    const n = stack.pop();
    if (n === BLOCK || n === INLINE) out.push(n);
    if (!isMap(n)) continue;
    if (n.$ref === '#') out.push(BLOCK);
    else if (n.$ref === '#/definitions/inline') out.push(INLINE);
    else if (typeof n.$ref === 'string') stack.push(resolve(n.$ref));
    else {
      out.push(n);
      for (const k of ['anyOf', 'oneOf', 'allOf']) for (const sub of Array.isArray(n[k]) ? n[k] : []) stack.push(sub);
    }
  }
  return out;
}

/** The schema nodes one step (a key, or an array position as a number) leads to from `nodes`. */
const step = (nodes, key) =>
  open(
    nodes.flatMap((n) => {
      if (!isMap(n)) return [];
      if (typeof key === 'number') return isMap(n.items) ? [n.items] : [];
      if (isMap(n.properties) && Object.hasOwn(n.properties, key)) return [n.properties[key]];
      return isMap(n.additionalProperties) ? [n.additionalProperties] : [];
    }),
  );

/**
 * Every key and array position `renders` read on `block`, as { path, value, present }: `value`
 * what the read gave. Keys a runtime asks any object for (NOT_FIELDS) are left out, and so are an
 * array's own members (`map`, `length`): only its positions are its fields.
 */
export function readsWithValues(block, renders) {
  const seen = new Map();
  const wrap = (v, path) =>
    new Proxy(v, {
      get(t, k, r) {
        const x = Reflect.get(t, k, r);
        if (typeof k !== 'string') return x;
        const index = Array.isArray(t) ? (/^(0|[1-9]\d*)$/.test(k) ? Number(k) : null) : NOT_FIELDS.has(k) ? null : k;
        if (index === null) return x;
        const at = [...path, index];
        const id = JSON.stringify(at);
        if (!seen.has(id)) seen.set(id, { path: at, value: x, present: Object.hasOwn(t, k) });
        return x && typeof x === 'object' ? wrap(x, at) : x;
      },
    });
  for (const render of Object.values(renders)) render([wrap(block, [])]);
  return [...seen.values()];
}

const DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const isBlocks = (v) => Array.isArray(v) && v.length > 0 && v.every((b) => isMap(b) && TYPES.has(b.type));

/** What a value read holds: inline content, blocks, text, or other (a number, a flag, a date); undefined for an array or object whose own reads say. */
function kindOf(v) {
  if (isInline(v)) return 'inline';
  if (isBlocks(v) || (isMap(v) && TYPES.has(v.type))) return 'blocks';
  if (typeof v === 'string') return DATE.test(v) ? 'other' : 'text';
  if (typeof v === 'number' || typeof v === 'boolean') return 'other';
  return undefined;
}

/**
 * Where a read of `path` on `block` leaves the schema: { name, kind } at its first untyped step,
 * `kind` what the read holds there (inline content, read further, is inline), or null when the
 * schema types every step of it.
 */
function difference(block, path) {
  let nodes = open([DEFINITIONS.get(block.type) ?? {}]);
  let name = block.type;
  let value = block;
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    value = value?.[key];
    name += typeof key === 'number' ? '[]' : `.${key}`;
    const next = step(nodes, key);
    if (next.includes(INLINE)) return null;
    if (next.includes(BLOCK)) {
      if (!isMap(value) || typeof value.type !== 'string') return null;
      nodes = open([DEFINITIONS.get(value.type) ?? {}]);
      name = value.type;
      continue;
    }
    if (!next.length) {
      // From the untyped step down: the first value that is inline content or blocks says what the
      // place holds, else the value the read gave.
      const below = [value];
      for (let j = i + 1; j < path.length; j++) below.push(below.at(-1)?.[path[j]]);
      const held = below.map(kindOf).find((k) => k === 'inline' || k === 'blocks');
      return { name, kind: held ?? kindOf(below.at(-1)) };
    }
    nodes = next;
  }
  return null;
}

/** The differences `renders` show on `cases` ({ block }s): { gaps, probed, oldNames }, each sorted. */
export function places(cases, renders) {
  const kinds = new Map();
  const filled = new Set();
  for (const { block } of cases) {
    for (const { path, value, present } of readsWithValues(block, renders)) {
      const d = difference(block, path);
      if (!d) continue;
      if (!kinds.has(d.name)) kinds.set(d.name, new Set());
      if (present && value !== undefined) {
        filled.add(d.name);
        if (d.kind) kinds.get(d.name).add(d.kind);
      }
    }
  }
  const out = { gaps: {}, probed: [], oldNames: [] };
  for (const name of [...kinds.keys()].sort()) {
    // An old name (spec/read-aliases.json) is read by the one-field-one-name rule, not a hole.
    if (Object.hasOwn(READ_ALIASES, name)) out.oldNames.push(name);
    else if (!filled.has(name)) out.probed.push(name);
    else out.gaps[name] = [...kinds.get(name)].sort().join(' ') || 'other';
  }
  return out;
}

