import { get, isMap, same } from './terms.js';

export const blockId = (block) => get(block, 'id');

function visibleAlias(container) {
  const children = get(container, 'children');
  if (children !== null && children !== false) return Array.isArray(children) ? ['children', children] : null;
  const blocks = get(container, 'blocks');
  return Array.isArray(blocks) ? ['blocks', blocks] : null;
}

export function visibleContainer(block) {
  if (!isMap(block)) return null;
  switch (block.type) {
    case 'section':
      return Array.isArray(block.blocks) ? { kind: 'blocks', key: 'blocks', list: block.blocks } : null;
    case 'expandable': {
      const alias = visibleAlias(block);
      return alias && { kind: 'blocks', key: alias[0], list: alias[1] };
    }
    case 'steps':
      return Array.isArray(block.steps) ? { kind: 'steps', list: block.steps } : null;
    case 'tabs':
      return Array.isArray(block.tabs) ? { kind: 'tabs', list: block.tabs } : null;
    case 'columns':
      return Array.isArray(block.columns) ? { kind: 'columns', list: block.columns } : null;
    case 'figure':
      return isMap(block.child) ? { kind: 'figure', child: block.child } : null;
    case 'terminal':
      return Array.isArray(block.children) && !Object.hasOwn(block, 'blocks') ? { kind: 'blocks', key: 'children', list: block.children } : null;
  }
}

export function visibleChildLists(block) {
  const c = visibleContainer(block);
  if (!c) return [];
  switch (c.kind) {
    case 'blocks':
      return [c.list];
    case 'steps':
      return c.list.flatMap((row) => {
        const alias = isMap(row) ? visibleAlias(row) : null;
        return alias ? [alias[1]] : [];
      });
    case 'tabs':
      return c.list.flatMap((row) => (isMap(row) && Array.isArray(row.blocks) ? [row.blocks] : []));
    case 'columns':
      return c.list.filter(Array.isArray);
    case 'figure':
      return [[c.child]];
  }
}

export const idExists = (blocks, id) =>
  blocks.some((b) => same(blockId(b), id) || visibleChildLists(b).some((list) => idExists(list, id)));

export const lockedAtId = (blocks, id) =>
  blocks.some((b) => (same(blockId(b), id) && get(b, 'locked') === true) || visibleChildLists(b).some((list) => lockedAtId(list, id)));

export const directFigureChildId = (blocks, id) =>
  blocks.some((b) => {
    if (!isMap(b)) return false;
    if (b.type === 'figure' && isMap(b.child) && same(blockId(b.child), id)) return true;
    return visibleChildLists(b).some((list) => directFigureChildId(list, id));
  });

export function transform(blocks, id, fun) {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (same(blockId(block), id)) {
      const { list, flag } = fun(block);
      return { list: [...blocks.slice(0, i), ...list, ...blocks.slice(i + 1)], flag };
    }
    const next = transformChildren(block, id, fun);
    if (next) return { list: [...blocks.slice(0, i), next.block, ...blocks.slice(i + 1)], flag: next.flag };
  }
  return null;
}

function transformChildren(block, id, fun) {
  const c = visibleContainer(block);
  if (!c) return null;
  switch (c.kind) {
    case 'blocks': {
      const r = transform(c.list, id, fun);
      return r && { block: { ...block, [c.key]: r.list }, flag: r.flag };
    }
    case 'steps':
      return transformRows(block, 'steps', c.list, id, fun, (row) => (isMap(row) ? visibleAlias(row) : null));
    case 'tabs':
      return transformRows(block, 'tabs', c.list, id, fun, (row) => (isMap(row) && Array.isArray(row.blocks) ? ['blocks', row.blocks] : null));
    case 'columns':
      for (let i = 0; i < c.list.length; i++) {
        if (!Array.isArray(c.list[i])) continue;
        const r = transform(c.list[i], id, fun);
        if (r) return { block: { ...block, columns: c.list.with(i, r.list) }, flag: r.flag };
      }
      return null;
    case 'figure': {
      const r = transform([c.child], id, fun);
      if (!r) return null;
      return { block: { ...block, child: r.list[0] }, flag: r.flag };
    }
  }
}

