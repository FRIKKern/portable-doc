// Writes packages/text/alias-types.js: for every name of every field in the alias table
// (packages/text/alias-table.js), the JSON types spec/blocks.schema.json gives it on its block
// type or item. A name the schema does not declare takes the types of its field's other names;
// a field none of whose names the schema types takes the types in UNTYPED. The readers import the small module instead of the schema, so React does not bundle the schema.
// `npm run alias-types` writes it; read-aliases.test.mjs regenerates it and compares.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import schema from '../spec/blocks.schema.json' with { type: 'json' };
import { TABLE } from '../packages/text/alias-table.js';

export const OUT = fileURLToPath(new URL('../packages/text/alias-types.js', import.meta.url));

const at = (ref) => ref.split('/').slice(1).reduce((node, key) => node?.[key], schema);

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
 * ("inline:text"). An owner the schema gives no properties has none ({}).
 */
export function ownerProperties(owner) {
  if (owner.startsWith('inline:')) return {};
  const [type, ...path] = owner.split('.');
  let node = objectOf(schema.definitions?.blocks?.[type]);
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
  'code-tabs.tabs[].code': { types: null, why: 'main read a tab\'s value ?? code: any value a tab held' },
  'code-tabs.tabs[].value': { types: null, why: 'main read a tab\'s value ?? code: any value a tab held' },
  'inline:code.children': { types: null, why: 'main read an inline code node\'s children as flat text, whatever they held' },
  'inline:code.value': { types: ['string'], why: 'main read str(value) || the children: text, else the children' },
  'inline:text.text': { types: ['string'], why: 'main read str(value) || str(text): text' },
  'inline:text.value': { types: ['string'], why: 'main read str(value) || str(text): text' },
  'notes.items[].content': { types: ['array'], why: 'main read a note\'s non-empty content array, else its text' },
  'notes.items[].text': { types: ['string'], why: 'main read a note\'s non-empty content array, else str(text)' },
  'table.columns[].label': { types: null, why: 'main read a column\'s text ?? label: any value, an inline array as its words' },
  'table.columns[].text': { types: null, why: 'main read a column\'s text ?? label: any value, an inline array as its words' },
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

/** The text of packages/text/alias-types.js. */
export function aliasTypesSource() {
  const rows = Object.entries(aliasTypes()).map(([key, types]) => `  '${key}': ${types === null ? 'null' : JSON.stringify(types).replace(/"/g, "'")},`);
  return `// SPDX-License-Identifier: Apache-2.0
// Generated by scripts/generate-alias-types.mjs from spec/blocks.schema.json and alias-table.js:
// do not edit. \`npm run alias-types\` writes it again.
// "owner.name" → the JSON types the schema gives that name (null: any type). A plain literal,
// with no work at load; read-aliases.js freezes it on first use.

export const ALIAS_TYPES = {
${rows.join('\n')}
};
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  fs.writeFileSync(OUT, aliasTypesSource());
  console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${Object.keys(aliasTypes()).length} names`);
}
