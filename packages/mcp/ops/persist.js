import { get, isMap, isString, same } from './terms.js';
import { treeAuthoredIds } from './tree.js';

const isList = Array.isArray;
const size = (map) => Object.keys(map).length;
const truthy = (v) => v !== null && v !== false;
const orElse = (a, b) => (truthy(a) ? a : b);
const blank = (v) => v === null || (isList(v) && v.length === 0);
const leaf = (value) => ({ type: 'text', value });
const scalar = (v) => v === null || isString(v) || typeof v === 'number' || typeof v === 'boolean';
const text = (v) => (v === null ? '' : String(v));

const put = (map, key, value) => (Object.hasOwn(map, key) && map[key] === value ? map : { ...map, [key]: value });

function omit(map, keys) {
  if (!keys.some((k) => Object.hasOwn(map, k))) return map;
  const out = { ...map };
  for (const k of keys) delete out[k];
  return out;
}

function mapList(list, fun) {
  let out = null;
  for (let i = 0; i < list.length; i++) {
    const value = fun(list[i], i);
    if (out) out.push(value);
    else if (value !== list[i]) out = [...list.slice(0, i), value];
  }
  return out ?? list;
}

function decode(string) {
  try {
    return { ok: true, value: JSON.parse(string) };
  } catch {
    return { ok: false };
  }
}

function visibleBodyKey(container) {
  const children = get(container, 'children');
  if (isList(children)) return 'children';
  if (children === null || children === false) return isList(get(container, 'blocks')) ? 'blocks' : null;
  return null;
}

export function normalizationSafe(blocks) {
  const before = tableSnapshot(blocks);
  const after = tableSnapshot(normalizeRenderShapes(ensureIds(blocks)));
  return before.size === after.size && [...before].every(([path, table]) => after.has(path) && same(after.get(path), table));
}

function tableSnapshot(value) {
  const out = new Map();
  const path = [];
  const walk = (v) => {
    if (isList(v)) {
      v.forEach((child, i) => {
        path.push(i);
        walk(child);
        path.pop();
      });
    } else if (isMap(v)) {
      if (v.type === 'table') out.set(JSON.stringify(path), v);
      for (const key of Object.keys(v)) {
        path.push(key);
        walk(v[key]);
        path.pop();
      }
    }
  };
  walk(value);
  return out;
}

export function ensureIds(blocks) {
  return ensureList(blocks, 'block', new Set(treeAuthoredIds(blocks)));
}

const ensureList = (blocks, prefix, taken) => mapList(blocks, (b, i) => ensureBlock(b, prefix, i, taken));

function uniqueId(prefix, index, taken) {
  const candidate = `${prefix}-${index}`;
  if (!taken.has(candidate)) return candidate;
  let k = 1;
  while (taken.has(`${candidate}-${k}`)) k++;
  return `${candidate}-${k}`;
}

function ensureIdentity(value, prefix, index, taken) {
  const id = get(value, 'id');
  if (isString(id) && id !== '') return value;
  const minted = uniqueId(prefix, index, taken);
  taken.add(minted);
  return { ...value, id: minted };
}

function ensureBlock(block, prefix, index, taken) {
  if (!isMap(block)) return block;
  const b = ensureIdentity(block, prefix, index, taken);
  const { id, type } = b;
  if (type === 'steps' && isList(b.steps)) return put(b, 'steps', ensureSteps(b.steps, `${id}-step`, taken));
  if (type === 'tabs') return isList(get(b, 'tabs')) ? put(b, 'tabs', ensureTabs(b.tabs, `${id}-tab`, taken)) : b;
  if (type === 'expandable') return ensureVisibleBody(b, id, taken);
  if (type === 'columns') return isList(b.columns) ? put(b, 'columns', ensureColumns(b.columns, id, taken)) : b;
  if (type === 'figure') return isMap(b.child) ? put(b, 'child', ensureBlock(b.child, `${id}-child`, 0, taken)) : b;
  if (type === 'terminal') return isList(b.children) && !Object.hasOwn(b, 'blocks') ? put(b, 'children', ensureList(b.children, id, taken)) : b;
  return isList(b.blocks) ? put(b, 'blocks', ensureList(b.blocks, id, taken)) : b;
}

