// SPDX-License-Identifier: Apache-2.0
// Old names folded into their current names, by the one reading rule (readItem, read-aliases.js).
// Two callers share currentNames: canon (golden-reads.mjs), which compares two docs, and the
// import of a ```portabledoc fence, which writes the doc. So the value a doc compares by and the
// value its fence imports as are the same pick.
//
// The fold rewrites only what the readers read as blocks: a block, the places the schema puts
// blocks and inline nodes in it (fence-blocks.js), the item paths the alias table names, and a
// table's cells where its reader takes them (blocks-data.js). Data under any other key (`meta` and
// the like) is kept exactly as written: nothing reads it as a block.

import { blockSchema } from '@portable-doc/validate';
import { mapCellInline, mapTableCells } from './blocks-data.js';
import { ANY, EACH, slotPaths } from './fence-blocks.js';
import { inlineText } from './inline.js';
import { aliasTable, convertOf, currentName, holds, namesOf, readItem } from './read-aliases.js';
import { isMap } from './util.js';

// The inline node types, a mark written as a node among them (`{ type: 'strong', children }`).
export const MARK = { strong: 'strong', bold: 'strong', em: 'em', italic: 'em', strikethrough: 'strike', strike: 'strike', s: 'strike' };
const INLINE = new Set(['text', 'link', 'code', ...Object.keys(MARK)]);
/** Whether `v` is inline content: a non-empty array of inline nodes. */
export const isInline = (v) => Array.isArray(v) && v.length > 0 && v.every((n) => n && INLINE.has(n.type));

// The fields of each owner (a block type, or a block type and the path to its items) that have
// old names, from the alias table.
let ALIASED;
function built() {
  if (ALIASED) return;
  ALIASED = new Map();
  for (const { to } of Object.values(aliasTable().aliases)) {
    const [owner, field] = [to.slice(0, to.lastIndexOf('.')), to.slice(to.lastIndexOf('.') + 1)];
    if (!ALIASED.has(owner)) ALIASED.set(owner, new Set());
    ALIASED.get(owner).add(field);
  }
}

/** The owner a list block's items are keyed on: list.items[] whatever the list type is spelled. */
export const ownType = (type) => (blockSchema.definitions.aliases?.[type]?.['x-alias-of'] === 'list' ? 'list' : type);

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

// A value that holds no text by the readers' own measure (holds, read-aliases.js): null, a blank
// or empty string, an empty array or object. Dropping it loses nothing, so it is never a notice.
const holdsNothing = (x) => x == null || holds(x) < 2;

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
    const lost = (n) => n !== picked.name && (n === field || folded(owner, n)) && !holdsNothing(v[n]) && !isFlag(owner, n, v[n]) && JSON.stringify(converted(owner, field, n, v[n])) !== same;
    out.push({ field, name: picked.name, value: picked.value, dropped: present.filter(lost) });
  }
  return out;
}

// `code` is a block type and an inline node type. A code node with a key an inline code node does
// not have (`lang`, or a block's old name) is a block, so an array of them given alone is blocks.
const INLINE_CODE_KEYS = new Set(['type', 'value', 'children', 'marks']);
const inlineCode = (n) => n.type !== 'code' || Object.keys(n).every((k) => INLINE_CODE_KEYS.has(k));

// Where a block's fold goes on, as a tree of steps (a key, EACH item, ANY value): `kind` 'block'
// or 'inline' where the schema puts one, and every step on the way to one or to an item path the
// alias table names. A key the tree does not hold is kept as written.
const node = () => ({ keys: new Map(), each: null, any: null, kind: undefined });
const step = (at, s) => (s === EACH ? (at.each ??= node()) : s === ANY ? (at.any ??= node()) : at.keys.get(s) ?? at.keys.set(s, node()).get(s));
const TREES = new Map();
function treeOf(type) {
  if (TREES.has(type)) return TREES.get(type);
  built();
  const root = node();
  const { blocks, inline } = slotPaths(type);
  for (const [paths, kind] of [[blocks, 'block'], [inline, 'inline']]) for (const steps of paths) steps.reduce(step, root).kind = kind;
  // An item path ("list.items[]", "task-detail.task.criteria[]") as steps from the block.
  const base = ownType(type);
  for (const owner of ALIASED.keys()) {
    if (!owner.startsWith(`${base}.`)) continue;
    owner.slice(base.length + 1).split('.').flatMap((k) => (k.endsWith('[]') ? [k.slice(0, -2), EACH] : [k])).reduce(step, root);
  }
  TREES.set(type, root);
  return root;
}
// An inline node's own inline nodes sit under `children`, as the inline readers take them (inline.js).
const INLINE_TREE = node();
step(step(INLINE_TREE, 'children'), EACH).kind = 'inline';

