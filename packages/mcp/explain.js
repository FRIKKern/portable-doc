import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { explainWith, readCodes } from './explain-words.js';

export { readCodes, where } from './explain-words.js';

const codesFile = fileURLToPath(new URL('CODES.md', import.meta.resolve('@portable-doc/validate')));
export const REFUSED_WHEN = readCodes(fs.readFileSync(codesFile, 'utf8'));

export const explain = explainWith(REFUSED_WHEN);
