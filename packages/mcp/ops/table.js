import { validTableInline } from './inline.js';
import { exactKeys, isMap, same } from './terms.js';

const ALIASES = ['content', 'header', 'headers', 'columns'];
const INDEXED = ['remove-row', 'up-row', 'down-row', 'remove-column', 'left-column', 'right-column'];
const PLAIN = ['add-row', 'add-column', 'add-header', 'remove-header'];
const safeIndex = (i) => Number.isInteger(i) && i >= 0 && i <= Number.MAX_SAFE_INTEGER;

const cellKind = (cell) => {
  if (Array.isArray(cell)) return validTableInline(cell) ? 'inline-array' : null;
  if (!isMap(cell) || Object.hasOwn(cell, 'header')) return null;
  if (cell.type === 'tableHeader' || cell.type === 'table_header') return null;
  if (Object.keys(cell).length === 1) return null;
  return validTableInline(cell.content) ? 'content-map' : null;
};

function projectCells(cells, kind) {
  if (!Array.isArray(cells) || cells.length === 0) return null;
  const kinds = cells.map(cellKind);
  if (kinds.includes(null)) return null;
  return { shape: { kind, cells: kinds }, cells: cells.map((c) => (Array.isArray(c) ? c : c.content)) };
}

function projectRow(row) {
  if (Array.isArray(row)) return projectCells(row, 'array');
  if (isMap(row) && Array.isArray(row.cells) && !Object.hasOwn(row, 'header') && Object.keys(row).length > 1) {
    return projectCells(row.cells, 'cells-map');
  }
  return null;
}

function projectHead(table, width) {
  if (!Object.hasOwn(table, 'head')) return { shape: { state: 'absent' }, cells: null };
  if (table.head === null) return { shape: { state: 'null' }, cells: null };
  if (Array.isArray(table.head) && table.head.length === 0) return { shape: { state: 'empty' }, cells: null };
  const row = Array.isArray(table.head) ? projectCells(table.head, 'array') : null;
  return row && row.cells.length === width ? { shape: { state: 'row', row: row.shape }, cells: row.cells } : null;
}

const nestsBlocks = (table) => Array.isArray(table.blocks) || Array.isArray(table.children);

export function project(table) {
  if (!isMap(table) || table.type !== 'table' || typeof table.id !== 'string' || table.id === '' || table.id.trim() !== table.id) return null;
  if (!Array.isArray(table.rows) || table.rows.length === 0 || ALIASES.some((k) => Object.hasOwn(table, k)) || nestsBlocks(table)) return null;
  const rows = table.rows.map(projectRow);
  if (rows.includes(null)) return null;
  const width = rows[0].cells.length;
  if (rows.some((r) => r.cells.length !== width)) return null;
  const head = projectHead(table, width);
  if (!head) return null;
  return { shape: { v: 1, head: head.shape, rows: rows.map((r) => r.shape) }, head: head.cells, rows: rows.map((r) => r.cells) };
}

export function stable(table) {
  if (ALIASES.some((k) => Object.hasOwn(table, k)) || nestsBlocks(table) || typeof table.id !== 'string' || table.id === '') return false;
  const head = !Object.hasOwn(table, 'head') || table.head === null ||
    (Array.isArray(table.head) && (table.head.length === 0 || projectCells(table.head, 'array') !== null));
  const rows = Array.isArray(table.rows) ? table.rows.every((r) => projectRow(r) !== null) : !Object.hasOwn(table, 'rows');
  return head && rows;
}

export function mergeCells(table, shape, changes) {
  const projection = project(table);
  if (!same(projection.shape, shape) || !Array.isArray(changes)) return null;
  let previous = null;
  let updated = table;
  for (const change of changes) {
    const key = validChange(change, projection);
    if (!key || (previous && compareKeys(key, previous) <= 0)) return null;
    previous = key;
    updated = putCell(updated, change);
  }
  return project(updated) ? updated : null;
}

const compareKeys = (a, b) => a.reduce((d, x, i) => d || x - b[i], 0);

function validChange(change, projection) {
  if (!isMap(change) || !exactKeys(change, ['area', 'row', 'column', 'content'])) return null;
  const { area, row, column, content } = change;
  if (area !== 'head' && area !== 'body') return null;
  if (!safeIndex(row) || !safeIndex(column) || !validTableInline(content)) return null;
  const cells = area === 'head' ? (row === 0 ? projection.head : null) : projection.rows[row];
  if (!Array.isArray(cells) || column >= cells.length) return null;
  return [area === 'head' ? 0 : 1, row, column];
}

const rowCells = (row) => (Array.isArray(row) ? row : row.cells);
const withCells = (row, cells) => (Array.isArray(row) ? cells : { ...row, cells });
const putContent = (cell, content) => (Array.isArray(cell) ? content : { ...cell, content });

function putCell(table, { area, row, column, content }) {
  const put = (r) => withCells(r, rowCells(r).with(column, putContent(rowCells(r)[column], content)));
  return area === 'head' ? { ...table, head: put(table.head) } : { ...table, rows: table.rows.with(row, put(table.rows[row])) };
}

export function parseAction(action) {
  if (PLAIN.includes(action)) return { kind: action, index: null };
  if (typeof action !== 'string') return null;
  const at = action.indexOf(':');
  if (at < 0) return null;
  const kind = action.slice(0, at);
  const encoded = action.slice(at + 1);
  if (!INDEXED.includes(kind) || encoded.length > 16 || !/^(0|[1-9][0-9]*)$/.test(encoded)) return null;
  const index = Number(encoded);
  return safeIndex(index) ? { kind, index } : null;
}

const swap = (list, a, b) => list.with(a, list[b]).with(b, list[a]);

export function applyAction(table, shape, action) {
  const projection = project(table);
  if (!same(projection.shape, shape)) return null;
  const parsed = parseAction(action);
  if (!parsed) return null;
  const updated = act(table, projection, parsed);
  return updated && project(updated) ? updated : null;
}

function act(table, { head, rows }, { kind, index }) {
  const height = rows.length;
  const width = rows[0].length;
  const everyRow = (fun) => {
    const next = { ...table, rows: table.rows.map((r) => withCells(r, fun(rowCells(r)))) };
    return Array.isArray(head) ? { ...next, head: withCells(table.head, fun(rowCells(table.head))) } : next;
  };
  switch (kind) {
    case 'add-row':
      return { ...table, rows: [...table.rows, Array.from({ length: width }, () => [])] };
    case 'remove-row':
      return height > 1 && index < height ? { ...table, rows: table.rows.toSpliced(index, 1) } : null;
    case 'up-row':
      return index > 0 && index < height ? { ...table, rows: swap(table.rows, index, index - 1) } : null;
    case 'down-row':
      return index + 1 < height ? { ...table, rows: swap(table.rows, index, index + 1) } : null;
    case 'add-column':
      return everyRow((cells) => [...cells, []]);
    case 'remove-column':
      return width > 1 && index < width ? everyRow((cells) => cells.toSpliced(index, 1)) : null;
    case 'left-column':
      return index > 0 && index < width ? everyRow((cells) => swap(cells, index, index - 1)) : null;
    case 'right-column':
      return index + 1 < width ? everyRow((cells) => swap(cells, index, index + 1)) : null;
    case 'add-header':
      return head === null ? { ...table, head: Array.from({ length: width }, () => []) } : null;
    case 'remove-header':
      return Array.isArray(head) ? { ...table, head: [] } : null;
  }
}
