// SPDX-License-Identifier: Apache-2.0
// Old names folded into their current names, by the one reading rule (readItem, read-aliases.js).
// Two callers share foldFields: canon (golden-reads.mjs), which compares two docs, and the import
// of a ```portabledoc fence (currentNames), which writes the doc. So the value a doc compares by
// and the value its fence imports as are the same pick.

import { blockSchema } from '@portable-doc/validate';
import { inlineText } from './inline.js';
import { aliasTable, convertOf, currentName, namesOf, readItem } from './read-aliases.js';
import { isMap } from './util.js';

// The inline node types, a mark written as a node among them (`{ type: 'strong', children }`).
export const MARK = { strong: 'strong', bold: 'strong', em: 'em', italic: 'em', strikethrough: 'strike', strike: 'strike', s: 'strike' };
const INLINE = new Set(['text', 'link', 'code', ...Object.keys(MARK)]);
/** Whether `v` is inline content: a non-empty array of inline nodes. */
export const isInline = (v) => Array.isArray(v) && v.length > 0 && v.every((n) => n && INLINE.has(n.type));

// The fields of each owner (a block type, or a block type and the path to its items) that have
// old names, from the alias table; and every owner with the paths that lead to one.
let ALIASED;
let OWNERS;
function built() {
  if (ALIASED) return;
  ALIASED = new Map();
  OWNERS = new Set();
  for (const { to } of Object.values(aliasTable().aliases)) {
    const [owner, field] = [to.slice(0, to.lastIndexOf('.')), to.slice(to.lastIndexOf('.') + 1)];
    if (!ALIASED.has(owner)) ALIASED.set(owner, new Set());
    ALIASED.get(owner).add(field);
    for (let i = owner.indexOf('.'); i !== -1; i = owner.indexOf('.', i + 1)) OWNERS.add(owner.slice(0, i));
    OWNERS.add(owner);
  }
}

/** The owner a list block's items are keyed on: list.items[] whatever the list type is spelled. */
export const ownType = (type) => (blockSchema.definitions.aliases?.[type]?.['x-alias-of'] === 'list' ? 'list' : type);

/** The item path that key `k`, holding `x`, of an object at `path` leads to, or undefined when no old name sits under it. */
export function innerPath(path, k, x) {
  built();
  const p = `${path}.${k}${Array.isArray(x) ? '[]' : ''}`;
  return OWNERS.has(p) ? p : undefined;
}

// An old name the fold takes into its field. A table's `cols` is kept as it is: the renderers read
// it for each column's type even beside a real `columns`, and never build a head from it.
const folded = (owner, key) => currentName(owner, key) !== undefined && convertOf(owner, key) !== 'columns-from-cols';

/** Whether key `key` of an object of `owner` is read by the fold: a field with old names, or an old name it folds. */
export function foldsKey(owner, key) {
  built();
  return !!ALIASED.get(owner)?.has(key) || folded(owner, key);
}

// A table's `header: true` is a flag (the first row is the head), not head's array form, so the
// fold never takes it.
const isFlag = (owner, name, value) => convertOf(owner, name) === 'head-from-header' && !Array.isArray(value);

/** Old name `name`'s value as its field holds it: a string as one text run, an inline array as its flat text. */
function converted(owner, field, name, value) {
  if (name === field) return value;
  const kind = convertOf(owner, name);
  if (kind === 'inline-from-string' && typeof value === 'string') return [{ type: 'text', value }];
  if (kind === 'text-from-inline' && Array.isArray(value)) return inlineText(value);
  return value;
}

/**
 * The fold of object `v` of `owner`, in the table's field order: for each field of `owner` that
 * `v` holds under some name, { field, name, value, dropped }. `value` is what readItem picks,
 * converted to the field's form, and `name` the name it was stored under. When no name remains
 * (each is null or of the wrong type), the current name's stored value is kept as it is. A field
 * picked from `cols` is left out: `cols` stays. `dropped` names each other stored name whose
 * non-null value differs from the one picked.
 */
export function foldFields(v, owner) {
  built();
  const out = [];
  for (const field of ALIASED.get(owner) ?? []) {
    const present = namesOf(owner, field).filter((name) => Object.hasOwn(v, name));
    if (!present.length) continue;
    const { name, value } = readItem(v, owner, field);
    const picked = value === undefined ? { name: field, value: v[field] } : { name, value: converted(owner, field, name, value) };
    if (picked.value === undefined || !(picked.name === field || folded(owner, picked.name))) continue;
    const same = JSON.stringify(picked.value);
    const lost = (n) => n !== picked.name && (n === field || folded(owner, n)) && v[n] != null && !isFlag(owner, n, v[n]) && JSON.stringify(converted(owner, field, n, v[n])) !== same;
    out.push({ field, name: picked.name, value: picked.value, dropped: present.filter(lost) });
  }
  return out;
}

// `code` is a block type and an inline node type. A code node with a key an inline code node does
// not have (`lang`, or a block's old name) is a block, so an array of them is blocks, not inline.
// Canon reads such an array as inline content, comparing the code's text only; the fold must not.
const INLINE_CODE_KEYS = new Set(['type', 'value', 'children', 'marks']);
const inlineCode = (n) => n.type !== 'code' || Object.keys(n).every((k) => INLINE_CODE_KEYS.has(k));

/**
 * `v` (blocks, or one block) with every old name folded into its current name, by foldFields: a
 * field is written where the first of its names stood, and every other key keeps its place.
 * `onDrop({ path, name, field })` is told of each stored value the fold loses, `path` the JSON
 * pointer to it under `at`.
 */
export function currentNames(v, onDrop = () => {}, at = '', owner = undefined) {
  if (isInline(v) && v.every(inlineCode)) return v.map((n, i) => foldObject(n, `inline:${n.type}`, `inline:${n.type}`, onDrop, `${at}/${i}`));
  if (Array.isArray(v)) return v.map((x, i) => currentNames(x, onDrop, `${at}/${i}`, owner));
  if (!isMap(v)) return v;
  const type = typeof v.type === 'string' ? v.type : '';
  return foldObject(v, owner ?? type, owner ?? ownType(type), onDrop, at);
}

function foldObject(v, own, path, onDrop, at) {
  if (!isMap(v)) return v;
  const fields = foldFields(v, own);
  const fieldOf = (k) => fields.find((f) => namesOf(own, f.field).includes(k));
  const out = {};
  const written = new Set();
  for (const [k, x] of Object.entries(v)) {
    if (!foldsKey(own, k) || isFlag(own, k, x)) {
      out[k] = currentNames(x, onDrop, `${at}/${k}`, innerPath(path, k, x));
      continue;
    }
    const f = fieldOf(k);
    if (f && !isFlag(own, f.name, v[f.name])) {
      if (written.has(f.field)) continue;
      written.add(f.field);
      out[f.field] = currentNames(f.value, onDrop, `${at}/${f.field}`, innerPath(path, f.field, f.value));
      for (const name of f.dropped) onDrop({ path: `${at}/${name}`, name, field: f.field });
      continue;
    }
    // No value of k's field is written (each name is null or of the wrong type): k's own goes.
    if (x != null) onDrop({ path: `${at}/${k}`, name: k, field: currentName(own, k) ?? k });
  }
  return out;
}
