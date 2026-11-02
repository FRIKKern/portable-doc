import { get, isMap, isString, same } from './terms.js';

const isList = Array.isArray;
const size = (map) => Object.keys(map).length;
const truthy = (v) => v !== null && v !== false;
const orElse = (a, b) => (truthy(a) ? a : b);
const blank = (v) => v === null || (isList(v) && v.length === 0);
const leaf = (value) => ({ type: 'text', value });
const scalar = (v) => v === null || isString(v) || typeof v === 'number' || typeof v === 'boolean';

export const RAISED = Symbol('raised');

export function toText(v) {
  if (v === null) return '';
  if (isString(v)) return v;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return numberText(v);
  if (isList(v)) return v.map(chardata).join('');
  throw RAISED;
}

function chardata(v) {
  if (isString(v)) return v;
  if (Number.isInteger(v) && v >= 0 && v <= 0x10ffff && (v < 0xd800 || v > 0xdfff)) return String.fromCodePoint(v);
  if (isList(v)) return v.map(chardata).join('');
  throw RAISED;
}

function numberText(n) {
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
  const [mantissa, exponent] = n.toExponential().split('e');
  const e = Number(exponent);
  const sign = n < 0 ? '-' : '';
  const digits = mantissa.replace('-', '').replace('.', '');
  const scientific = `${sign}${digits[0]}.${digits.slice(1) || '0'}e${e}`;
  if (Number.isInteger(n)) return scientific;
  const decimal = e < 0 ? `${sign}0.${'0'.repeat(-e - 1)}${digits}` : `${sign}${digits.slice(0, e + 1)}.${digits.slice(e + 1)}`;
  return decimal.length <= scientific.length ? decimal : scientific;
}

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

export const normalizationSafe = (blocks) => sameTables(blocks, normalizeRenderShapes(ensureIds(blocks)));

const isTable = (v) => isMap(v) && v.type === 'table';

function sameTables(a, b) {
  if (a === b) return true;
  if (isTable(a) || isTable(b)) return isTable(a) && isTable(b) && same(a, b);
  if (isList(a) && isList(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (!sameTables(a[i], b[i])) return false;
    return true;
  }
  if (isMap(a) && isMap(b)) {
    return Object.keys(a).every((k) => sameTables(a[k], Object.hasOwn(b, k) ? b[k] : undefined)) &&
      Object.keys(b).every((k) => Object.hasOwn(a, k) || !hasTable(b[k]));
  }
  return !hasTable(a) && !hasTable(b);
}

function hasTable(v) {
  if (isList(v)) return v.some(hasTable);
  return isMap(v) && (v.type === 'table' || Object.values(v).some(hasTable));
}

export const ensureIds = (blocks) => mapList(blocks, ensureBlock);

const MINTED = Symbol('minted');

function ensureIdentity(value) {
  const id = get(value, 'id');
  return isString(id) && id !== '' ? value : { ...value, id: MINTED };
}

function ensureBlock(block) {
  if (!isMap(block)) return block;
  const b = ensureIdentity(block);
  const { type } = b;
  if (type === 'steps' && isList(b.steps)) return put(b, 'steps', mapList(b.steps, (row) => (isMap(row) ? ensureVisibleBody(ensureIdentity(row)) : row)));
  if (type === 'tabs') return isList(get(b, 'tabs')) ? put(b, 'tabs', mapList(b.tabs, ensureTab)) : b;
  if (type === 'expandable') return ensureVisibleBody(b);
  if (type === 'columns') return isList(b.columns) ? put(b, 'columns', mapList(b.columns, (column) => (isList(column) ? ensureIds(column) : column))) : b;
  if (type === 'figure') return isMap(b.child) ? put(b, 'child', ensureBlock(b.child)) : b;
  if (type === 'terminal') return isList(b.children) && !Object.hasOwn(b, 'blocks') ? put(b, 'children', ensureIds(b.children)) : b;
  return isList(b.blocks) ? put(b, 'blocks', ensureIds(b.blocks)) : b;
}

function ensureTab(row) {
  if (!isMap(row)) return row;
  const r = ensureIdentity(row);
  return isList(get(r, 'blocks')) ? put(r, 'blocks', ensureIds(r.blocks)) : r;
}

function ensureVisibleBody(container) {
  const key = visibleBodyKey(container);
  return key ? put(container, key, ensureIds(container[key])) : container;
}

export const normalizeRenderShapes = (blocks) => (isList(blocks) ? level(blocks, false, 0) : blocks);

const level = (blocks, listed, passes) => mapList(listed ? blocks : normalizeListItems(blocks), (b) => renderBlock(b, passes + 1));

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
  return typeof item === 'number' ? [leaf(toText(item))] : item;
}

const LEGACY_LISTS = ['bulletList', 'bullet_list', 'bullet-list', 'bulletedList', 'bulleted_list', 'bulleted-list', 'orderedList', 'ordered_list', 'ordered-list'];
const ORDERED_LISTS = ['orderedList', 'ordered_list', 'ordered-list'];

