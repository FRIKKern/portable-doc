/**
 * visual-goldens — emit per-fixture per-surface artifacts under `goldens/` for
 * eyeball review. NOT a CI gate (per spec §10): structural snapshots run in CI;
 * visuals are on-demand + weekly.
 *
 * 2 fixtures × 4 text surfaces (Ink TUI truecolor, Ink-mono text fallback,
 * Email HTML, Web HTML) = 8 files. Native (RN) and Web-editor (RNW) need a
 * React renderer + DOM, so they're not suitable for "open the file and read it"
 * eyeball review and are skipped here.
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
  // Ink truecolor — pinned to 'truecolor' so the artifact captures the
  // v0.2 quality jump regardless of whether the script is piped (in which case
  // supports-color would auto-degrade to mono). The escapes survive the
  // round-trip and modern terminals render them when `cat`-ed.
  tui:   { ext: 'txt',  render: (doc) => renderInk(composeDocument(doc as never), { colorDepth: 'truecolor' }) },
  // Plain-text fallback via Ink-mono — strips all ANSI, emits structural prose.
  // No separate backend-text package; mono mode is the canonical fallback.
  text:  { ext: 'txt',  render: (doc) => renderInk(composeDocument(doc as never), { colorDepth: 'mono' }) },
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
