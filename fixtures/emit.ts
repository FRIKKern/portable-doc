/**
 * Emit canonical JSON artifacts from the typed TypeScript fixtures.
 *
 * Run with: `pnpm fixtures:emit`. Keeps welcome.json / incident.json byte-aligned
 * with their .ts source so MCP and downstream consumers can read raw JSON.
 */

import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { incident } from './incident.js';
import { welcome } from './welcome.js';

const here = dirname(fileURLToPath(import.meta.url));

async function emit(name: string, value: unknown): Promise<void> {
  const path = resolve(here, `${name}.json`);
  const json = JSON.stringify(value, null, 2) + '\n';
  await writeFile(path, json, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`wrote ${path}`);
}

await emit('welcome', welcome);
await emit('incident', incident);