/**
 * `v` (blocks, a block, a doc's `{ blocks }`, or inline content given alone) with every old name
 * folded into its current name, by foldFields, wherever the readers read blocks: a field is
 * written where the first of its names stood, and every other key keeps its place.
 * `onDrop({ path, name, field })` is told of each stored value the fold loses, `path` the JSON
 * pointer to it under `at`.
 */
export function currentNames(v, onDrop = () => {}, at = '') {
  if (isInline(v) && v.every(inlineCode)) return v.map((n, i) => inlineNode(n, onDrop, `${at}/${i}`));
  if (Array.isArray(v)) return v.map((x, i) => block(x, onDrop, `${at}/${i}`));
  if (isMap(v) && typeof v.type !== 'string' && Array.isArray(v.blocks)) return { ...v, blocks: currentNames(v.blocks, onDrop, `${at}/blocks`) };
  return block(v, onDrop, at);
}

function block(v, onDrop, at) {
  if (!isMap(v)) return v;
  const type = typeof v.type === 'string' ? v.type : '';
  const out = foldObject(v, type, ownType(type), treeOf(type), onDrop, at);
  if (type !== 'table') return out;
  // A table's cells hold inline nodes where its reader takes them.
  return mapTableCells(out, (cell, p) => mapCellInline(cell, (n, q) => inlineNode(n, onDrop, `${at}${p}${q}`)));
}

function inlineNode(v, onDrop, at) {
  if (!isMap(v)) return v;
  const own = `inline:${v.type}`;
  return foldObject(v, own, own, INLINE_TREE, onDrop, at);
}

/** `v` at tree node `tree`, `path` its item path ("list.items[]"). */
function walk(v, tree, path, onDrop, at) {
  if (tree.kind === 'block') return block(v, onDrop, at);
  if (tree.kind === 'inline') return inlineNode(v, onDrop, at);
  if (Array.isArray(v)) return tree.each ? v.map((x, i) => walk(x, tree.each, `${path}[]`, onDrop, `${at}/${i}`)) : v;
  if (!isMap(v)) return v;
  return foldObject(v, path, path, tree, onDrop, at);
}

function foldObject(v, own, path, tree, onDrop, at) {
  const fields = foldFields(v, own);
  const fieldOf = (k) => fields.find((f) => namesOf(own, f.field).includes(k));
  const inner = (k, x) => {
    const next = tree.keys.get(k) ?? tree.any;
    return next ? walk(x, next, `${path}.${k}`, onDrop, `${at}/${k}`) : x;
  };
  const out = {};
  const written = new Set();
  for (const [k, x] of Object.entries(v)) {
    if (!foldsKey(own, k) || isFlag(own, k, x)) {
      out[k] = inner(k, x);
      continue;
    }
    const f = fieldOf(k);
    if (f && !isFlag(own, f.name, v[f.name])) {
      if (written.has(f.field)) continue;
      written.add(f.field);
      out[f.field] = inner(f.field, f.value);
      for (const name of f.dropped) onDrop({ path: `${at}/${name}`, name, field: f.field });
      continue;
    }
    // No value of k's field is written (each name is null or of the wrong type): k's own goes.
    if (!holdsNothing(x)) onDrop({ path: `${at}/${k}`, name: k, field: currentName(own, k) ?? k });
  }
  return out;
}
