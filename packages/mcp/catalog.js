import fs from 'node:fs';

// The `blocks` tool reads the synced spec and goldens from the repo root at startup. The
// package is private and runs from a checkout, the same way @portable-doc/validate imports
// the spec; nothing here copies or edits them.
export const REPO_ROOT = new URL('../../', import.meta.url);
const SPEC = 'spec/blocks.schema.json';
const GOLDENS = 'goldens/blocks/';
const MAX_NEST = 2;

const refName = (ref) => (ref === '#' ? 'block' : ref.split('/').pop());
const wrap = (t) => (t.includes(' | ') ? `(${t})` : t);

function typeOf(node, nest = 0) {
  if (node.$ref) return refName(node.$ref);
  if (Object.hasOwn(node, 'const')) return JSON.stringify(node.const);
  if (node.anyOf) return [...new Set(node.anyOf.map((n) => typeOf(n, nest)))].join(' | ');
  if (node.enum && !node.type) return [...new Set(node.enum.map((v) => (v === null ? 'null' : typeof v)))].join(' | ');
  const types = [].concat(node.type ?? 'any').map((t) => {
    if (t === 'array') return `${wrap(node.items ? typeOf(node.items, nest + 1) : 'any')}[]`;
    if (t !== 'object' || !node.properties || nest >= MAX_NEST) return t;
    return `{ ${Object.entries(node.properties).map(([k, v]) => `${k}: ${typeOf(v, nest + 1)}`).join(', ')} }`;
  });
  return types.join(' | ');
}

function limits(node) {
  const out = {};
  for (const branch of [node, ...(node.anyOf ?? [])]) {
    if (branch.enum) out.enum = [...(out.enum ?? []), ...branch.enum];
    for (const key of ['minimum', 'maximum']) if (Object.hasOwn(branch, key)) out[key] = branch[key];
  }
  return out;
}

const fieldsOf = (def) => {
  const required = new Set(def.required ?? []);
  return Object.entries(def.properties ?? {})
    .filter(([name]) => name !== 'type')
    .map(([name, node]) => ({ name, type: typeOf(node), required: required.has(name), ...limits(node), ...(node.description ? { description: node.description } : {}) }));
};

const COMMON = new Set(['id', 'locked', 'role']);

function describe(def) {
  const own = Object.keys(def.properties ?? {}).filter((k) => k !== 'type' && !COMMON.has(k));
  return `${def['x-tier'] ?? 'block'}: ${own.length ? own.join(', ') : 'no fields of its own'}`;
}

export function loadCatalog(root = REPO_ROOT) {
  const where = (file) => new URL(file, root);
  let defs;
  try {
    defs = JSON.parse(fs.readFileSync(where(SPEC), 'utf8')).definitions;
  } catch (e) {
    return { error: `blocks needs ${SPEC} from a portable-doc checkout, and it could not be read: ${e.code ?? e.message}` };
  }
  if (!defs?.blocks || !defs?.aliases) return { error: `${SPEC} has no definitions.blocks or definitions.aliases` };
  let examples;
  try {
    examples = new Map(fs.readdirSync(where(GOLDENS)).filter((f) => f.endsWith('.golden.json'))
      .map((f) => [f.slice(0, -'.golden.json'.length), JSON.parse(fs.readFileSync(where(GOLDENS + f), 'utf8')).input]));
  } catch (e) {
    return { error: `blocks needs ${GOLDENS} from a portable-doc checkout, and it could not be read: ${e.code ?? e.message}` };
  }
  return { blocks: defs.blocks, aliases: defs.aliases, examples };
}

export function listBlocks(catalog) {
  return {
    blocks: Object.keys(catalog.blocks).sort().map((type) => ({ type, description: describe(catalog.blocks[type]) })),
    aliases: Object.keys(catalog.aliases).sort().map((type) => {
      const a = catalog.aliases[type];
      return { type, aliasOf: a['x-alias-of'], sets: a['x-set'] ?? {} };
    }),
  };
}

export const hasType = (catalog, type) => Object.hasOwn(catalog.blocks, type) || Object.hasOwn(catalog.aliases, type);

export function blockDetail(catalog, type) {
  const alias = Object.hasOwn(catalog.aliases, type) ? catalog.aliases[type] : null;
  const name = alias ? alias['x-alias-of'] : type;
  const def = alias ?? catalog.blocks[name];
  return {
    type,
    ...(alias ? { aliasOf: name, sets: alias['x-set'] ?? {} } : {}),
    tier: def['x-tier'] ?? null,
    fields: fieldsOf(def),
    example: catalog.examples.get(name) ?? null,
  };
}
