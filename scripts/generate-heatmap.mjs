import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReports } from './lib/conformance.mjs';
import { render } from './lib/heatmap.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(root, 'docs', 'images', 'conformance.svg');

const fail = (why) => {
  console.error(`${why}\nnothing drawn`);
  process.exit(1);
};

const { reports, types, errors } = readReports(root);
if (errors.length) fail(`conformance reports are not valid:\n${errors.join('\n')}`);
const schema = JSON.parse(fs.readFileSync(path.join(root, 'spec', 'blocks.schema.json'), 'utf8'));
const blocks = schema.definitions?.blocks ?? {};
let svg;
try {
  svg = render(reports, types, (type) => blocks[type]?.['x-tier']);
} catch (e) {
  fail(e.message);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, svg);
console.log(`wrote ${path.relative(root, OUT)}: ${types.length} types × ${reports.length} renderers`);
