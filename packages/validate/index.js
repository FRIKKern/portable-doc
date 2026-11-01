import blockSchema from '../../spec/blocks.schema.json' with { type: 'json' };

export const CODES = Object.freeze([
  'not_a_doc',
  'block_not_object',
  'portable_text_block',
  'missing_required_field',
  'unknown_block_type',
  'wrong_field_type',
  'value_not_allowed',
  'duplicate_block_id',
  'too_deep',
]);

export const MAX_DEPTH = 100;

const KEYWORDS = new Set([
  '$schema', '$comment', 'title', 'description', 'definitions',
  'type', 'const', 'enum', 'minimum', 'maximum', 'required', 'properties', 'items',
  'allOf', 'anyOf', 'not', 'if', 'then', '$ref',
]);

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPrimitive = (v) => v === null || typeof v !== 'object';

const TYPES = {
  object: isObject,
  array: Array.isArray,
  string: (v) => typeof v === 'string',
  boolean: (v) => typeof v === 'boolean',
  number: (v) => typeof v === 'number',
  integer: Number.isInteger,
  null: (v) => v === null,
};

const pointer = (path, key) => `${path}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;
const unescape = (key) => key.replaceAll('~1', '/').replaceAll('~0', '~');
const error = (code, path, message) => ({ code, path, message });
const show = (v) => (isObject(v) ? 'an object' : Array.isArray(v) ? 'an array' : typeof v === 'bigint' ? `${v}n` : JSON.stringify(v));

const isPortableText = (block) =>
  block._type === 'block' && ['children', 'markDefs', 'listItem'].some((key) => Object.hasOwn(block, key));

function resolver(root) {
  return (ref) => {
    const found = ref.startsWith('#')
      ? ref.slice(1).split('/').filter(Boolean).reduce((node, key) => (isObject(node) ? node[unescape(key)] : undefined), root)
      : undefined;
    if (!isObject(found)) throw new Error(`schema $ref ${ref} does not resolve`);
    return found;
  };
}

function audit(root, resolve) {
  const seen = new Set();
  const visit = (node, at) => {
    if (seen.has(node)) return;
    seen.add(node);
    if (!isObject(node)) throw new Error(`schema at ${at} is not an object`);
    for (const key of Object.keys(node)) {
      if (!key.startsWith('x-') && !KEYWORDS.has(key)) throw new Error(`unsupported schema keyword ${key} at ${at}`);
    }
    if ('enum' in node && !Array.isArray(node.enum)) throw new Error(`schema enum at ${at} is not an array`);
    for (const value of ['const' in node ? [node.const] : [], node.enum ?? []].flat()) {
      if (!isPrimitive(value)) throw new Error(`unsupported schema const or enum value ${JSON.stringify(value)} at ${at}`);
    }
    for (const type of [].concat(node.type ?? [])) {
      if (!Object.hasOwn(TYPES, type)) throw new Error(`unsupported schema type ${type} at ${at}`);
    }
    if ('$ref' in node) return visit(resolve(node.$ref), node.$ref);
    for (const [key, child] of Object.entries(node.properties ?? {})) visit(child, `${at}/properties/${key}`);
    for (const key of ['items', 'not', 'if', 'then']) if (key in node) visit(node[key], `${at}/${key}`);
    for (const key of ['allOf', 'anyOf']) (node[key] ?? []).forEach((child, i) => visit(child, `${at}/${key}/${i}`));
  };
  visit(root, '#');
}

export function compile(root) {
  const resolve = resolver(root);
  audit(root, resolve);
  const typeSchema = root.properties?.type;
  const deref = (node) => ('$ref' in node ? deref(resolve(node.$ref)) : node);

  const accepts = (node, value) => {
    const target = deref(node);
    if (target.type) return [].concat(target.type).some((t) => TYPES[t](value));
    const options = 'const' in target ? [target.const] : target.enum;
    return !options || options.some((option) => typeof option === typeof value);
  };

  const trial = (value, node, path, depth) => {
    const out = { errors: [], ids: [] };
    check(value, node, path, out, depth);
    return out;
  };

  const merge = (out, from) => {
    out.errors.push(...from.errors);
    out.ids.push(...from.ids);
  };

  function check(value, node, path, out, depth) {
    if (isObject(value) && isPortableText(value)) return out.errors.push(error('portable_text_block', path, 'a Sanity Portable Text block (_type "block"), not a PortableDoc block'));
    const target = deref(node);
    if (target === root) return checkBlock(value, path, out, depth);
    checkNode(value, target, path, out, depth);
  }

  function checkBlock(value, path, out, depth) {
    if (depth === MAX_DEPTH) return out.errors.push(error('too_deep', path, `blocks nest deeper than ${MAX_DEPTH}`));
    if (!isObject(value)) return out.errors.push(error('block_not_object', path, `a block must be an object, got ${show(value)}`));
    if (typeof value.id === 'string' && value.id !== '') out.ids.push({ id: value.id, path: pointer(path, 'id') });
    checkNode(value, root, path, out, depth + 1);
  }

  function checkNode(value, node, path, out, depth) {
    if (node.type && !accepts(node, value)) {
      return out.errors.push(error('wrong_field_type', path, `expected ${[].concat(node.type).join(' or ')}, got ${show(value)}`));
    }
    if ('const' in node && value !== node.const) out.errors.push(error('value_not_allowed', path, `expected ${show(node.const)}, got ${show(value)}`));
    if (node.enum && !node.enum.includes(value)) {
      out.errors.push(node === typeSchema
        ? error('unknown_block_type', path, `${show(value)} is not a PortableDoc block type`)
        : error('value_not_allowed', path, `${show(value)} is not one of ${node.enum.map(show).join(', ')}`));
    }
    if (typeof value === 'number' && 'minimum' in node && value < node.minimum) out.errors.push(error('value_not_allowed', path, `${value} is below ${node.minimum}`));
    if (typeof value === 'number' && 'maximum' in node && value > node.maximum) out.errors.push(error('value_not_allowed', path, `${value} is above ${node.maximum}`));
    if (isObject(value)) {
      for (const key of node.required ?? []) {
        if (!Object.hasOwn(value, key)) out.errors.push(error('missing_required_field', pointer(path, key), `${key} is required`));
      }
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        if (Object.hasOwn(value, key)) check(value[key], child, pointer(path, key), out, depth);
      }
    }
    if (Array.isArray(value) && node.items) value.forEach((item, i) => check(item, node.items, pointer(path, i), out, depth));
    for (const child of node.allOf ?? []) check(value, child, path, out, depth);
    if (node.if && node.then && trial(value, node.if, path, depth).errors.length === 0) check(value, node.then, path, out, depth);
    if (node.anyOf) checkAnyOf(value, node.anyOf, path, out, depth);
    if (node.not && trial(value, node.not, path, depth).errors.length === 0) out.errors.push(error('value_not_allowed', path, 'matches a shape the schema forbids here'));
  }

  function checkAnyOf(value, branches, path, out, depth) {
    const trials = branches.map((branch) => ({ branch, result: trial(value, branch, path, depth) }));
    const pass = trials.find((t) => t.result.errors.length === 0);
    if (pass) return merge(out, pass.result);
    const fit = trials.find((t) => accepts(t.branch, value));
    if (!fit) return out.errors.push(error('wrong_field_type', path, `no allowed shape takes ${show(value)}`));
    merge(out, fit.result);
  }

  return function validate(doc) {
    if (!Array.isArray(doc) && !isObject(doc)) return { ok: false, errors: [error('not_a_doc', '', 'a doc is an object with a blocks array, or a blocks array')] };
    if (isObject(doc) && !Array.isArray(doc.blocks)) return { ok: false, errors: [error('not_a_doc', '/blocks', 'blocks must be an array')] };
    const base = Array.isArray(doc) ? '' : '/blocks';
    const out = { errors: [], ids: [] };
    (Array.isArray(doc) ? doc : doc.blocks).forEach((block, i) => check(block, root, pointer(base, i), out, 0));
    const first = new Map();
    for (const { id, path } of out.ids) {
      if (first.has(id)) out.errors.push(error('duplicate_block_id', path, `id ${show(id)} is already used at ${first.get(id)}`));
      else first.set(id, path);
    }
    return out.errors.length ? { ok: false, errors: out.errors } : { ok: true };
  };
}

export const validate = compile(blockSchema);