function transformRows(block, key, rows, id, fun, body) {
  for (let i = 0; i < rows.length; i++) {
    const alias = body(rows[i]);
    if (!alias) continue;
    const r = transform(alias[1], id, fun);
    if (r) return { block: { ...block, [key]: rows.with(i, { ...rows[i], [alias[0]]: r.list }) }, flag: r.flag };
  }
  return null;
}

const pushId = (out, v) => {
  if (isMap(v) && typeof v.id === 'string' && v.id !== '') out.push(v.id);
};

function aliasIds(container, walk) {
  for (const key of ['children', 'blocks']) if (Array.isArray(get(container, key))) walk(container[key]);
}

function rowIds(out, rows, walk, body) {
  for (const row of rows) {
    if (!isMap(row)) continue;
    pushId(out, row);
    body(row);
  }
}

export function patchAuthoredIds(blocks) {
  const out = [];
  const walk = (list) => list.forEach(block);
  const tabBody = (row) => Array.isArray(row.blocks) && walk(row.blocks);
  function block(b) {
    if (!isMap(b)) return;
    pushId(out, b);
    switch (b.type) {
      case 'section':
        if (Array.isArray(b.blocks)) walk(b.blocks);
        break;
      case 'expandable':
      case 'terminal':
        aliasIds(b, walk);
        break;
      case 'columns':
        if (Array.isArray(b.columns)) b.columns.forEach((col) => Array.isArray(col) && walk(col));
        break;
      case 'figure':
        if (isMap(b.child)) block(b.child);
        break;
      case 'steps':
        if (Array.isArray(b.steps)) rowIds(out, b.steps, walk, (row) => aliasIds(row, walk));
        break;
      case 'tabs':
        if (Array.isArray(b.tabs)) rowIds(out, b.tabs, walk, tabBody);
        break;
    }
  }
  walk(blocks);
  return out;
}

export function treeAuthoredIds(blocks) {
  const out = [];
  const walk = (list) => list.forEach(block);
  const tabBody = (row) => Array.isArray(row.blocks) && walk(row.blocks);
  function block(b) {
    if (!isMap(b)) return;
    pushId(out, b);
    switch (b.type) {
      case 'steps':
        if (Array.isArray(b.steps)) return rowIds(out, b.steps, walk, (row) => aliasIds(row, walk));
        break;
      case 'tabs':
        return Array.isArray(b.tabs) && rowIds(out, b.tabs, walk, tabBody);
      case 'expandable':
      case 'terminal':
        return aliasIds(b, walk);
      case 'columns':
        return Array.isArray(b.columns) && b.columns.forEach((col) => Array.isArray(col) && walk(col));
      case 'figure':
        return isMap(b.child) && block(b.child);
    }
    if (Array.isArray(b.blocks)) walk(b.blocks);
  }
  walk(blocks);
  return out;
}

export function blocksWithId(blocks, id, out = []) {
  for (const b of blocks) {
    if (!isMap(b)) continue;
    if (same(get(b, 'id'), id)) out.push(b);
    for (const list of paperChildLists(b)) blocksWithId(list, id, out);
  }
  return out;
}

function bodyList(container) {
  const children = get(container, 'children');
  if (Array.isArray(children)) return [children];
  if ((children === null || children === false) && Array.isArray(get(container, 'blocks'))) return [container.blocks];
  return [];
}

function paperChildLists(b) {
  switch (b.type) {
    case 'section':
      return Array.isArray(b.blocks) ? [b.blocks] : [];
    case 'expandable':
      return bodyList(b);
    case 'steps':
      return Array.isArray(b.steps) ? b.steps.flatMap(bodyList) : [];
    case 'tabs':
      return Array.isArray(b.tabs) ? b.tabs.flatMap((row) => (isMap(row) && Array.isArray(row.blocks) ? [row.blocks] : [])) : [];
    case 'columns':
      return Array.isArray(b.columns) ? b.columns.filter(Array.isArray) : [];
    case 'figure':
      return isMap(b.child) ? [[b.child]] : [];
    default:
      return [];
  }
}
