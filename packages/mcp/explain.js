import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CODES } from '@portable-doc/validate';

export function readCodes(markdown) {
  const rows = new Map();
  for (const line of markdown.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    const code = cells[1]?.match(/^`([a-z_]+)`$/)?.[1];
    if (code && CODES.includes(code)) rows.set(code, cells[2]);
  }
  const missing = CODES.filter((c) => !rows.has(c));
  if (missing.length) throw new Error(`CODES.md has no row for ${missing.join(', ')}`);
  return rows;
}

const codesFile = fileURLToPath(new URL('CODES.md', import.meta.resolve('@portable-doc/validate')));
export const REFUSED_WHEN = readCodes(fs.readFileSync(codesFile, 'utf8'));

const MAX_WHERE = 1_000;
const isMap = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const unescape = (key) => key.replaceAll('~1', '/').replaceAll('~0', '~');
const plain = (text) => text.replaceAll('`', '');
const clip = (text) => (text.length > 100 ? `${text.slice(0, 100)}…` : text);

function describe(block) {
  if (!isMap(block)) return '';
  const bits = [typeof block.type === 'string' ? clip(block.type) : null, typeof block.id === 'string' && block.id ? `id "${clip(block.id)}"` : null].filter(Boolean);
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
      words.push(index === null ? `"${clip(key)}"` : `${noun} ${index + 1}${describe(child)}`);
      node = child;
    } else {
      words.push(`field "${clip(key)}"`);
      node = isMap(node) && Object.hasOwn(node, key) ? node[key] : undefined;
    }
    parentKey = key;
  }
  return tail(words) || 'the blocks array';
}

function tail(words) {
  let kept = words.length;
  let size = 0;
  while (kept > 0 && size + words[kept - 1].length + 3 <= MAX_WHERE) size += words[--kept].length + 3;
  return [...(kept > 0 ? ['…'] : []), ...words.slice(kept)].join(' › ');
}

export function explain(errors, doc) {
  return errors.map(({ code, path, message }) => {
    const at = where(path, doc);
    const why = plain(REFUSED_WHEN.get(code));
    return { code, path, where: at, text: `${at}: ${message ? `${message}. ` : ''}Refused when ${why}.` };
  });
}
