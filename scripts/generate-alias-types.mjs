// Writes packages/text/alias-types.js: for every name of every field in the alias table
// (packages/text/alias-table.js), the JSON types spec/blocks.schema.json gives it on its block
// type or item. A name the schema does not declare takes the types of its field's other names;
// a field none of whose names the schema types reads text, or an array on a convert's inline side. The
// readers import the small module instead of the schema, so React does not bundle the schema.
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
function ownerProperties(owner) {
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

/** "owner.name" → the types that name may hold (null: any), for every name in the alias table. */
export function aliasTypes() {
  const fields = new Map(); // "owner.field" → [[field, undefined], [old, its convert], ...]
  for (const [from, { to, convert }] of Object.entries(TABLE.aliases)) {
    if (!fields.has(to)) fields.set(to, [[to.slice(to.lastIndexOf('.') + 1), undefined]]);
    fields.get(to).push([from.slice(from.lastIndexOf('.') + 1), convert]);
  }
  const out = {};
  for (const [to, names] of fields) {
    const type = to.slice(0, to.lastIndexOf('.'));
    const properties = ownerProperties(type);
    const declared = names.map(([name]) => (Object.hasOwn(properties, name) ? schemaTypes(properties[name]) : undefined));
    const known = declared.filter((types) => types !== undefined);
    if (known.length === 0) {
      // The schema types none of the field's names (an item or an inline node it leaves open):
      // each name reads text (a string or a finite number), but where a row converts, the
      // inline side reads an array: inline-from-string's current name, text-from-inline's old name.
      const converts = names.slice(1).map(([, convert]) => convert);
      names.forEach(([name, convert], i) => {
        const inline = i === 0 ? converts.includes('inline-from-string') : convert === 'text-from-inline';
        out[`${type}.${name}`] = inline ? ['array'] : ['string'];
      });
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
