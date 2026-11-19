// Writes packages/text/alias-types.js: for every name of every field in the alias table
// (packages/text/alias-table.js), the JSON types spec/blocks.schema.json gives it on its block
// type or item. A name the schema does not declare takes the types of its field's other names;
// a field none of whose names the schema types takes the types in UNTYPED. It also writes, for
// every field, whether whitespace is content there (the table's whitespace column). The readers
// import the small module instead of the schema, so React does not bundle the schema.
// `npm run alias-types` writes it; read-aliases.test.mjs regenerates it and compares.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import schema from '../spec/blocks.schema.json' with { type: 'json' };
import { TABLE } from '../packages/text/alias-table.js';

export const OUT = fileURLToPath(new URL('../packages/text/alias-types.js', import.meta.url));

// The schema the helpers below read: the spec's, or a planted copy (setSchema) in a test.
let SCHEMA = schema;
/** Reads `s` in place of spec/blocks.schema.json until called again; returns the one it replaced. */
export function setSchema(s) {
  const was = SCHEMA;
  SCHEMA = s;
  return was;
}

const at = (ref) => ref.split('/').slice(1).reduce((node, key) => node?.[key], SCHEMA);

// The JSON types a schema node allows, or null when it does not constrain the type.
function schemaTypes(node, seen = new Set()) {
  if (node === undefined || node === true) return null;
  if (node.$ref === '#') return ['object'];
  if (node.$ref) {
    if (seen.has(node.$ref)) return null;
    return schemaTypes(at(node.$ref), new Set([...seen, node.$ref]));
  }
  const options = node.anyOf ?? node.oneOf;
  if (options) {
    const all = options.map((option) => schemaTypes(option, seen));
    return all.includes(null) ? null : [...new Set(all.flat())];
  }
  if (node.type !== undefined) return Array.isArray(node.type) ? node.type : [node.type];
  const constants = node.const !== undefined ? [node.const] : node.enum;
  if (constants) return [...new Set(constants.map((v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)))];
  if (node.properties) return ['object'];
  if (node.items) return ['array'];
  return null;
}

const resolve = (node) => {
  while (node?.$ref && node.$ref !== '#') node = at(node.$ref);
  return node;
};
// Of a node that may be one of several (anyOf, oneOf), the object option with properties.
const objectOf = (node) => {
  node = resolve(node);
  const options = node?.anyOf ?? node?.oneOf;
  return options ? options.map(resolve).find((o) => o?.properties) : node;
};

/**
 * The properties the schema gives an owner: a block type ("code"), a block type and a path to
 * a list of items in it ("steps.steps[]", "task-detail.task.criteria[]"), or an inline node
 * ("inline:text"): those definitions.inline gives every inline node, and those of its option
 * whose `type` is that node's. An owner the schema gives no properties has none ({}).
 */
export function ownerProperties(owner) {
  if (owner.startsWith('inline:')) {
    const nodeType = owner.slice('inline:'.length);
    const inline = resolve(SCHEMA.definitions?.inline);
    const own = (inline?.anyOf ?? inline?.oneOf ?? []).map(resolve).find((o) => o?.properties?.type?.const === nodeType || o?.properties?.type?.enum?.includes(nodeType));
    const { type: _, ...shared } = inline?.properties ?? {};
    const { type: __, ...mine } = own?.properties ?? {};
    return { ...shared, ...mine };
  }
  const [type, ...path] = owner.split('.');
  let node = objectOf(SCHEMA.definitions?.blocks?.[type]);
  for (const step of path) {
    const list = step.endsWith('[]');
    node = objectOf(node?.properties?.[list ? step.slice(0, -2) : step]);
    if (list) node = objectOf(node?.items);
  }
  return node?.properties ?? {};
}

/**
 * The types of the names of each field the schema gives no types at all (an item or an inline
 * node it leaves open): what main's reader accepted, so no value main shows is lost. A name
 * enters this map only in the change that makes it an alias while the schema gives it no types;
 * its type is what main's reader accepted. It leaves when the schema types it; the map only
 * shrinks. "owner.name" → { types (null: any), why }.
 */
