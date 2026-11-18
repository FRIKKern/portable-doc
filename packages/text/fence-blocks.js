// SPDX-License-Identifier: Apache-2.0
// Every block in a value, wherever the schema puts blocks: the places where a
// block's schema says `$ref: "#"` (a list item's children, a callout's
// slots.body, a section's blocks, …). Read from the schema, so a new slot is
// covered without a change here. Both walks are iterative.

import { blockSchema } from '@portable-doc/validate';
import { isMap } from './util.js';

const ANY = Symbol('any key');
const EACH = Symbol('each item');

function resolve(ref) {
  return ref.slice(1).split('/').filter(Boolean).reduce((node, key) => (isMap(node) ? node[key.replaceAll('~1', '/').replaceAll('~0', '~')] : undefined), blockSchema);
}

/** The paths from a block to the blocks nested in it, as steps: a key, EACH array item or ANY object value. */
function pathsIn(definition) {
  const paths = new Map();
  const stack = [[definition, [], new Set()]];
  while (stack.length) {
    const [node, steps, refs] = stack.pop();
    if (!isMap(node)) continue;
    if (node.$ref === '#') {
      paths.set(steps.map((s) => (typeof s === 'string' ? JSON.stringify(s) : s.description)).join('/'), steps);
      continue;
    }
    if (typeof node.$ref === 'string') {
      if (!refs.has(node.$ref)) stack.push([resolve(node.$ref), steps, new Set([...refs, node.$ref])]);
      continue;
    }
    for (const key of ['anyOf', 'oneOf', 'allOf']) for (const sub of Array.isArray(node[key]) ? node[key] : []) stack.push([sub, steps, refs]);
    for (const key of ['then', 'else']) if (isMap(node[key])) stack.push([node[key], steps, refs]);
    if (isMap(node.properties)) for (const [k, sub] of Object.entries(node.properties)) stack.push([sub, [...steps, k], refs]);
    if (isMap(node.additionalProperties)) stack.push([node.additionalProperties, [...steps, ANY], refs]);
    if (isMap(node.patternProperties)) for (const sub of Object.values(node.patternProperties)) stack.push([sub, [...steps, ANY], refs]);
    const items = Array.isArray(node.items) ? node.items : isMap(node.items) ? [node.items] : [];
    for (const sub of items) stack.push([sub, [...steps, EACH], refs]);
  }
  return [...paths.values()];
}

let byType = null;

/** Block type (aliases included) → the paths to its nested blocks, from the schema's `if type … then $ref` list. */
function nestedPaths() {
  if (byType) return byType;
  byType = new Map();
  for (const rule of Array.isArray(blockSchema.allOf) ? blockSchema.allOf : []) {
    const type = rule?.if?.properties?.type?.const;
    const ref = rule?.then?.$ref;
    if (typeof type === 'string' && typeof ref === 'string') byType.set(type, pathsIn(resolve(ref)));
  }
  return byType;
}

/** The values a path reaches from one block. */
function follow(block, steps) {
  let at = [block];
  for (const step of steps) {
    const next = [];
    for (const v of at) {
      if (step === EACH) {
        if (Array.isArray(v)) for (const x of v) next.push(x);
      } else if (step === ANY) {
        if (isMap(v)) for (const x of Object.values(v)) next.push(x);
      } else if (isMap(v) && Object.hasOwn(v, step)) next.push(v[step]);
    }
    at = next;
  }
  return at;
}

/** True when every block in `blocks`, top level and nested, is an object whose type `allowed` has. */
export function everyBlockAllowed(blocks, allowed) {
  const paths = nestedPaths();
  const stack = Array.from(blocks);
  while (stack.length) {
    const block = stack.pop();
    if (!isMap(block) || !allowed.has(block.type)) return false;
    for (const steps of paths.get(block.type) ?? []) for (const nested of follow(block, steps)) stack.push(nested);
  }
  return true;
}
