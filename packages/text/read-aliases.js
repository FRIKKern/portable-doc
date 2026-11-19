// SPDX-License-Identifier: Apache-2.0
// One field, one reader. Every renderer (HTML, Markdown, text) and the round-trip canon read a
// field that has old names (alias-table.js) through readField, so all of them pick the same value.
//
// The rule, for one field of one block:
// - A name is absent when its value is undefined, null, a string that is empty or only
//   whitespace, or an empty array; or when its value is not of a type spec/blocks.schema.json
//   gives that name on that block type (alias-types.js, made from the schema). A field the
//   schema types as text reads a string or a finite number. A name the schema does not declare
//   takes the types the schema gives the other names of its field.
// - The first name that is not absent wins: the field's own (current) name first, then its
//   old names in TABLE's order.
// - When every name is absent, the current name's stored value is read as it is: nothing is
//   invented, so a code block of only spaces stays one.

import { TABLE } from './alias-table.js';
import { ALIAS_TYPES } from './alias-types.js';
import { isMap } from './util.js';

export { TABLE };

// "type.field" → [field, ...its old names in TABLE's order], and "type.old" → field.
const NAMES = new Map();
const CURRENT = new Map();
for (const [from, { to }] of Object.entries(TABLE.aliases)) {
  const [type, old] = from.split('.');
  const field = to.slice(type.length + 1);
  if (!NAMES.has(to)) NAMES.set(to, [field]);
  NAMES.get(to).push(old);
  CURRENT.set(from, field);
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

/** The JSON types the schema gives name `name` on a block of `type`, or null when any type is allowed. */
export function typesOf(type, name) {
  return ALIAS_TYPES[`${type}.${name}`] ?? null;
}

/** Whether a name holding `value` counts as absent by blankness alone: undefined, null, a blank string, or an empty array. */
export function absent(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0);
}

/** Whether name `name` of a block of `type` holding `value` counts as absent: blank, or not of a type the schema gives it. */
export function absentAs(type, name, value) {
  if (absent(value)) return true;
  const types = typesOf(type, name);
  return types !== null && !types.some((t) => OF_TYPE[t]?.(value));
}

/** The names `field` of a block of `type` is read under: its own first, then its old names. */
export function namesOf(type, field) {
  return NAMES.get(`${type}.${field}`) ?? [field];
}

/** The current name an old name `key` stands for on a block of `type`, or undefined when `key` is no old name. */
export function currentName(type, key) {
  return CURRENT.get(`${type}.${key}`);
}

/** The convert kind of an old name, or undefined for a plain rename. */
export function convertOf(type, key) {
  return TABLE.aliases[`${type}.${key}`]?.convert;
}

/**
 * Field `field` of `block`, by the rule above: { name, value }, with `name` the name it was
 * read under. A block that is not an object reads as { name: field, value: undefined }.
 */
export function readField(block, field) {
  if (!isMap(block)) return { name: field, value: undefined };
  const type = typeof block.type === 'string' ? block.type : '';
  for (const name of namesOf(type, field)) if (!absentAs(type, name, block[name])) return { name, value: block[name] };
  return { name: field, value: block[field] };
}

/** readField's value alone. */
export const fieldOf = (block, field) => readField(block, field).value;
