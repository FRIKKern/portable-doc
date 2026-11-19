import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { DOC_CAP_BYTES } from './share.js';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

// One minified IIFE: React, react-dom/client, the react package from its TSX
// source, the validator and the error words. A classic script, so the page also
// works opened from disk (browsers refuse module scripts over file://). No
// source map and no paths in the output, so the same inputs give the same bytes.
/** `cap`: the doc cap baked in, DOC_CAP_BYTES unless a test asks for a smaller one. */
export function bundlePlayground({ cap = DOC_CAP_BYTES } = {}) {
  const result = buildSync({
    absWorkingDir: root,
    entryPoints: ['scripts/playground/main.jsx'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    jsx: 'automatic',
    loader: { '.md': 'text' },
    define: { 'process.env.NODE_ENV': '"production"', 'globalThis.PLAYGROUND_DOC_CAP': String(cap) },
    minify: true,
    sourcemap: false,
    legalComments: 'eof',
    write: false,
    logLevel: 'silent',
  });
  if (result.outputFiles.length !== 1) throw new Error(`playground bundle: expected one output, got ${result.outputFiles.length}`);
  return Buffer.from(result.outputFiles[0].contents);
}
