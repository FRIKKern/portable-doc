// SPDX-License-Identifier: Apache-2.0
// One field, one reader. Every renderer (HTML, Markdown, text) and the round-trip canon read a
// field that has old names (alias-table.js) through readField (a block's field) or readItem (an
// item's or an inline node's field), so all of them pick the same value.
//
// An owner is what a key names before its field: a block type ("code"), a block type and the
// path to a list of items in it ("steps.steps[]"), or an inline node type ("inline:text").
//
// The rule, for one field of one block or item:
// - A name is absent when its value is undefined, null, a string that is empty or only
//   whitespace, or an empty array; or when its value is not of a type spec/blocks.schema.json
//   gives that name on that block type or item (alias-types.js, made from the schema). A name
//   the schema does not declare takes the types the schema gives the other names of its field;
//   where it types none of them (an item or an inline node it leaves open), each reads text, but
//   the inline side of a convert reads an array (inline-from-string's current name,
//   text-from-inline's old name). A name typed as text reads a string or a finite number.
// - The first name that is not absent wins: the field's own (current) name first, then its
//   old names in TABLE's order.
// - When every name is absent, the current name's stored value is read as it is: nothing is
//   invented, so a code block of only spaces stays one.

import { TABLE } from './alias-table.js';
import { ALIAS_TYPES } from './alias-types.js';

// util.js's isMap, written here: util.js does work at load, and React bundles this module alone.
const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Nothing runs at load, so a bundle that imports this module and never reads a field leaves
// the table out. The first read freezes the table and the types and builds the name lists.
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) for (const inner of Object.values(Object.freeze(value))) deepFreeze(inner);
  return value;
};

let NAMES; // "owner.field" → [field, ...its old names in TABLE's order]
let CURRENT; // "owner.old" → field

/** A key split at its last ".": [owner, name]. */
const split = (key) => [key.slice(0, key.lastIndexOf('.')), key.slice(key.lastIndexOf('.') + 1)];

function built() {
  if (NAMES) return;
  deepFreeze(TABLE);
  deepFreeze(ALIAS_TYPES);
  const names = new Map();
  const current = new Map();
  for (const [from, { to }] of Object.entries(TABLE.aliases)) {
    const [, old] = split(from);
    const [, field] = split(to);
    if (!names.has(to)) names.set(to, [field]);
    names.get(to).push(old);
    current.set(from, field);
  }
  [NAMES, CURRENT] = [names, current];
}

/** The alias table, frozen: { _comment, aliases: { "owner.old": { to, reason, convert? } } }. */
export function aliasTable() {
  built();
  return TABLE;
}

const OF_TYPE = {
  // A field the schema types as text reads a string or a finite number: every renderer shows a number as its digits.
  string: (v) => typeof v === 'string' || Number.isFinite(v),
  number: (v) => typeof v === 'number',
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => isMap(v),
  null: (v) => v === null,
};

/** The JSON types the schema gives name `name` of `owner` (a block type, an item path or an inline node), or null when any type is allowed. */
export function typesOf(owner, name) {
  built();
  return ALIAS_TYPES[`${owner}.${name}`] ?? null;
}

/** Whether a name holding `value` counts as absent by blankness alone: undefined, null, a blank string, or an empty array. */
export function absent(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0);
}

/** Whether name `name` of `owner` holding `value` counts as absent: blank, or not of a type the schema gives it. */
export function absentAs(owner, name, value) {
  if (absent(value)) return true;
  const types = typesOf(owner, name);
  return types !== null && !types.some((t) => OF_TYPE[t]?.(value));
}

/** The names `field` of `owner` is read under: its own first, then its old names. */
export function namesOf(owner, field) {
  built();
  return NAMES.get(`${owner}.${field}`) ?? [field];
}

/** The current name an old name `key` of `owner` stands for, or undefined when `key` is no old name. */
export function currentName(owner, key) {
  built();
  return CURRENT.get(`${owner}.${key}`);
}

/** The convert kind of an old name of `owner`, or undefined for a plain rename. */
export function convertOf(owner, key) {
  return aliasTable().aliases[`${owner}.${key}`]?.convert;
}

/**
 * Field `field` of `block`, by the rule above: { name, value }, with `name` the name it was
 * read under. A block that is not an object reads as { name: field, value: undefined }.
 */
export function readField(block, field) {
  return readItem(block, isMap(block) && typeof block.type === 'string' ? block.type : '', field);
}

/** readField's value alone. */
export const fieldOf = (block, field) => readField(block, field).value;

/**
 * Field `field` of `item`, an object of `owner` ("steps.steps[]", "inline:text"), by the same
 * rule: { name, value }. An item that is not an object reads as { name: field, value: undefined }.
 */
export function readItem(item, owner, field) {
  if (!isMap(item)) return { name: field, value: undefined };
  for (const name of namesOf(owner, field)) if (!absentAs(owner, name, item[name])) return { name, value: item[name] };
  return { name: field, value: item[field] };
}

/** readItem's value alone. */
export const itemOf = (item, owner, field) => readItem(item, owner, field).value;
