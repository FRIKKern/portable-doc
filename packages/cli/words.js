// SPDX-License-Identifier: Apache-2.0
// Plain words for validation errors, from @portable-doc/validate alone: its
// message for each error, and the "Refused when" column of its CODES.md.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CODES } from '@portable-doc/validate';

let refused = null;

/** Code → the sentence that finishes "Refused when …", read once from CODES.md. */
export function refusedWhen(code) {
  if (refused === null) {
    refused = new Map();
    const file = fileURLToPath(new URL('CODES.md', import.meta.resolve('@portable-doc/validate')));
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const cells = line.split('|').map((c) => c.trim());
      const code = /^`([a-z_]+)`$/.exec(cells[1] ?? '')?.[1];
      if (code && CODES.includes(code) && !refused.has(code)) refused.set(code, cells[2].replaceAll('`', ''));
    }
  }
  return refused.get(code) ?? '';
}

const isMap = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const clip = (s) => (s.length > 60 ? `${s.slice(0, 60)}…` : s);

/** The innermost typed block on a JSON pointer, in words (`the heading block
 * at /blocks/2`), or '' when there is none. */
export function blockAt(path, doc) {
  let node = doc;
  let at = '';
  let found = null;
  for (const raw of path.split('/').slice(1)) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(node) ? !/^\d+$/.test(key) : !isMap(node) || !Object.hasOwn(node, key)) break;
    node = node[key];
    at += `/${raw}`;
    if (isMap(node) && typeof node.type === 'string' && node.type !== '') found = { type: node.type, at };
  }
  return found ? `the ${clip(found.type)} block at ${found.at}` : '';
}

/** The full explanation of one error, as lines. */
export function explainError(error, doc) {
  const why = refusedWhen(error.code);
  const block = blockAt(error.path, doc);
  return [
    `${error.code} at ${error.path || '(root)'}${block ? `, in ${block}` : ''}`,
    error.message ? `${error.message.charAt(0).toUpperCase()}${error.message.slice(1)}.` : '',
    why ? `Refused when ${why}.` : '',
  ].filter(Boolean);
}
