import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'));

// The playground's example menu: two starter docs, then one doc per golden block
// type holding that golden's input. The first entry is what the page opens on.
export function playgroundExamples() {
  const starters = [
    { id: 'starter', group: 'Start here', label: 'A tour of the format', doc: read('scripts', 'playground', 'starter.json') },
    { id: 'three-mistakes', group: 'Start here', label: 'Three mistakes for the checker', doc: read('fixtures', 'broken', 'mixed-three-codes.json').doc },
  ];
  const goldens = fs.readdirSync(path.join(root, 'goldens', 'blocks')).filter((file) => file.endsWith('.golden.json')).sort().map((file) => {
    const golden = read('goldens', 'blocks', file);
    return { id: `block-${golden.type}`, group: 'Block types', label: golden.type, doc: { blocks: [golden.input] } };
  });
  return [...starters, ...goldens];
}
