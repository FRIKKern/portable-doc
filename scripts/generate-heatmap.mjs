import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { draw } from './lib/heatmap.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(root, 'docs', 'images', 'conformance.svg');

const { reports, errors, svg } = draw(root);
if (errors.length) {
  console.error(`${errors.join('\n')}\nnothing drawn`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, svg);
console.log(`wrote ${path.relative(root, OUT)}: ${reports[0].rows.length} types × ${reports.length} renderers`);
