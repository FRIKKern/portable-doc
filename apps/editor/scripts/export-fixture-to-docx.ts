/**
 * export-fixture-to-docx — run a Papir fixture JSON through `toDocxBlob`
 * and write the resulting .docx bytes to disk (or stdout).
 *
 * Usage:
 *   tsx apps/editor/scripts/export-fixture-to-docx.ts <fixture.json> [out.docx]
 *
 * No Vite involved — imports the workspace source directly via tsx ESM.
 * Lives alongside `bin/papir-visual-check`; see docs/visual-fidelity-workflow.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PortableDoc } from '@portable-doc/core';
import { toDocxBlob } from '../src/export/toDocx.ts';

const [, , inPath, outPath] = process.argv;

if (!inPath) {
  process.stderr.write(
    'usage: tsx export-fixture-to-docx.ts <fixture.json> [out.docx]\n',
  );
  process.exit(1);
}

let doc: PortableDoc;
try {
  const raw = readFileSync(resolve(inPath), 'utf8');
  doc = JSON.parse(raw) as PortableDoc;
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`failed to read/parse fixture ${inPath}: ${msg}\n`);
  process.exit(1);
}

try {
  const blob = await toDocxBlob(doc);
  const buf = Buffer.from(await blob.arrayBuffer());
  if (outPath) {
    writeFileSync(resolve(outPath), buf);
    process.stderr.write(`wrote ${buf.byteLength} bytes -> ${outPath}\n`);
  } else {
    process.stdout.write(buf);
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`toDocxBlob failed: ${msg}\n`);
  process.exit(1);
}