const ensureSteps = (rows, prefix, taken) =>
  mapList(rows, (row, i) => {
    if (!isMap(row)) return row;
    const r = ensureIdentity(row, prefix, i, taken);
    return ensureVisibleBody(r, r.id, taken);
  });

const ensureTabs = (rows, prefix, taken) =>
  mapList(rows, (row, i) => {
    if (!isMap(row)) return row;
    const r = ensureIdentity(row, prefix, i, taken);
    return isList(get(r, 'blocks')) ? put(r, 'blocks', ensureList(r.blocks, r.id, taken)) : r;
  });

const ensureColumns = (columns, prefix, taken) =>
  mapList(columns, (column, i) => (isList(column) ? ensureList(column, `${prefix}-column-${i}`, taken) : column));

function ensureVisibleBody(container, prefix, taken) {
  const key = visibleBodyKey(container);
  return key ? put(container, key, ensureList(container[key], prefix, taken)) : container;
}

export function normalizeRenderShapes(blocks) {
  if (!isList(blocks)) return blocks;
  return mapList(mapList(normalizeListItems(blocks), renderBlock), leafDialect);
}

const normalizeListItems = (blocks) => (isList(blocks) ? mapList(blocks, blockListItems) : blocks);

function blockListItems(b) {
  if (!isMap(b)) return b;
  if (b.type === 'list' && isList(b.items)) return put(b, 'items', mapList(b.items, listItem));
  return isList(get(b, 'blocks')) ? put(b, 'blocks', normalizeListItems(b.blocks)) : b;
}

function listItem(item) {
  if (isList(item)) return item;
  if (isString(item)) {
    const d = decode(item);
    return d.ok && isList(d.value) && d.value.length > 0 && isMap(d.value[0]) ? d.value : [leaf(item)];
  }
  if (item === null) return [];
  return typeof item === 'number' ? [leaf(String(item))] : item;
}

const LEGACY_LISTS = ['bulletList', 'bullet_list', 'bullet-list', 'bulletedList', 'bulleted_list', 'bulleted-list', 'orderedList', 'ordered_list', 'ordered-list'];
const ORDERED_LISTS = ['orderedList', 'ordered_list', 'ordered-list'];

function renderBlock(b) {
  if (!isMap(b)) return b;
  const { type } = b;
  if (LEGACY_LISTS.includes(type)) return legacyList(b, ORDERED_LISTS.includes(type));
  if (type === 'list' && isList(b.content)) return legacyList(b, get(b, 'ordered') === true);
  if (type === 'list' && isList(b.items)) return put(b, 'items', mapList(b.items, wrappedListItem));
  if (type === 'table' && (isList(b.content) || isMap(b.content))) return legacyTable(b);
  if (type === 'table') return tableShape(headersKey(b));
  if (type === 'callout' && isString(b.text)) return callout(b);
  if ((type === 'notes' || type === 'cards') && isList(b.items)) return put(b, 'items', mapList(b.items, widgetItem));
  if (type === 'pipeline' && isList(b.nodes)) return put(b, 'nodes', mapList(b.nodes, pipelineNode));
  return childLists(b, normalizeRenderShapes);
}

function childLists(b, fun) {
  if (b.type === 'steps' && isList(b.steps)) return put(b, 'steps', mapList(b.steps, (row) => visibleBody(row, fun)));
  if (b.type === 'tabs' && isList(b.tabs)) {
    return put(b, 'tabs', mapList(b.tabs, (row) => (isMap(row) && isList(get(row, 'blocks')) ? put(row, 'blocks', fun(row.blocks)) : row)));
  }
  if (b.type === 'columns' && isList(b.columns)) return put(b, 'columns', mapList(b.columns, (c) => (isList(c) ? fun(c) : c)));
  return ['blocks', 'children'].reduce((acc, key) => (isList(get(acc, key)) ? put(acc, key, fun(acc[key])) : acc), b);
}