function renderBlock(b, passes) {
  if (!isMap(b)) return b;
  const shaped = renderShape(b);
  if (shaped) return leaves(shaped, passes);
  const nested = (list) => level(list, false, 0);
  if (b.type === 'steps' && isList(b.steps)) return leaves(put(b, 'steps', mapList(b.steps, (row) => visibleBody(row, nested))), passes);
  if (b.type === 'tabs' && isList(b.tabs)) {
    return leaves(put(b, 'tabs', mapList(b.tabs, (row) => (isMap(row) && isList(get(row, 'blocks')) ? put(row, 'blocks', nested(row.blocks)) : row))), passes);
  }
  if (b.type === 'columns' && isList(b.columns)) return leaves(put(b, 'columns', mapList(b.columns, (c) => (isList(c) ? nested(c) : c))), passes);
  return localLeaves(['blocks', 'children'].reduce((acc, key) => (isList(get(acc, key)) ? put(acc, key, level(acc[key], key === 'blocks', passes)) : acc), b), passes);
}

function renderShape(b) {
  const { type } = b;
  if (LEGACY_LISTS.includes(type)) return legacyList(b, ORDERED_LISTS.includes(type));
  if (type === 'list' && isList(b.content)) return legacyList(b, get(b, 'ordered') === true);
  if (type === 'list' && isList(b.items)) return put(b, 'items', mapList(b.items, wrappedListItem));
  if (type === 'table' && (isList(b.content) || isMap(b.content))) return legacyTable(b);
  if (type === 'table') return tableShape(headersKey(b));
  if (type === 'callout' && isString(b.text)) return callout(b);
  if ((type === 'notes' || type === 'cards') && isList(b.items)) return put(b, 'items', mapList(b.items, widgetItem));
  if (type === 'pipeline' && isList(b.nodes)) return put(b, 'nodes', mapList(b.nodes, pipelineNode));
  return null;
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
  return plain === '' ? inline : { [key]: plain, inline: inlineNodes(inline, 1) };
}

function plainText(node) {
  if (isList(node)) return node.map(plainText).join('');
  if (isString(node)) return node;
  if (typeof node === 'number') return toText(node);
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
  const style = toText(orElse(get(b, 'style'), orElse(get(b, 'listStyle'), ''))).toLowerCase();
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
  if (typeof v === 'number' || typeof v === 'boolean') return [leaf(toText(v))];
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
  const explicit = head === null ? null : isList(head) ? legacyValues(head, legacyInline) ?? false : false;
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
    rows: rows.map((row) => keys.map((k) => [leaf(toText(get(row, k)))])),
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
    else if (columns.every(scalar)) b = { ...omit(b, ['columns']), head: columns.map((v) => [leaf(toText(v))]) };
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

function leaves(b, passes) {
  if (!isMap(b)) return b;
  return ['blocks', 'children'].reduce((acc, key) => (isList(get(acc, key)) ? put(acc, key, mapList(acc[key], (c) => leaves(c, passes))) : acc), localLeaves(b, passes));
}

function localLeaves(b, passes) {
  let out = isList(get(b, 'content')) ? put(b, 'content', inlineNodes(b.content, passes)) : b;
  if (out.type === 'list' && isList(out.items)) out = put(out, 'items', mapList(out.items, (item) => (isList(item) ? itemNodes(item, passes) : item)));
  if (out.type !== 'table') return out;
  if (isList(get(out, 'rows'))) out = put(out, 'rows', mapList(out.rows, (row) => rowLeaves(row, passes)));
  for (const key of ['head', 'header']) if (isList(get(out, key))) out = put(out, key, cellsLeaves(out[key], passes));
  return out;
}

const wrapped = (n) => isMap(n) && isList(get(n, 'content')) && n.content.length > 0;

function itemNodes(nodes, passes) {
  const out = [];
  for (const n of nodes) lift(n, passes, 0, out);
  return out;
}

function lift(n, passes, applied, out) {
  if (passes === 0 || !wrapped(n)) out.push(inlineNode(n, applied + passes));
  else for (const c of n.content) lift(c, passes - 1, reached(n, applied) + 1, out);
}

const isTextLeaf = (n) => n.type === 'text' && isString(get(n, 'text'));

function reached(n, applied) {
  if (!isTextLeaf(n)) return applied;
  return isString(get(n, 'value')) ? 0 : Math.max(applied - 1, 0);
}

function rowLeaves(row, passes) {
  if (isList(row)) return cellsLeaves(row, passes);
  return isMap(row) && isList(get(row, 'cells')) ? put(row, 'cells', cellsLeaves(row.cells, passes)) : row;
}

const cellsLeaves = (cells, passes) =>
  mapList(cells, (c) => (isList(c) ? inlineNodes(c, passes) : isMap(c) && isList(get(c, 'content')) ? put(c, 'content', inlineNodes(c.content, passes)) : c));

const inlineNodes = (nodes, passes) => mapList(nodes, (n) => inlineNode(n, passes));

function inlineNode(n, passes) {
  if (passes === 0 || !isMap(n)) return n;
  if (!isTextLeaf(n)) return inlineChildren(n, passes);
  return isString(get(n, 'value')) ? n : inlineChildren({ ...omit(n, ['text']), value: n.text }, passes - 1);
}

const inlineChildren = (n, passes) => ['children', 'content'].reduce((acc, key) => (isList(get(acc, key)) ? put(acc, key, inlineNodes(acc[key], passes)) : acc), n);
