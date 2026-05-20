/**
 * visual-check — multi-channel visual-fidelity pipeline.
 *
 * One command, four PNGs: the editor (truth), .docx-via-LibreOffice,
 * .pdf-via-poppler, and .epub-via-epubjs all rasterized at a common
 * width and pixel-diffed against the editor.
 *
 * Pipeline:
 *   1. Generate .docx / .pdf / .epub from the fixture in parallel.
 *   2. Build the editor and run `vite preview` on a fresh port.
 *   3. Launch Playwright Chromium (headless).
 *   4. Screenshot the editor's .paper-column element — the truth PNG.
 *   5. Render each format to PNG (soffice + pdftoppm + epubjs).
 *   6. Resize all PNGs to a common width via sharp.
 *   7. pixelmatch each format against editor.png; partition the diff
 *      PNG into 4 horizontal bands to surface the worst-region hint.
 *   8. Composite a 4-up PNG (Editor | Word | PDF | EPUB) with header strip.
 *   9. Emit JSON to stdout; auto-open the composite unless --quiet.
 *
 * Usage:
 *   tsx visual-check.ts [fixture.json] [--all-channels] [--quiet]
 *                       [--out <dir>] [--keep-servers]
 *
 * Background: docs/visual-fidelity-workflow.md (Phase 2 roadmap).
 * bin/papir-visual-check delegates here when --all-channels is set.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { promises as fs, readFileSync, existsSync } from 'node:fs';
import { extname, join, resolve as resolvePath, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { PortableDoc } from '@portable-doc/core';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { chromium, type Browser } from 'playwright';
import { toDocxBlob } from '../src/export/toDocx.ts';
import { toPdfBlob } from '../src/export/toPdf.ts';
import { toEpubBlob } from '../src/export/toEpub.ts';

// ─── argv ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let quiet = false;
let allChannels = false;
let keepServers = false;
let outOverride: string | undefined;
let fixturePath: string | undefined;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--quiet') quiet = true;
  else if (a === '--all-channels') allChannels = true;
  else if (a === '--keep-servers') keepServers = true;
  else if (a === '--out') outOverride = args[++i];
  else if (a === '-h' || a === '--help') {
    console.error(
      'usage: tsx visual-check.ts [fixture.json] [--all-channels] [--quiet] [--out <dir>]',
    );
    process.exit(0);
  } else if (!a.startsWith('--')) fixturePath = a;
}

// We currently always run the multi-channel path here — `bin/papir-visual-check`
// already handles the legacy docx-only fall-through. Flag is preserved for
// future single-channel modes (e.g. --only=pdf).
void allChannels;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolvePath(__dirname, '..', '..', '..');
const editorRoot = resolvePath(__dirname, '..');

if (!fixturePath) fixturePath = join(repoRoot, 'examples/welcome.json');
fixturePath = resolvePath(fixturePath);
if (!existsSync(fixturePath)) {
  console.error(`fixture not found: ${fixturePath}`);
  process.exit(1);
}

const workDir =
  outOverride ?? join(tmpdir(), `papir-visual-${Date.now()}`);
await fs.mkdir(workDir, { recursive: true });

// ─── prereqs ─────────────────────────────────────────────────────────────
function have(bin: string): boolean {
  try {
    execFileSync('command', ['-v', bin], { stdio: 'ignore', shell: '/bin/bash' });
    return true;
  } catch {
    return false;
  }
}
const missing: string[] = [];
if (!have('soffice')) missing.push('soffice (brew install --cask libreoffice)');
if (!have('pdftoppm')) missing.push('pdftoppm (brew install poppler)');
if (missing.length) {
  console.error('Missing tools:\n  ' + missing.join('\n  '));
  process.exit(1);
}

// ─── timing ──────────────────────────────────────────────────────────────
const elapsed: Record<string, number> = {};
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const out = await fn();
  elapsed[name] = Date.now() - t0;
  process.stderr.write(`  [${name}] ${elapsed[name]}ms\n`);
  return out;
}
const totalStart = Date.now();

// ─── shared state for cleanup ────────────────────────────────────────────
let browser: Browser | undefined;
let vitePreview: ChildProcess | undefined;
let staticServer: Server | undefined;

async function cleanup(): Promise<void> {
  try {
    await browser?.close();
  } catch {}
  if (!keepServers) {
    if (vitePreview && !vitePreview.killed) {
      try {
        vitePreview.kill('SIGTERM');
      } catch {}
    }
    if (staticServer) {
      await new Promise<void>((r) => staticServer!.close(() => r()));
    }
  }
}
process.on('SIGINT', () => {
  cleanup().finally(() => process.exit(130));
});

// ─── doc loader ──────────────────────────────────────────────────────────
const doc = JSON.parse(readFileSync(fixturePath, 'utf8')) as PortableDoc;

const docxPath = join(workDir, 'test.docx');
const pdfPath = join(workDir, 'test.pdf');
const epubPath = join(workDir, 'test.epub');
const editorPng = join(workDir, 'editor.png');
const docxPngRaw = join(workDir, 'docx-raw.png');
const pdfPngRaw = join(workDir, 'pdf-raw.png');
const epubPngRaw = join(workDir, 'epub-raw.png');

const NORMALIZED_W = 820;
const editorNormalized = join(workDir, 'editor-norm.png');
const docxNormalized = join(workDir, 'docx-norm.png');
const pdfNormalized = join(workDir, 'pdf-norm.png');
const epubNormalized = join(workDir, 'epub-norm.png');

const docxDiff = join(workDir, 'diff-docx.png');
const pdfDiff = join(workDir, 'diff-pdf.png');
const epubDiff = join(workDir, 'diff-epub.png');
const compositePath = join(workDir, 'comparison-4up.png');

try {
  // ─── STEP 1: write 3 format files in parallel ──────────────────────────
  await step('serialize', async () => {
    const [docxBlob, pdfBlob, epubBlob] = await Promise.all([
      toDocxBlob(doc),
      toPdfBlob(doc),
      toEpubBlob(doc),
    ]);
    await Promise.all([
      fs.writeFile(docxPath, Buffer.from(await docxBlob.arrayBuffer())),
      fs.writeFile(pdfPath, Buffer.from(await pdfBlob.arrayBuffer())),
      fs.writeFile(epubPath, Buffer.from(await epubBlob.arrayBuffer())),
    ]);
  });

  // ─── STEP 2: build the editor + launch vite preview ────────────────────
  if (!existsSync(join(editorRoot, 'dist/index.html'))) {
    await step('build-editor', async () => {
      await runProc('pnpm', ['build'], { cwd: editorRoot });
    });
  } else {
    elapsed['build-editor'] = 0;
  }

  const previewPort = 5174;
  // vite preview defaults to binding 'localhost' only (which can resolve
  // IPv6-only on macOS). `--host 127.0.0.1` forces an IPv4 bind so the
  // Playwright + waitForPort fetches land on the same socket.
  await step('vite-preview', async () => {
    vitePreview = spawn(
      'pnpm',
      [
        'exec', 'vite', 'preview',
        '--port', String(previewPort),
        '--strictPort',
        '--host', '127.0.0.1',
      ],
      { cwd: editorRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    await waitForPort(previewPort, 15000);
  });

  // ─── STEP 3: launch Playwright ─────────────────────────────────────────
  await step('chromium-launch', async () => {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to launch Chromium. Run: pnpm exec playwright install chromium\n  ${msg}`,
      );
    }
  });

  // ─── STEP 4: editor screenshot ─────────────────────────────────────────
  await step('editor-screenshot', async () => {
    const ctx = await browser!.newContext({
      viewport: { width: 1200, height: 1600 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${previewPort}/`);
    const column = page.locator('[data-testid="paper-column"]');
    await column.waitFor({ state: 'visible', timeout: 15000 });
    // Give web fonts + the OutlineRail mount a beat to settle before snapping.
    await page.waitForTimeout(500);
    await column.screenshot({ path: editorPng });
    await ctx.close();
  });

  // ─── STEP 5: docx → PDF → PNG ──────────────────────────────────────────
  await step('docx-render', async () => {
    // soffice writes <name>.pdf next to its input; we route into a sub-dir so
    // the .pdf doesn't collide with the real PDF channel.
    const docxPdfDir = join(workDir, 'docx-via-soffice');
    await fs.mkdir(docxPdfDir, { recursive: true });
    await runProc('soffice', [
      '--headless',
      '--convert-to',
      'pdf',
      docxPath,
      '--outdir',
      docxPdfDir,
    ]);
    const docxPdf = join(docxPdfDir, 'test.pdf');
    if (!existsSync(docxPdf)) {
      throw new Error(`LibreOffice produced no PDF at ${docxPdf}`);
    }
    await runProc('pdftoppm', [
      '-r', '150', '-f', '1', '-l', '1', '-png',
      docxPdf, join(workDir, 'docx'),
    ]);
    const candidate = join(workDir, 'docx-1.png');
    if (existsSync(candidate)) await fs.rename(candidate, docxPngRaw);
  });

  // ─── STEP 6: pdf → PNG ────────────────────────────────────────────────
  await step('pdf-render', async () => {
    await runProc('pdftoppm', [
      '-r', '150', '-f', '1', '-l', '1', '-png',
      pdfPath, join(workDir, 'pdf'),
    ]);
    const candidate = join(workDir, 'pdf-1.png');
    if (existsSync(candidate)) await fs.rename(candidate, pdfPngRaw);
  });

  // ─── STEP 7: epub → PNG via epub.js in headless Chrome ─────────────────
  await step('epub-render', async () => {
    // epub.min.js does NOT bundle JSZip — it relies on a `JSZip` global.
    // Load JSZip first, then epub.js.
    const html = `<!doctype html>
<html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js"></script>
<style>html,body{margin:0;padding:0;background:#FBFAF6;}#viewer{width:820px;min-height:1200px;}</style>
</head><body><div id="viewer"></div>
<script>
(async () => {
  try {
    const r = await fetch('test.epub');
    const buf = await r.arrayBuffer();
    const book = ePub(buf);
    const rendition = book.renderTo('viewer', { width: 820, height: 1200, flow: 'scrolled-doc' });
    await rendition.display();
    window.__epubReady = true;
  } catch (e) {
    window.__epubError = String(e && e.message || e);
  }
})();
</script></body></html>`;
    await fs.writeFile(join(workDir, 'epub-render.html'), html);

    // Tiny static server scoped to workDir.
    const port = await startStaticServer(workDir);
    try {
      const ctx = await browser!.newContext({
        viewport: { width: 1000, height: 1400 },
        deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:${port}/epub-render.html`);
      await page.waitForFunction(
        () => (window as unknown as { __epubReady?: boolean; __epubError?: string }).__epubReady === true
          || !!(window as unknown as { __epubError?: string }).__epubError,
        undefined,
        { timeout: 15000 },
      );
      const err = await page.evaluate(
        () => (window as unknown as { __epubError?: string }).__epubError,
      );
      if (err) throw new Error(`epub.js render failed: ${err}`);
      await page.waitForTimeout(400);
      const viewer = page.locator('#viewer');
      await viewer.screenshot({ path: epubPngRaw });
      await ctx.close();
    } finally {
      // Keep static server for inspection if --keep-servers; otherwise close.
      if (!keepServers && staticServer) {
        await new Promise<void>((r) => staticServer!.close(() => r()));
        staticServer = undefined;
      }
    }
  });

  // ─── STEP 8: normalize widths via sharp ───────────────────────────────
  await step('normalize', async () => {
    await Promise.all([
      normalize(editorPng, editorNormalized),
      normalize(docxPngRaw, docxNormalized),
      normalize(pdfPngRaw, pdfNormalized),
      normalize(epubPngRaw, epubNormalized),
    ]);
  });

  // ─── STEP 9: pixel-diff each channel ──────────────────────────────────
  type ChannelResult = {
    rendered_png: string;
    normalized_png: string;
    diff_png: string;
    diff_score: number;
    worst_region: string;
  };
  let docxResult!: ChannelResult;
  let pdfResult!: ChannelResult;
  let epubResult!: ChannelResult;

  await step('pixel-diff', async () => {
    const editorPNG = await readPng(editorNormalized);
    const [docxPng, pdfPng, epubPng] = await Promise.all([
      readPng(docxNormalized),
      readPng(pdfNormalized),
      readPng(epubNormalized),
    ]);
    docxResult = await diffAndScore(editorPNG, docxPng, docxPngRaw, docxNormalized, docxDiff);
    pdfResult = await diffAndScore(editorPNG, pdfPng, pdfPngRaw, pdfNormalized, pdfDiff);
    epubResult = await diffAndScore(editorPNG, epubPng, epubPngRaw, epubNormalized, epubDiff);
  });

  // ─── STEP 10: composite 4-up ──────────────────────────────────────────
  await step('composite', async () => {
    await composeFourUp(
      [editorNormalized, docxNormalized, pdfNormalized, epubNormalized],
      ['Editor', 'Word (.docx)', 'PDF', 'EPUB'],
      compositePath,
    );
  });

  const totalMs = Date.now() - totalStart;

  // ─── STEP 11: emit JSON ───────────────────────────────────────────────
  const channels = {
    docx: docxResult,
    pdf: pdfResult,
    epub: epubResult,
  };
  const worst = Object.entries(channels).reduce<[string, ChannelResult] | null>(
    (acc, e) => (!acc || e[1].diff_score > acc[1].diff_score ? e : acc),
    null,
  );
  const recommendation = worst
    ? `${worst[0].toUpperCase()} has highest diff (${worst[1].diff_score.toFixed(4)}) concentrated in ${worst[1].worst_region} — inspect apps/editor/src/export/to${worst[0][0]!.toUpperCase()}${worst[0].slice(1)}.ts`
    : 'No channels measured';

  const report = {
    ok: true,
    fixture: fixturePath,
    work_dir: workDir,
    editor_png: editorPng,
    channels,
    composite_png: compositePath,
    elapsed_ms_per_step: elapsed,
    elapsed_ms_total: totalMs,
    recommendation,
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');

  // ─── STEP 12: auto-open composite ─────────────────────────────────────
  if (!quiet) {
    try {
      execFileSync('open', [compositePath], { stdio: 'ignore' });
    } catch {}
  }
} catch (err) {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        fixture: fixturePath,
        work_dir: workDir,
        error: msg,
        elapsed_ms_per_step: elapsed,
        elapsed_ms_total: Date.now() - totalStart,
      },
      null,
      2,
    ) + '\n',
  );
  await cleanup();
  process.exit(1);
} finally {
  await cleanup();
}

process.exit(0);

// ─── helpers ────────────────────────────────────────────────────────────

function runProc(
  bin: string,
  argv: string[],
  opts: { cwd?: string } = {},
): Promise<void> {
  return new Promise((resolveOk, rejectErr) => {
    const proc = spawn(bin, argv, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const errChunks: Buffer[] = [];
    proc.stderr?.on('data', (c) => errChunks.push(c));
    proc.on('error', rejectErr);
    proc.on('exit', (code) => {
      if (code === 0) resolveOk();
      else
        rejectErr(
          new Error(
            `${bin} ${argv.join(' ')} exited ${code}: ${Buffer.concat(errChunks).toString().slice(0, 400)}`,
          ),
        );
    });
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok || res.status === 304) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`port ${port} did not come up within ${timeoutMs}ms`);
}

function startStaticServer(root: string): Promise<number> {
  return new Promise((resolveOk, rejectErr) => {
    const server = createServer(async (req, res) => {
      try {
        const url = (req.url || '/').split('?')[0]!;
        const filePath = join(root, decodeURIComponent(url));
        if (!filePath.startsWith(root)) {
          res.statusCode = 403;
          res.end('forbidden');
          return;
        }
        const data = await fs.readFile(filePath);
        const ext = extname(filePath).toLowerCase();
        const types: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.epub': 'application/epub+zip',
          '.png': 'image/png',
          '.js': 'application/javascript',
          '.css': 'text/css',
        };
        res.setHeader('content-type', types[ext] ?? 'application/octet-stream');
        res.end(data);
      } catch {
        res.statusCode = 404;
        res.end('not found');
      }
    });
    server.on('error', rejectErr);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        rejectErr(new Error('static server failed to bind'));
        return;
      }
      staticServer = server;
      resolveOk(addr.port);
    });
  });
}

async function normalize(input: string, output: string): Promise<void> {
  await sharp(input)
    .resize({ width: NORMALIZED_W, fit: 'contain', position: 'top', background: '#ffffff' })
    .extend({
      // pad to a fixed canvas height to make diff dimensions deterministic
      // even when the source image is shorter than the target band.
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      background: '#ffffff',
    })
    .png()
    .toFile(output);
}

async function readPng(path: string): Promise<PNG> {
  const buf = await fs.readFile(path);
  return PNG.sync.read(buf);
}

type ChannelResult = {
  rendered_png: string;
  normalized_png: string;
  diff_png: string;
  diff_score: number;
  worst_region: string;
};

async function diffAndScore(
  editor: PNG,
  channel: PNG,
  raw: string,
  norm: string,
  diffOut: string,
): Promise<ChannelResult> {
  const w = Math.min(editor.width, channel.width);
  const h = Math.min(editor.height, channel.height);
  const aBuf = await cropToBuffer(editor, w, h);
  const bBuf = await cropToBuffer(channel, w, h);
  const out = new PNG({ width: w, height: h });
  const diffPixels = pixelmatch(aBuf, bBuf, out.data, w, h, { threshold: 0.1 });
  await fs.writeFile(diffOut, PNG.sync.write(out));
  const score = diffPixels / (w * h);
  return {
    rendered_png: raw,
    normalized_png: norm,
    diff_png: diffOut,
    diff_score: score,
    worst_region: worstRegion(out),
  };
}

async function cropToBuffer(png: PNG, w: number, h: number): Promise<Buffer> {
  if (png.width === w && png.height === h) return Buffer.from(png.data);
  // pngjs has no native crop — do it through sharp.
  const cropped = await sharp(PNG.sync.write(png))
    .extract({ left: 0, top: 0, width: w, height: h })
    .raw()
    .ensureAlpha()
    .toBuffer();
  return cropped;
}

function worstRegion(diff: PNG): string {
  const { width: w, height: h, data } = diff;
  const bands = [0, 0, 0, 0];
  const bandH = Math.floor(h / 4) || 1;
  for (let y = 0; y < h; y++) {
    const band = Math.min(3, Math.floor(y / bandH));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // pixelmatch writes red pixels (255,0,0,255) for diffs.
      if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) {
        bands[band]!++;
      }
    }
  }
  const labels = [
    'top quarter (heading / first-paragraph area)',
    '2nd quarter (callout / body)',
    '3rd quarter (list / divider)',
    'bottom quarter (footer / actions)',
  ];
  let maxI = 0;
  for (let i = 1; i < 4; i++) if (bands[i]! > bands[maxI]!) maxI = i;
  return labels[maxI]!;
}

async function composeFourUp(
  imgs: string[],
  labels: string[],
  out: string,
): Promise<void> {
  const colW = NORMALIZED_W;
  const headerH = 36;
  // Read each image's height; canvas height = max + headerH.
  const metas = await Promise.all(imgs.map((p) => sharp(p).metadata()));
  const maxH = metas.reduce((m, x) => Math.max(m, x.height || 0), 0);
  const canvasH = maxH + headerH;
  const canvasW = colW * imgs.length;

  // Header strip — render via an SVG buffer so we can label columns
  // without needing a separate font file. SVG text uses system fallback.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${headerH}">
  <rect width="${canvasW}" height="${headerH}" fill="#1f1f1f"/>
  ${labels
    .map(
      (l, i) =>
        `<text x="${i * colW + colW / 2}" y="24" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="16" fill="#fafafa" text-anchor="middle">${escapeXml(l)}</text>`,
    )
    .join('\n  ')}
  ${labels
    .map(
      (_, i) =>
        i > 0
          ? `<line x1="${i * colW}" y1="0" x2="${i * colW}" y2="${headerH}" stroke="#444" stroke-width="1"/>`
          : '',
    )
    .join('\n  ')}
</svg>`;

  const composite: { input: Buffer | string; top: number; left: number }[] = [
    { input: Buffer.from(svg), top: 0, left: 0 },
  ];
  for (let i = 0; i < imgs.length; i++) {
    composite.push({ input: imgs[i]!, top: headerH, left: i * colW });
  }

  await sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(composite)
    .png()
    .toFile(out);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
