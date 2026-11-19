// SPDX-License-Identifier: Apache-2.0
// One field, one reader. Every renderer (HTML, Markdown, text) and the round-trip canon read a
// field that has old names (alias-table.js) through readField (a block's field) or readItem (an
// item's or an inline node's field), so all of them pick the same value.
//
// An owner is what a key names before its field: a block type ("code"), a block type and the
// path to a list of items in it ("steps.steps[]"), or an inline node type ("inline:text").
//
// The rule is the sentence in alias-table.js's _comment, its one source (the text package's
// README carries a copy written by scripts/write-readme.mjs). readItem below follows it.
// "Missing" is no own property or undefined. A name's type is what spec/blocks.schema.json gives it
// on its owner (alias-types.js, made from the schema); a name the schema does not declare takes the
// types of its field's other names, or, where it types none of them, those main's reader accepted
// (UNTYPED in scripts/generate-alias-types.mjs; null: any). Text is a string or a finite number.
// The column is ALIAS_CURRENT_WHITESPACE_WINS in alias-types.js, made from the table's
// currentWhitespaceWins: yes where main showed a whitespace-only current name.

import { TABLE } from './alias-table.js';
import { ALIAS_CURRENT_WHITESPACE_WINS, ALIAS_TYPES } from './alias-types.js';

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
  deepFreeze(ALIAS_CURRENT_WHITESPACE_WINS);
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

/** Whether `value` is of a type the schema gives name `name` of `owner`. */
function ofTypes(owner, name, value) {
  const types = typesOf(owner, name);
  return types === null || types.some((t) => OF_TYPE[t]?.(value));
}

/** The table's column 'a whitespace-only value under the current name wins' for field `field` of `owner`; a field with no old names: false. */
export function currentWhitespaceWins(owner, field) {
  built();
  return ALIAS_CURRENT_WHITESPACE_WINS[`${owner}.${field}`] === true;
}

/** What a value holds: 2, a non-whitespace character; 1, only whitespace; 0, no character. A string holds the characters it has; a non-empty array, a number or a non-empty object holds a non-whitespace character. */
export function holds(value) {
  if (typeof value === 'string') return value === '' ? 0 : /\S/.test(value) ? 2 : 1;
  return (Array.isArray(value) && value.length > 0) || typeof value === 'number' || (isMap(value) && Object.keys(value).length > 0) ? 2 : 0;
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
  const spaceWins = currentWhitespaceWins(owner, field);
  let first, spaced;
  for (const name of namesOf(owner, field)) {
    // A get first, so a reader traced by a Proxy (golden-reads.mjs) sees every name it looks at.
    const got = item[name];
    const value = got !== undefined && Object.hasOwn(item, name) ? got : undefined;
    if (value === undefined || value === null || !ofTypes(owner, name, value)) continue;
    const held = holds(value);
    if (held === 2 || (held === 1 && spaceWins)) return { name, value };
    if (held === 1) spaced ??= { name, value };
    first ??= { name, value };
  }
  return spaced ?? first ?? { name: field, value: undefined };
}

/** readItem's value alone. */
export const itemOf = (item, owner, field) => readItem(item, owner, field).value;
