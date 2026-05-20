/**
 * semantic-diff — block-level layout drift between the editor canvas and
 * each export-channel preview, ignoring sub-pixel rendering noise.
 *
 * Prototype-grade (Goal pdoc-un3 / C2). For each fixture we:
 *   1. Spin vite preview + headless Chromium (same pattern as visual-check).
 *   2. Snap the editor's .paper-column and harvest every top-level block's
 *      bounding rect via page.evaluate().
 *   3. For each channel (html, docx-preview, epub.js) load the relevant
 *      preview surface in a fresh page, snap it, harvest block rects.
 *   4. Align blocks by document order (index-based — robust enough for
 *      the fixed-shape fixtures shipped today) and compute, per block:
 *        - dy:  preview_top - editor_top, normalized by editor line-height
 *        - dh:  preview_height - editor_height, same units
 *        - iou: box intersection-over-union (0=disjoint, 1=identical)
 *        - sig: Hamming distance on a 16×16 binary downsample of each rect
 *               (the pixel-signature fallback for channels where DOM
 *               segmentation is opaque, e.g. canvas-backed renderers)
 *   5. Persist editor.png, <channel>.png, block-overlays.png, result.json
 *      under apps/editor/.papir-check/semantic-diff/<fixture>/.
 *   6. Print a summary table; exit 0 (C3 wires sub-em assertions later).
 *
 * Limits: pdf is skipped — pdftoppm raster has no DOM and the line-height
 * normalization needs the editor's computed style anyway. Block alignment
 * is index-based; if the preview channel drops or merges a block, the
 * downstream rows misalign and dy/dh balloon. That's by design — surfacing
 * structural drift IS one of the things this harness is for.
 *
 * Usage:
 *   pnpm -C apps/editor check:semantic-diff [fixture-name ...]
 *   tsx scripts/semantic-diff.ts welcome incident
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs, existsSync, readFileSync } from 'node:fs';
import { join, resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:http';
import { extname } from 'node:path';
import sharp from 'sharp';
import { PNG } from 'pngjs';
import { chromium, type Browser, type Page } from 'playwright';
import type { PortableDoc } from '@portable-doc/core';
import { toDocxBlob } from '../src/export/toDocx.ts';
import { toEpubBlob } from '../src/export/toEpub.ts';
import { toHtmlBlob } from '../src/export/toHtml.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const editorRoot = resolvePath(__dirname, '..');
const repoRoot = resolvePath(__dirname, '..', '..', '..');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const fixtures = args.length > 0 ? args : ['welcome'];

const outRoot = join(editorRoot, '.papir-check', 'semantic-diff');
await fs.mkdir(outRoot, { recursive: true });

const VIEWPORT = { width: 1200, height: 1600 };
const RAW_BLOCKS_SELECTOR =
  '.ProseMirror > *, [data-testid="paper-column"] > *:not([data-testid="paper-column"])';

type BlockRect = { x: number; y: number; w: number; h: number; tag: string };
type ChannelKey = 'html' | 'docx' | 'epub';
type ChannelResult = {
  fixture: string;
  channel: ChannelKey;
  blocks: Array<{
    idx: number;
    editor: BlockRect;
    preview: BlockRect | null;
    dy_em: number | null;
    dh_em: number | null;
    box_iou: number | null;
    sig_hamming: number | null;
  }>;
  aggregate: {
    block_count: number;
    matched: number;
    avg_dy_em: number;
    max_dy_em: number;
    avg_dh_em: number;
    avg_box_iou: number;
    avg_sig_hamming: number;
  };
};

// ─── server plumbing (mirrors visual-check) ─────────────────────────────
let browser: Browser | undefined;
let vitePreview: ChildProcess | undefined;
let staticServer: Server | undefined;

async function cleanup(): Promise<void> {
  try { await browser?.close(); } catch {}
  if (vitePreview && !vitePreview.killed) { try { vitePreview.kill('SIGTERM'); } catch {} }
  if (staticServer) await new Promise<void>((r) => staticServer!.close(() => r()));
}
process.on('SIGINT', () => { cleanup().finally(() => process.exit(130)); });

async function waitForPort(port: number, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`);
      if (r.ok || r.status === 304) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`port ${port} did not come up in ${ms}ms`);
}

function startStaticServer(root: string): Promise<number> {
  return new Promise((ok, bad) => {
    const srv = createServer(async (req, res) => {
      try {
        const url = (req.url || '/').split('?')[0]!;
        const fp = join(root, decodeURIComponent(url));
        if (!fp.startsWith(root)) { res.statusCode = 403; res.end('no'); return; }
        const data = await fs.readFile(fp);
        const t: Record<string, string> = {
          '.html': 'text/html; charset=utf-8', '.xhtml': 'application/xhtml+xml',
          '.epub': 'application/epub+zip', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.png': 'image/png', '.js': 'application/javascript', '.css': 'text/css',
        };
        res.setHeader('content-type', t[extname(fp).toLowerCase()] ?? 'application/octet-stream');
        res.end(data);
      } catch { res.statusCode = 404; res.end('nope'); }
    });
    srv.on('error', bad);
    srv.listen(0, '127.0.0.1', () => {
      const a = srv.address(); if (!a || typeof a === 'string') return bad(new Error('bind'));
      staticServer = srv; ok(a.port);
    });
  });
}

// ─── geometry helpers ──────────────────────────────────────────────────
function iou(a: BlockRect, b: BlockRect): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

async function pixelSignature(png: Buffer, rect: BlockRect, n = 16): Promise<Uint8Array> {
  const left = Math.max(0, Math.floor(rect.x));
  const top = Math.max(0, Math.floor(rect.y));
  const width = Math.max(1, Math.floor(rect.w));
  const height = Math.max(1, Math.floor(rect.h));
  const buf = await sharp(png)
    .extract({ left, top, width, height })
    .resize(n, n, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer();
  // Threshold at mean luma → binary signature.
  let sum = 0; for (const b of buf) sum += b;
  const mean = sum / buf.length;
  const sig = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i++) sig[i] = buf[i]! < mean ? 1 : 0;
  return sig;
}

function hamming(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length); if (n === 0) return 0;
  let diff = 0; for (let i = 0; i < n; i++) if (a[i] !== b[i]) diff++;
  return diff / n;
}

// ─── DOM block harvest ─────────────────────────────────────────────────
async function harvestBlocks(page: Page, rootSelector: string): Promise<{ rects: BlockRect[]; lineHeight: number }> {
  return page.evaluate(({ sel }) => {
    const root = document.querySelector(sel) as HTMLElement | null;
    if (!root) return { rects: [], lineHeight: 16 };
    // Prefer ProseMirror direct children; fall back to root direct children.
    const pm = root.querySelector('.ProseMirror') as HTMLElement | null;
    const host = pm ?? root;
    const out: { x: number; y: number; w: number; h: number; tag: string }[] = [];
    const baseRect = root.getBoundingClientRect();
    for (const child of Array.from(host.children) as HTMLElement[]) {
      const r = child.getBoundingClientRect();
      if (r.height < 2) continue; // skip zero-height noise
      out.push({
        x: r.left - baseRect.left,
        y: r.top - baseRect.top,
        w: r.width,
        h: r.height,
        tag: child.tagName.toLowerCase(),
      });
    }
    const lh = parseFloat(getComputedStyle(host).lineHeight);
    return { rects: out, lineHeight: Number.isFinite(lh) && lh > 0 ? lh : 24 };
  }, { sel: rootSelector });
}

// ─── overlay rendering ─────────────────────────────────────────────────
async function drawOverlay(pngPath: string, rects: BlockRect[], outPath: string, title: string): Promise<void> {
  const meta = await sharp(pngPath).metadata();
  const W = meta.width ?? VIEWPORT.width, H = meta.height ?? VIEWPORT.height;
  const boxes = rects.map((r, i) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="#ff3b30" stroke-width="2"/><text x="${r.x + 4}" y="${r.y + 14}" font-size="12" fill="#ff3b30" font-family="-apple-system,Helvetica,Arial">${i}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><text x="8" y="20" font-size="14" fill="#0a84ff" font-family="-apple-system,Helvetica,Arial">${title}</text>${boxes}</svg>`;
  await sharp(pngPath).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(outPath);
}

async function composeSideBySide(left: string, right: string, out: string): Promise<void> {
  const [a, b] = await Promise.all([sharp(left).metadata(), sharp(right).metadata()]);
  const w = (a.width ?? 0) + (b.width ?? 0), h = Math.max(a.height ?? 0, b.height ?? 0);
  await sharp({ create: { width: w, height: h, channels: 4, background: '#fff' } })
    .composite([{ input: left, top: 0, left: 0 }, { input: right, top: 0, left: a.width ?? 0 }])
    .png().toFile(out);
}

// ─── per-channel render (inline HTML in headless Chrome) ───────────────
async function renderChannel(channel: ChannelKey, doc: PortableDoc, workDir: string): Promise<{ png: string; rects: BlockRect[]; lineHeight: number } | { skipped: string }> {
  const port = staticServer ? (staticServer.address() as { port: number }).port : await startStaticServer(workDir);
  let html = '', filename = '', selector = 'body';
  if (channel === 'html') {
    const blob = await toHtmlBlob(doc);
    await fs.writeFile(join(workDir, 'channel-html.html'), Buffer.from(await blob.arrayBuffer()));
    filename = 'channel-html.html'; selector = 'body';
  } else if (channel === 'docx') {
    const blob = await toDocxBlob(doc);
    await fs.writeFile(join(workDir, 'channel.docx'), Buffer.from(await blob.arrayBuffer()));
    html = `<!doctype html><html><head><meta charset="utf-8"><script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script><script src="https://cdn.jsdelivr.net/npm/docx-preview@0.3.7/dist/docx-preview.js"></script><style>html,body{margin:0;padding:0;background:#fff;font-family:'Source Serif 4',Georgia,serif}#viewer{width:820px;padding:24px;box-sizing:border-box}</style></head><body><div id="viewer"></div><script>(async()=>{try{const r=await fetch('channel.docx');const buf=await r.arrayBuffer();await docx.renderAsync(buf, document.getElementById('viewer'));window.__ready=true;}catch(e){window.__err=String(e&&e.message||e);}})();</script></body></html>`;
    await fs.writeFile(join(workDir, 'channel-docx.html'), html);
    filename = 'channel-docx.html'; selector = '#viewer .docx-wrapper, #viewer';
  } else { // epub
    const blob = await toEpubBlob(doc);
    await fs.writeFile(join(workDir, 'channel.epub'), Buffer.from(await blob.arrayBuffer()));
    html = `<!doctype html><html><head><meta charset="utf-8"><script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script><script src="https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js"></script><style>html,body{margin:0;padding:0;background:#fff}#viewer{width:820px;min-height:1200px}</style></head><body><div id="viewer"></div><script>(async()=>{try{const r=await fetch('channel.epub');const buf=await r.arrayBuffer();const book=ePub(buf);const ren=book.renderTo('viewer',{width:820,height:1200,flow:'scrolled-doc'});await ren.display();window.__ready=true;}catch(e){window.__err=String(e&&e.message||e);}})();</script></body></html>`;
    await fs.writeFile(join(workDir, 'channel-epub.html'), html);
    filename = 'channel-epub.html'; selector = '#viewer';
  }
  const ctx = await browser!.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}/${filename}`);
    if (channel !== 'html') {
      await page.waitForFunction(() => (window as unknown as { __ready?: boolean; __err?: string }).__ready === true || !!(window as unknown as { __err?: string }).__err, undefined, { timeout: 15000 });
      const err = await page.evaluate(() => (window as unknown as { __err?: string }).__err);
      if (err) { await ctx.close(); return { skipped: `${channel} render failed: ${err}` }; }
    }
    await page.waitForTimeout(500);
    const target = page.locator(selector).first();
    await target.waitFor({ state: 'visible', timeout: 10000 });
    const png = join(workDir, `${channel}.png`);
    await target.screenshot({ path: png });
    const { rects, lineHeight } = await harvestBlocks(page, selector);
    return { png, rects, lineHeight };
  } finally {
    await ctx.close();
  }
}

// ─── main per-fixture flow ─────────────────────────────────────────────
async function runFixture(fix: string, previewPort: number): Promise<void> {
  const fixturePath = join(repoRoot, 'examples', `${fix}.json`);
  if (!existsSync(fixturePath)) { process.stderr.write(`skip ${fix} (no fixture)\n`); return; }
  const doc = JSON.parse(readFileSync(fixturePath, 'utf8')) as PortableDoc;
  const workDir = join(outRoot, fix);
  await fs.mkdir(workDir, { recursive: true });

  // Editor side
  const ctx = await browser!.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${previewPort}/`);
  await page.locator('[data-testid="paper-column"]').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(600);
  const editorPng = join(workDir, 'editor.png');
  await page.locator('[data-testid="paper-column"]').screenshot({ path: editorPng });
  const ed = await harvestBlocks(page, '[data-testid="paper-column"]');
  await ctx.close();

  // Channel sides
  for (const ch of ['html', 'docx', 'epub'] as ChannelKey[]) {
    const r = await renderChannel(ch, doc, workDir);
    if ('skipped' in r) { process.stderr.write(`  ${fix}/${ch}: ${r.skipped}\n`); continue; }
    const editorBuf = await fs.readFile(editorPng);
    const previewBuf = await fs.readFile(r.png);
    const N = Math.min(ed.rects.length, r.rects.length);
    const lhEm = ed.lineHeight;
    const blocks: ChannelResult['blocks'] = [];
    let dyAcc = 0, dyMax = 0, dhAcc = 0, iouAcc = 0, sigAcc = 0, matched = 0;
    for (let i = 0; i < ed.rects.length; i++) {
      const e = ed.rects[i]!;
      const p = i < r.rects.length ? r.rects[i]! : null;
      if (!p) { blocks.push({ idx: i, editor: e, preview: null, dy_em: null, dh_em: null, box_iou: null, sig_hamming: null }); continue; }
      const dy = (p.y - e.y) / lhEm;
      const dh = (p.h - e.h) / lhEm;
      const boxIou = iou(e, p);
      let sigH: number | null = null;
      try {
        const eSig = await pixelSignature(editorBuf, e);
        const pSig = await pixelSignature(previewBuf, p);
        sigH = hamming(eSig, pSig);
      } catch { /* extract failure → null sig */ }
      blocks.push({ idx: i, editor: e, preview: p, dy_em: dy, dh_em: dh, box_iou: boxIou, sig_hamming: sigH });
      dyAcc += dy; dyMax = Math.max(dyMax, Math.abs(dy)); dhAcc += dh; iouAcc += boxIou;
      if (sigH != null) { sigAcc += sigH; }
      matched++;
    }
    const result: ChannelResult = {
      fixture: fix, channel: ch, blocks,
      aggregate: {
        block_count: N, matched,
        avg_dy_em: matched ? dyAcc / matched : 0,
        max_dy_em: dyMax,
        avg_dh_em: matched ? dhAcc / matched : 0,
        avg_box_iou: matched ? iouAcc / matched : 0,
        avg_sig_hamming: matched ? sigAcc / matched : 0,
      },
    };
    await fs.writeFile(join(workDir, `result-${ch}.json`), JSON.stringify(result, null, 2));
    const edOv = join(workDir, `editor-overlay-${ch}.png`);
    const prOv = join(workDir, `${ch}-overlay.png`);
    await drawOverlay(editorPng, ed.rects, edOv, 'editor');
    await drawOverlay(r.png, r.rects, prOv, ch);
    await composeSideBySide(edOv, prOv, join(workDir, `block-overlays-${ch}.png`));
    summary.push(result);
  }
}