export const UNTYPED = Object.freeze({
  'code-tabs.tabs[].code': { types: ['string'], why: 'main showed str(value ?? code): only text shows' },
  'code-tabs.tabs[].value': { types: ['string'], why: 'main showed str(value ?? code): only text shows' },
  'inline:code.children': { types: ['string', 'array', 'object'], why: 'main showed the flat text of children: a string, a number or an array of inlines' },
  'inline:code.value': { types: ['string'], why: 'main read str(value) || the children: text, else the children' },
  'inline:text.text': { types: ['string'], why: 'main read str(value) || str(text): text' },
  'inline:text.value': { types: ['string'], why: 'main read str(value) || str(text): text' },
  'notes.items[].content': { types: ['array'], why: 'main read a note\'s non-empty content array, else its text' },
  'notes.items[].text': { types: ['string'], why: 'main read a note\'s non-empty content array, else str(text)' },
  'table.columns[].label': { types: ['string', 'array', 'object'], why: 'main showed a column\'s text ?? label as text or as the words of an array' },
  'table.columns[].text': { types: ['string', 'array', 'object'], why: 'main showed a column\'s text ?? label as text or as the words of an array' },
  'task-detail.criteria[].criterion': { types: ['string'], why: 'main read str(text) || str(criterion): text' },
  'task-detail.criteria[].text': { types: ['string'], why: 'main read str(text) || str(criterion): text' },
  'task-detail.task.criteria[].criterion': { types: ['string'], why: 'main read str(text) || str(criterion): text' },
  'task-detail.task.criteria[].text': { types: ['string'], why: 'main read str(text) || str(criterion): text' },
});

/** "owner.name" → the types that name may hold (null: any), for every name in the alias table. */
export function aliasTypes() {
  const fields = new Map(); // "owner.field" → [[field], [old], ...]
  for (const [from, { to }] of Object.entries(TABLE.aliases)) {
    if (!fields.has(to)) fields.set(to, [[to.slice(to.lastIndexOf('.') + 1)]]);
    fields.get(to).push([from.slice(from.lastIndexOf('.') + 1)]);
  }
  const out = {};
  for (const [to, names] of fields) {
    const type = to.slice(0, to.lastIndexOf('.'));
    const properties = ownerProperties(type);
    const declared = names.map(([name]) => (Object.hasOwn(properties, name) ? schemaTypes(properties[name]) : undefined));
    const known = declared.filter((types) => types !== undefined);
    if (known.length === 0) {
      for (const [name] of names) {
        const key = `${type}.${name}`;
        if (!Object.hasOwn(UNTYPED, key)) throw new Error(`${key}: the schema gives none of its field's names a type; add it to UNTYPED with what main's reader accepted`);
        out[key] = UNTYPED[key].types;
      }
      continue;
    }
    const fallback = known.includes(null) ? null : [...new Set(known.flat())];
    names.forEach(([name], i) => { out[`${type}.${name}`] = declared[i] === undefined ? fallback : declared[i]; });
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** The UNTYPED names the schema types: each must leave the map. Empty while the map is right. */
export function untypedButTyped() {
  return Object.keys(UNTYPED).filter((key) => Object.hasOwn(ownerProperties(key.slice(0, key.lastIndexOf('.'))), key.slice(key.lastIndexOf('.') + 1)));
}

/** "owner.field" → whether whitespace is content in that field (the table's whitespace column). */
export function aliasWhitespace() {
  const out = {};
  for (const [from, { to, whitespace }] of Object.entries(TABLE.aliases)) {
    if (whitespace !== 'content' && whitespace !== 'blank') throw new Error(`${from}: whitespace is 'content' or 'blank'`);
    if (Object.hasOwn(out, to) && out[to] !== (whitespace === 'content')) throw new Error(`${from}: the rows of ${to} disagree on whitespace`);
    out[to] = whitespace === 'content';
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** The text of packages/text/alias-types.js. */
export function aliasTypesSource() {
  const rows = Object.entries(aliasTypes()).map(([key, types]) => `  '${key}': ${types === null ? 'null' : JSON.stringify(types).replace(/"/g, "'")},`);
  const spaces = Object.entries(aliasWhitespace()).map(([key, content]) => `  '${key}': ${content},`);
  return `// SPDX-License-Identifier: Apache-2.0
// Generated by scripts/generate-alias-types.mjs from spec/blocks.schema.json and alias-table.js:
// do not edit. \`npm run alias-types\` writes it again.
// "owner.name" → the JSON types the schema gives that name (null: any type). A plain literal,
// with no work at load; read-aliases.js freezes it on first use.

export const ALIAS_TYPES = {
${rows.join('\n')}
};

// "owner.field" → whether whitespace is content in that field (the table's whitespace column):
// true, a string of only whitespace is a value; false, it is blank, like an empty string.
export const ALIAS_WHITESPACE = {
${spaces.join('\n')}
};
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  fs.writeFileSync(OUT, aliasTypesSource());
  console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${Object.keys(aliasTypes()).length} names`);
}
