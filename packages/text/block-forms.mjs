// SPDX-License-Identifier: Apache-2.0
// Test helper: the forms of every block type the schema names, for the round-trip matrix.
// Read from the schema and the goldens, never a hand list: a new type has forms the day
// it is added, and a writer that gets one value right cannot pass on that alone.

import { blockSchema, validate } from '@portable-doc/validate';
import { READ_ALIASES, goldenBlocks } from './golden-reads.mjs';

const BLOCKS = blockSchema.definitions.blocks;

/** Every block type the schema names, sorted. */
export const SCHEMA_TYPES = Object.freeze(Object.keys(BLOCKS).sort());

const isAlias = (type, key) => Object.hasOwn(READ_ALIASES, `${type}.${key}`);
const valid = (block) => validate({ blocks: [block] }).ok === true;

/** A property's schema branches, anyOf and oneOf spread. */
function branches(node) {
  const out = [];
  const stack = [node];
  while (stack.length) {
    const at = stack.pop();
    if (!at || typeof at !== 'object') continue;
    if (at.anyOf || at.oneOf) stack.push(...(at.anyOf ?? at.oneOf));
    else out.push(at);
  }
  return out;
}

/** Values to vary a property over: each boolean, each value of a small range or enum, else one sample. */
function variantsOf(node) {
  const out = [];
  for (const at of branches(node)) {
    if (at.enum) out.push(...at.enum);
    const types = Array.isArray(at.type) ? at.type : [at.type];
    if (types.includes('boolean')) out.push(true, false);
    if (types.includes('integer')) {
      const { minimum: lo, maximum: hi } = at;
      if (lo !== undefined && hi !== undefined && hi - lo <= 10) for (let v = lo; v <= hi; v++) out.push(v);
      else out.push(Math.max(lo ?? 3, 3));
    }
    if (types.includes('number')) out.push(7.5);
    if (types.includes('string') && !at.enum) out.push('Sample text');
  }
  return out;
}

/** Every string leaf, but a `type`, as whitespace. */
function blanked(value, key) {
  if (typeof value === 'string') return key === 'type' ? value : ' \t ';
  if (Array.isArray(value)) return value.map((v) => blanked(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, blanked(v, k)]));
  return value;
}

/** A block with each alias key under its canonical name; a string becomes one text run where the canonical key takes inline content. */
function canonical(block) {
  const out = {};
  for (const [key, value] of Object.entries(block)) {
    const to = READ_ALIASES[`${block.type}.${key}`]?.split('.')[1];
    if (!to || Object.hasOwn(block, to)) out[key] = value;
    else {
      const inline = typeof value === 'string' && !branches(BLOCKS[block.type].properties?.[to]).some((b) => b.type === 'string');
      out[to] = inline ? [{ type: 'text', value }] : value;
    }
  }
  return out;
}

/** The type's own golden block, or null when the pack has none. */
function goldenOf(type) {
  const goldens = goldenBlocks(new Set([type]));
  return (goldens.find((g) => g.file === `${type}.golden.json`) ?? goldens[0])?.block ?? null;
}

/**
 * Every valid form of a block type, as [name, block]:
 * - `filled`: its golden, with canonical key names, and `filled with an alias` as the golden
 *   has it, while the pack still writes an alias;
 * - `value <key>=<v>`: the golden with one declared key set to another value (each boolean,
 *   each heading level, a sample for the rest), and `id`: the golden with an id;
 * - `empty` and `empty <key>`: the type alone, and with each canonical array key empty;
 * - `whitespace`: the golden with every string as whitespace.
 * Only `filled with an alias` writes an alias. A form that does not validate is left out.
 */
export function formsOf(type) {
  const out = new Map();
  const add = (name, block) => {
    const key = JSON.stringify(block);
    if (valid(block) && ![...out.values()].some((b) => JSON.stringify(b) === key)) out.set(name, block);
  };
  const raw = goldenOf(type);
  const golden = raw && canonical(raw);
  const props = Object.entries(BLOCKS[type].properties ?? {}).filter(([key]) => key !== 'type' && key !== 'id' && !isAlias(type, key));
  if (golden) {
    add('filled', golden);
    add('filled with an alias', raw);
    for (const [key, node] of props) for (const v of variantsOf(node)) if (golden[key] !== v) add(`value ${key}=${JSON.stringify(v)}`, { ...golden, [key]: v });
    add('id', { ...golden, id: `${type}-1` });
    add('whitespace', blanked(golden));
  }
  add('empty', { type });
  for (const [key, node] of props) if (branches(node).some((b) => b.type === 'array')) add(`empty ${key}`, { type, [key]: [] });
  return [...out];
}

/** A block as a list item's child, and inside a quote: a callout's body, written as `> [!info]`. */
export const contexts = {
  'in a list item': (block) => ({ type: 'list', ordered: false, items: [{ content: [{ type: 'text', value: 'Item' }], children: [block] }] }),
  // A callout is what Markdown writes as a quote (`> [!tone]`); a blockquote holds inline content only.
  'in a callout (a Markdown quote)': (block) => ({ type: 'callout', tone: 'info', content: [{ type: 'text', value: 'Note' }], slots: { body: [block] } }),
};

/** Every form of every schema type, bare and in each context, as [name, block]; contexts only for the base forms. */
export function allForms() {
  const out = [];
  for (const type of SCHEMA_TYPES) {
    for (const [form, block] of formsOf(type)) {
      out.push([`${type} ${form}`, block]);
      if (form.startsWith('value ') || form === 'id') continue;
      for (const [where, wrap] of Object.entries(contexts)) {
        const wrapped = wrap(block);
        if (valid(wrapped)) out.push([`${type} ${form} ${where}`, wrapped]);
      }
    }
  }
  return out;
}
