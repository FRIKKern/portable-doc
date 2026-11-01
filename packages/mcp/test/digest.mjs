import { createHash } from 'node:crypto';
import { canonical } from '../ops/terms.js';

export const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex').slice(0, 12);
