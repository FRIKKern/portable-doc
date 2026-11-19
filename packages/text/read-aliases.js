// SPDX-License-Identifier: Apache-2.0
// One field, one reader. TABLE lists the second names a reader still accepts for a block
// field, in the shape of the pack's spec/read-aliases.json. Until that file is synced into
// spec/, this module is its one home here; when it is, the synced file takes TABLE's place,
// with a test that the two are equal. Every renderer (HTML, Markdown, text) and the round-trip
// canon read an aliased field through readField, so all of them pick the same value.
//
// The rule, for one field of one block:
// - A name is absent when its value is undefined, null, a string that is empty or only
//   whitespace, or an empty array; or when its value is not of a type spec/blocks.schema.json
//   gives that name on that block type. A name the schema does not declare takes the types
//   the schema gives the other names of its field.
// - The first name that is not absent wins: the field's own (current) name first, then its
//   old names in TABLE's order.
// - When every name is absent, the current name's stored value is read as it is: nothing is
//   invented, so a code block of only spaces stays one.

import schema from '../../spec/blocks.schema.json' with { type: 'json' };
import { isMap } from './util.js';

const deepFreeze = (value) => {
  if (value && typeof value === 'object') for (const inner of Object.values(Object.freeze(value))) deepFreeze(inner);
  return value;
};

export const TABLE = deepFreeze({
  _comment: 'Second names a reader still accepts. When a block holds both names, the `to` name wins. An entry without `convert` is a plain rename; a `convert` kind is implemented by every reader and tested by the shared case of that kind.',
  aliases: {
    'asciicast.poster': { to: 'asciicast.posterAt', reason: 'renamed 2026-11-19; poster means an address on every other block' },
    'blockquote.attribution': { to: 'blockquote.cite', reason: 'the schema took both; cite is the one name, as the golden uses it' },
    'callout.text': { to: 'callout.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string' },
    'code.code': { to: 'code.value', reason: 'four names held the code source; value is the one name, as the golden uses it' },
    'code.content': { to: 'code.value', reason: 'four names held the code source; value is the one name, as the golden uses it' },
    'code.language': { to: 'code.lang', reason: 'never in the spec; read because renderers accepted it' },
    'code.text': { to: 'code.value', reason: 'four names held the code source; value is the one name, as the golden uses it' },
    'expandable.children': { to: 'expandable.blocks', reason: 'blocks is the one name for an expandable\'s nested blocks, as the golden and the renderers use it' },
    'eyebrow.text': { to: 'eyebrow.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string' },
    'heading.text': { to: 'heading.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string' },
    'paragraph.text': { to: 'paragraph.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string' },
    'pullquote.text': { to: 'pullquote.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string' },
    'table.cols': { to: 'table.columns', reason: 'two names for the column list; columns is the one name and gains each column\'s type from cols', convert: 'columns-from-cols' },
    'table.header': { to: 'table.head', reason: 'header\'s array form is head; header: true means the first row is the head', convert: 'head-from-header' },
    'terminal.blocks': { to: 'terminal.children', reason: 'children is the one name for nested blocks, as on every container' },
  },
});

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

// The JSON types the schema allows for a node, or null when it does not constrain the type.
function schemaTypes(node, seen = new Set()) {
  if (node === undefined || node === true) return null;
  if (node.$ref === '#') return ['object'];
  if (node.$ref) {
    if (seen.has(node.$ref)) return null;
    seen.add(node.$ref);
    return schemaTypes(node.$ref.split('/').slice(1).reduce((at, key) => at?.[key], schema), seen);
  }
  const options = node.anyOf ?? node.oneOf;
  if (options) {
    const all = options.map((option) => schemaTypes(option, new Set(seen)));
    return all.includes(null) ? null : [...new Set(all.flat())];
  }
  if (node.type !== undefined) return Array.isArray(node.type) ? node.type : [node.type];
  const constants = node.const !== undefined ? [node.const] : node.enum;
  if (constants) return [...new Set(constants.map((v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)))];
  if (node.properties) return ['object'];
  if (node.items) return ['array'];
  return null;
}

// "type.name" → the JSON types a name of an aliased field may hold (null: any), from the schema.
const TYPES = new Map();
for (const [key, names] of NAMES) {
  const type = key.slice(0, key.indexOf('.'));
  const properties = derefBlock(type)?.properties;
  const declared = names.map((name) => (properties && Object.hasOwn(properties, name) ? schemaTypes(properties[name]) : undefined));
  const known = declared.filter((t) => t !== undefined);
  const fallback = known.length === 0 || known.includes(null) ? null : [...new Set(known.flat())];
  names.forEach((name, i) => TYPES.set(`${type}.${name}`, declared[i] === undefined ? fallback : declared[i]));
}

function derefBlock(type) {
  let node = schema.definitions?.blocks?.[type];
  while (node?.$ref) node = node.$ref.split('/').slice(1).reduce((at, key) => at?.[key], schema);
  return node;
}

const OF_TYPE = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number',
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => isMap(v),
  null: (v) => v === null,
};

/** The JSON types the schema gives name `name` on a block of `type`, or null when any type is allowed. */
export function typesOf(type, name) {
  return TYPES.get(`${type}.${name}`) ?? null;
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