const summary: ChannelResult[] = [];

// ─── orchestrate ───────────────────────────────────────────────────────
try {
  if (!existsSync(join(editorRoot, 'dist/index.html'))) {
    process.stderr.write('  building editor (no dist/ yet)…\n');
    await new Promise<void>((ok, bad) => {
      const p = spawn('pnpm', ['build'], { cwd: editorRoot, stdio: 'inherit' });
      p.on('exit', (c) => (c === 0 ? ok() : bad(new Error(`pnpm build exit ${c}`))));
    });
  }
  const previewPort = 5174;
  vitePreview = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(previewPort), '--strictPort', '--host', '127.0.0.1'], { cwd: editorRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForPort(previewPort, 15000);
  try { browser = await chromium.launch({ headless: true }); }
  catch (err) { throw new Error(`Chromium launch failed (try: pnpm exec playwright install chromium). ${err instanceof Error ? err.message : err}`); }

  for (const fix of fixtures) await runFixture(fix, previewPort);

  // Print table.
  const header = ['Fixture', 'Channel', 'Blocks', 'AvgDY', 'MaxDY', 'AvgIoU', 'AvgSig'];
  const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
  const cols = [16, 8, 7, 9, 9, 8, 8];
  process.stdout.write(header.map((h, i) => pad(h, cols[i]!)).join('') + '\n');
  process.stdout.write('-'.repeat(cols.reduce((a, b) => a + b, 0)) + '\n');
  for (const r of summary) {
    const row = [
      r.fixture, r.channel, String(r.aggregate.matched),
      r.aggregate.avg_dy_em.toFixed(2) + 'em',
      r.aggregate.max_dy_em.toFixed(2) + 'em',
      r.aggregate.avg_box_iou.toFixed(2),
      r.aggregate.avg_sig_hamming.toFixed(2),
    ];
    process.stdout.write(row.map((s, i) => pad(s, cols[i]!)).join('') + '\n');
  }
} catch (err) {
  process.stderr.write(`semantic-diff failed: ${err instanceof Error ? err.stack || err.message : String(err)}\n`);
  await cleanup();
  process.exit(0); // informational only — C3 gates failures.
} finally {
  await cleanup();
}
process.exit(0);
