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

/** Text from a doc, a file name or an argument, safe to print: control
 * characters (C0, DEL, C1) shown as \\u escapes, so they never reach a terminal. */
export const shown = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

const isMap = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const clip = (s) => (s.length > 60 ? `${s.slice(0, 60)}…` : s);

/** The innermost typed block on a JSON pointer, in words (`the heading block
 * at /blocks/2`), or '' when there is none. `show` makes doc text printable. */
export function blockAt(path, doc, show = shown) {
  let node = doc;
  let at = '';
  let found = null;
  let parent = null;
  for (const raw of path.split('/').slice(1)) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(node) ? !/^\d+$/.test(key) : !isMap(node) || !Object.hasOwn(node, key)) break;
    const inline = Array.isArray(node) && parent === 'content';
    node = node[key];
    at += `/${raw}`;
    if (isMap(node) && typeof node.type === 'string' && node.type !== '') found = { type: node.type, at, inline };
    parent = key;
  }
  return found ? `the ${show(clip(found.type))} ${found.inline ? 'node' : 'block'} at ${show(found.at)}` : '';
}

/** The full explanation of one error, as lines. `show` makes doc text
 * printable: `shown` for a terminal, `String` for JSON, which escapes it itself. */
export function explainError(error, doc, show = shown) {
  const why = refusedWhen(error.code);
  const block = blockAt(error.path, doc, show);
  return [
    `${error.code} at ${show(error.path) || '(root)'}${block ? `, in ${block}` : ''}`,
    error.message ? show(`${error.message.charAt(0).toUpperCase()}${error.message.slice(1)}.`) : '',
    why ? `Refused when ${why}.` : '',
  ].filter(Boolean);
}