function visibleBody(container, fun) {
  if (!isMap(container)) return container;
  const key = visibleBodyKey(container);
  return key ? put(container, key, fun(container[key])) : container;
}

function wrappedListItem(item) {
  if (isMap(item) && size(item) === 1 && isList(item.content)) return item.content;
  if (isMap(item) && size(item) === 1 && isString(item.text)) return [leaf(item.text)];
  return item;
}

function callout(b) {
  const content = get(b, 'content');
  const slots = get(b, 'slots');
  if (b.text.trim() !== '' && blank(content) && (slots === null || (isMap(slots) && size(slots) === 0))) {
    return { ...omit(b, ['text']), content: [leaf(b.text)] };
  }
  return b;
}

const widgetItem = (item) => (isString(item) ? { text: item } : isList(item) ? rescueInline(item, 'text') : item);
const pipelineNode = (node) => (isString(node) ? { title: node } : isList(node) ? rescueInline(node, 'title') : node);

function rescueInline(inline, key) {
  const plain = plainText(inline);
  return plain === '' ? inline : { [key]: plain, inline: inlineNodes(inline) };
}

function plainText(node) {
  if (isList(node)) return node.map(plainText).join('');
  if (isString(node)) return node;
  if (typeof node === 'number') return String(node);
  if (!isMap(node)) return '';
  if (isString(get(node, 'value'))) return node.value;
  if (isString(get(node, 'text'))) return node.text;
  if (isList(get(node, 'children'))) return plainText(node.children);
  if (isList(get(node, 'content'))) return plainText(node.content);
  return '';
}

function legacyList(b, orderedDefault) {
  const source = ['items', 'content', 'children'].map((k) => get(b, k)).find(isList);
  if (!source) return b;
  const items = legacyValues(source, legacyListItem);
  if (!items) return b;
  const style = String(orElse(get(b, 'style'), orElse(get(b, 'listStyle'), ''))).toLowerCase();
  const ordered = orderedDefault || get(b, 'ordered') === true || ['ordered', 'number', 'numbered', 'decimal'].includes(style);
  return { ...omit(b, ['content', 'children', 'items', 'style', 'listStyle']), type: 'list', ordered, items };
}

function legacyValues(values, fun) {
  const out = [];
  for (const v of values) {
    const r = fun(v);
    if (!r) return null;
    out.push(r);
  }
  return out;
}

function legacyListItem(item) {
  if (isMap(item) && isString(get(item, 'id'))) {
    const plain = Object.keys(item).every((k) => ['id', 'content', 'text'].includes(k)) && (isList(get(item, 'content')) || isString(get(item, 'text')));
    return plain ? item : legacyInline(item);
  }
  return legacyInline(item);
}

const INLINE_WRAPPERS = ['paragraph', 'listItem', 'list_item', 'tableCell', 'table_cell', 'tableHeader', 'table_header'];

function legacyInline(v) {
  if (isString(v)) {
    const d = decode(v);
    return d.ok && (isList(d.value) || isMap(d.value)) ? legacyInline(d.value) : [leaf(v)];
  }
  if (v === null) return [];
  if (typeof v === 'number' || typeof v === 'boolean') return [leaf(String(v))];
  if (isList(v)) {
    const parts = legacyValues(v, legacyInline);
    return parts && parts.flat();
  }
  if (!isMap(v)) return null;
  if (v.type === 'text' && isString(get(v, 'value'))) return [omit(v, ['text'])];
  if (INLINE_WRAPPERS.includes(v.type) && isList(get(v, 'content'))) return legacyInline(v.content);
  if (size(v) === 1 && isList(v.content)) return legacyInline(v.content);
  if (size(v) === 1 && isString(v.text)) return [leaf(v.text)];
  return isString(v.type) && v.type !== '' ? [v] : null;
}

