/**
 * visual-goldens — emit per-fixture per-surface artifacts under `goldens/` for
 * eyeball review. NOT a CI gate (per spec §10): structural snapshots run in CI;
 * visuals are on-demand + weekly.
 *
 * 2 fixtures × 3 text surfaces (Ink TUI, Email HTML, Web HTML) = 6 files.
 * Native (RN) and Web-editor (RNW) need a React renderer + DOM, so they're not
 * suitable for "open the file and read it" eyeball review and are skipped here.
 *
 * Run:  pnpm visual-goldens   (or  tsx scripts/visual-goldens.ts)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { composeDocument } from '@portable-doc/primitives';
import { welcome, incident } from '@portable-doc/fixtures';
import { renderInk } from '@portable-doc/backend-ink';
import { renderHtml } from '@portable-doc/backend-web-server';
import { renderEmail } from '@portable-doc/backend-email';

const fixtures = { welcome, incident } as const;

type Surface = {
  ext: 'txt' | 'html';
  render: (doc: unknown) => string | Promise<string>;
};

const surfaces: Record<string, Surface> = {
  // Ink emits ANSI-styled box-drawing text. .txt so terminals render it
  // when `cat`-ed. The escapes survive the round-trip; if you want a clean
  // pipe, set colorDepth: 'mono' in opts.
  tui:   { ext: 'txt',  render: (doc) => renderInk(composeDocument(doc as never)) },
  email: { ext: 'html', render: (doc) => renderEmail(composeDocument(doc as never)) },
  web:   { ext: 'html', render: (doc) => renderHtml(composeDocument(doc as never)) },
};

const outDir = path.resolve('goldens');
await fs.mkdir(outDir, { recursive: true });

for (const [fname, fdoc] of Object.entries(fixtures)) {
  for (const [sname, surface] of Object.entries(surfaces)) {
    const out = await surface.render(fdoc);
    const file = path.join(outDir, `${fname}-${sname}.${surface.ext}`);
    await fs.writeFile(file, out);
    console.log(`wrote ${path.relative(process.cwd(), file)}  (${out.length} bytes)`);
  }
}

console.log('Done. Open goldens/ files in your browser/terminal to eyeball.');
