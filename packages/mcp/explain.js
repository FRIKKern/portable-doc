import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CODES } from '@portable-doc/validate';

export function readCodes(markdown) {
  const rows = new Map();
  for (const line of markdown.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    const code = cells[1]?.match(/^`([a-z_]+)`$/)?.[1];
    if (code && CODES.includes(code) && !rows.has(code)) rows.set(code, cells[2]);
  }
  const missing = CODES.filter((c) => !rows.has(c));
  if (missing.length) throw new Error(`CODES.md has no row for ${missing.join(', ')}`);
  return rows;
}

const codesFile = fileURLToPath(new URL('CODES.md', import.meta.resolve('@portable-doc/validate')));
export const REFUSED_WHEN = readCodes(fs.readFileSync(codesFile, 'utf8'));

const isMap = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const unescape = (key) => key.replaceAll('~1', '/').replaceAll('~0', '~');
const plain = (text) => text.replaceAll('`', '');

function describe(block) {
  if (!isMap(block)) return '';
  const bits = [typeof block.type === 'string' ? block.type : null, typeof block.id === 'string' && block.id ? `id "${block.id}"` : null].filter(Boolean);
  return bits.length ? ` (${bits.join(', ')})` : '';
}

export function where(path, doc) {
  if (path === '') return 'the doc';
  const keys = path.split('/').slice(1).map(unescape);
  const words = [];
  let node = doc;
  let parentKey = Array.isArray(doc) ? 'blocks' : null;
  for (const [i, key] of keys.entries()) {
    if (i === 0 && key === 'blocks' && !Array.isArray(doc)) {
      node = doc?.blocks;
      parentKey = key;
      continue;
    }
    const index = /^(0|[1-9]\d*)$/.test(key) ? Number(key) : null;
    if (Array.isArray(node) || (node === undefined && index !== null)) {
      const child = Array.isArray(node) ? node[index ?? -1] : undefined;
      const noun = ['blocks', 'children'].includes(parentKey) ? 'block' : 'item';
      words.push(index === null ? `"${key}"` : `${noun} ${index + 1}${describe(child)}`);
      node = child;
    } else {
      words.push(`field "${key}"`);
      node = isMap(node) && Object.hasOwn(node, key) ? node[key] : undefined;
    }
    parentKey = key;
  }
  return words.join(' › ') || 'the blocks array';
}

export function explain(errors, doc) {
  return errors.map(({ code, path, message }) => {
    const at = where(path, doc);
    const why = plain(REFUSED_WHEN.get(code));
    return { code, path, where: at, text: `${at}: ${message ? `${message}. ` : ''}Refused when ${why}.` };
  });
}