function legacyTable(b) {
  const { content } = b;
  const head = isMap(content) ? orElse(get(content, 'head'), get(content, 'header')) : null;
  const rows = isMap(content) ? get(content, 'rows') : content;
  if (!isList(rows)) return b;
  const parsed = legacyValues(rows, legacyRow);
  if (!parsed) return b;
  const explicit = head === null ? null : isList(head) ? legacyValues(head, legacyInline) : false;
  if (explicit === false) return b;
  const cells = parsed.map((r) => r.cells);
  const [resolvedHead, resolvedRows] = isList(explicit) ? [explicit, cells] : cells.length > 0 && parsed[0].header ? [cells[0], cells.slice(1)] : [null, cells];
  const normalized = { ...omit(b, ['content', 'head', 'header', 'rows']), type: 'table', rows: resolvedRows };
  return isList(resolvedHead) ? { ...normalized, head: resolvedHead } : normalized;
}

function legacyRow(row) {
  if (isList(row)) return legacyCells(row, false);
  if (!isMap(row)) return null;
  const cells = isList(get(row, 'content')) ? row.content : get(row, 'cells');
  if (!isList(cells)) return null;
  const headers = cells.map((c) => isMap(c) && (c.header === true || c.type === 'tableHeader' || c.type === 'table_header'));
  return legacyCells(cells, get(row, 'header') === true || (cells.length > 0 && headers.every(Boolean)));
}

function legacyCells(cells, header) {
  const normalized = legacyValues(cells, legacyInline);
  return normalized && { cells: normalized, header };
}

function headersKey(b) {
  const cells = get(b, 'headers');
  return isList(cells) && cells.length > 0 && blank(get(b, 'head')) ? { ...omit(b, ['headers']), head: cells } : b;
}

function tableShape(b) {
  const rows = get(b, 'rows');
  if (!isList(rows)) return b;
  return recordTable(b, rows) ?? arrayTable(b, rows);
}

function recordTable(b, rows) {
  const columns = get(b, 'columns');
  if (!isList(columns) || columns.length === 0) return null;
  const maps = columns.every(isMap);
  const keys = maps ? columns.map((c) => get(c, 'key')) : [];
  const valid = maps && keys.every((k) => isString(k) && k !== '') && new Set(keys).size === keys.length &&
    columns.every((c) => get(c, 'label') === null || isString(c.label)) &&
    rows.every((row) => isMap(row) && Object.keys(row).every((k) => keys.includes(k)) && Object.values(row).every(scalar));
  if (!valid) return null;
  return {
    ...omit(b, ['columns']),
    head: columns.map((c) => [leaf(orElse(get(c, 'label'), get(c, 'key')))]),
    rows: rows.map((row) => keys.map((k) => [leaf(text(get(row, k)))])),
  };
}

function headOrHeader(b) {
  const head = get(b, 'head');
  return blank(head) ? get(b, 'header') : head;
}

function arrayTable(table, rows) {
  let b = table;
  const head = get(b, 'head');
  if (isList(head) && head.length > 0 && get(b, 'header') === true) b = omit(b, ['header']);
  const columns = get(b, 'columns');
  if (blank(headOrHeader(b)) && isList(columns) && columns.length > 0) {
    if (columns.every((c) => isMap(c) && isString(get(c, 'text')) && size(c) === 1)) b = { ...omit(b, ['columns']), head: columns.map((c) => [leaf(c.text)]) };
    else if (columns.every(scalar)) b = { ...omit(b, ['columns']), head: columns.map((v) => [leaf(text(v))]) };
  }
  let body = rows;
  const declared = headOrHeader(b);
  const [first] = rows;
  if (declared === true && rows.length > 0) {
    const r = legacyRow(first);
    if (r) {
      b = { ...omit(b, ['header']), head: r.cells };
      body = rows.slice(1);
    }
  } else if (blank(declared) && rows.length > 0 && isMap(first) && get(first, 'header') === true && isList(get(first, 'cells')) && size(first) === 2) {
    b = put(b, 'head', first.cells.map(wrappedCell));
    body = rows.slice(1);
  } else if (blank(declared) && rows.length > 0 && isMap(first) && isList(get(first, 'cells'))) {
    if (first.cells.length > 0 && first.cells.every((c) => isMap(c) && get(c, 'header') === true)) {
      b = put(b, 'head', first.cells.map(headerCell));
      body = rows.slice(1);
    }
  }
  b = put(b, 'rows', mapList(body, wrappedRow));
  return isList(get(b, 'head')) ? put(b, 'head', mapList(b.head, wrappedCell)) : b;
}

function wrappedRow(row) {
  if (isList(row)) return mapList(row, wrappedCell);
  if (!isMap(row) || !isList(get(row, 'cells'))) return row;
  if (size(row) === 1) return row.cells.map(wrappedCell);
  if (size(row) === 2 && Object.hasOwn(row, 'header') && row.header !== true) return row.cells.map(wrappedCell);
  return put(row, 'cells', mapList(row.cells, wrappedCell));
}

function wrappedCell(cell) {
  if (isMap(cell) && size(cell) === 1 && isList(cell.content)) return flattenCell(cell.content);
  if (isMap(cell) && size(cell) === 1 && isString(cell.text)) return [leaf(cell.text)];
  return isString(cell) ? [leaf(cell)] : cell;
}

function headerCell(cell) {
  if (isMap(cell) && isList(get(cell, 'content'))) return flattenCell(cell.content);
  if (isMap(cell) && isString(get(cell, 'text'))) return [leaf(cell.text)];
  return cell;
}

const flattenCell = (content) => content.flatMap((item) => (isMap(item) && item.type === 'paragraph' && isList(get(item, 'content')) ? item.content : [item]));

function leafDialect(b) {
  if (!isMap(b)) return b;
  return nestedLeaves(tableLeaves(listItemLeaves(inlineUnder(b, 'content'))));
}

const inlineUnder = (b, key) => (isList(get(b, key)) ? put(b, key, inlineNodes(b[key])) : b);

function listItemLeaves(b) {
  if (b.type !== 'list' || !isList(b.items)) return b;
  return put(b, 'items', mapList(b.items, (item) => (isList(item) ? inlineNodes(unwrap(item)) : item)));
}

function unwrap(nodes) {
  const wrapped = (n) => isMap(n) && isList(get(n, 'content')) && n.content.length > 0;
  return nodes.some(wrapped) ? nodes.flatMap((n) => (wrapped(n) ? n.content : [n])) : nodes;
}

function tableLeaves(b) {
  if (b.type !== 'table') return b;
  let out = isList(get(b, 'rows')) ? put(b, 'rows', mapList(b.rows, rowLeaves)) : b;
  for (const key of ['head', 'header']) if (isList(get(out, key))) out = put(out, key, cellsLeaves(out[key]));
  return out;
}

function rowLeaves(row) {
  if (isList(row)) return cellsLeaves(row);
  return isMap(row) && isList(get(row, 'cells')) ? put(row, 'cells', cellsLeaves(row.cells)) : row;
}

const cellsLeaves = (cells) =>
  mapList(cells, (c) => (isList(c) ? inlineNodes(c) : isMap(c) && isList(get(c, 'content')) ? put(c, 'content', inlineNodes(c.content)) : c));

const nestedLeaves = (b) => ['blocks', 'children'].reduce((acc, key) => (isList(get(acc, key)) ? put(acc, key, mapList(acc[key], leafDialect)) : acc), b);

const inlineNodes = (nodes) => mapList(nodes, inlineNode);

function inlineNode(n) {
  if (!isMap(n)) return n;
  if (n.type === 'text' && isString(get(n, 'text'))) return isString(get(n, 'value')) ? n : { ...omit(n, ['text']), value: n.text };
  return ['children', 'content'].reduce((acc, key) => (isList(get(acc, key)) ? put(acc, key, inlineNodes(acc[key])) : acc), n);
}
