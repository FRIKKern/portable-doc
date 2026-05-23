/**
 * render-to-pdf — the "universal-PDF funnel" render leg (Goal pdoc-r9p / T2).
 *
 * The funnel verifier renders EVERY export channel AND the editor canvas to
 * PDF, then compares per-block GEOMETRY read from the PDF (see
 * `pdf-geometry.ts`, T1). This module is the render leg for the two cheapest
 * surfaces — the editor canvas and the HTML export — both via headless
 * Chromium's `page.pdf(...)`. Both return a `Uint8Array` so the bytes pipe
 * straight into `extractPdfGeometry(input)`.
 *
 * The editor leg renders the LIVE editor (pdoc-4pz)
 * -------------------------------------------------
 * `renderEditorToPdf` boots the REAL editor app — the same TipTap/ProseMirror
 * stack the writer uses — and prints its canvas to PDF. It does NOT
 * re-implement `paper.css` in a `setContent` string (the prior approximation,
 * which the verifier could not trust because its divergences might have been
 * artifacts of the re-implementation). The flow:
 *
 *     vite createServer(apps/editor)            // one shared dev server
 *        │  (lazy singleton, reused across fixtures, torn down on exit)
 *        ▼
 *     page.addInitScript(window.__PAPERFLOW_FIXTURE_DOC__ = <doc>)
 *        │  (lib/fixtures.ts reads this BEFORE React mounts)
 *        ▼
 *     page.goto('http://127.0.0.1:<port>/?fixture=<injected>')
 *        ▼
 *     wait [data-testid=paper-app][data-fixture-ready=true] + non-empty .ProseMirror
 *        ▼
 *     page.pdf(PDF_PAGE)                         // ACTUAL editor DOM+CSS
 *
 * The doc is injected through `window.__PAPERFLOW_FIXTURE_DOC__` rather than a
 * `?fixture=<name>` lookup so the verifier can render an IN-MEMORY doc that may
 * not exist on disk; the URL still carries `?fixture=injected` for traceability
 * and so the human-facing URL-param path (lib/fixtures.ts) stays exercised.
 *
 * Geometry comparability
 * ----------------------
 * `renderEditorToPdf` and `renderHtmlChannelToPdf` use the SAME page size and
 * margins (`PDF_PAGE`), so the continuous-y axis `extractPdfGeometry` stitches
 * is on the same scale for both sides. The editor and the HTML export use
 * different stylesheets by design (the editor canvas vs. the portable reader
 * CSS) — that difference is exactly what the geometry gate measures; we hold
 * the PAGE geometry fixed so block-to-block deltas are the only variable.
 *
 * Server lifecycle
 * ----------------
 * The first `renderEditorToPdf` call boots one Vite dev server for the editor
 * app and caches it; later calls reuse it (booting per-fixture would dominate
 * runtime). The server tears down automatically on process exit; tests can
 * force teardown via `closeEditorServer()`.
 */
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type LaunchOptions } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import type { PortableDoc } from '@portable-doc/core';
import { toHtmlBlob } from '../../src/export/toHtml.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/lib → apps/editor (the Vite project root with index.html).
const editorAppRoot = resolvePath(__dirname, '..', '..');

// ─── shared page geometry (identical for both render legs) ───────────────────

/**
 * Page size + margins shared by every render leg so the stitched
 * continuous-y axis is on one scale. US Letter with 1-inch margins is the
 * pdfmake/PDF-channel default this project already uses; matching it keeps
 * the editor + HTML legs comparable to the eventual PDF channel too.
 */
export const PDF_PAGE = {
  format: 'Letter' as const,
  margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' },
  printBackground: true,
} as const;

// ─── public types ────────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Forwarded to `chromium.launch`. Defaults to headless. */
  launch?: LaunchOptions;
}

// ─── shared editor dev-server (lazy singleton) ───────────────────────────────

let serverPromise: Promise<ViteDevServer> | null = null;

/** Boot (once) the editor app's Vite dev server and return it. */
async function getEditorServer(): Promise<ViteDevServer> {
  if (!serverPromise) {
    serverPromise = (async () => {
      const server = await createServer({
        root: editorAppRoot,
        // The repo vite.config is picked up from `root`; we only override the
        // server knobs the funnel needs. A fixed loopback host keeps the URL
        // stable; port 0 lets the OS pick a free port so parallel runs / the
        // dev server proper don't collide.
        configFile: undefined,
        server: { host: '127.0.0.1', port: 0, strictPort: false },
        // Quiet: the funnel summary is the signal, not Vite's banner.
        logLevel: 'warn',
        clearScreen: false,
      });
      await server.listen();
      return server;
    })();
  }
  return serverPromise;
}

/** Resolve the dev server's base URL (e.g. http://127.0.0.1:5173). */
function serverUrl(server: ViteDevServer): string {
  const addr = server.httpServer?.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('editor dev server has no resolvable address');
  }
  const host = addr.address === '::' || addr.address === '0.0.0.0' ? '127.0.0.1' : addr.address;
  return `http://${host}:${addr.port}`;
}

/**
 * Tear down the shared editor dev server. Idempotent. Tests call this in an
 * `afterAll` so vitest can exit; in the CLI the process-exit hook below covers
 * it. No-op if the server was never booted.
 */
export async function closeEditorServer(): Promise<void> {
  if (!serverPromise) return;
  const p = serverPromise;
  serverPromise = null;
  try {
    const server = await p;
    await server.close();
  } catch {
    // Best-effort teardown — a server that already crashed is fine to ignore.
  }
}

// Belt-and-suspenders: if a CLI run forgets to close, don't leak the server
// past process exit. (Tests use the explicit closeEditorServer() above.)
process.once('exit', () => {
  // `exit` can't await; fire-and-forget close. The OS reclaims the socket
  // regardless, this just hastens it for long-lived parents.
  void closeEditorServer();
});

// ─── render legs ─────────────────────────────────────────────────────────────

/**
 * Render the EDITOR CANVAS of a fixture to PDF by driving the LIVE editor app.
 * Boots (or reuses) the editor's Vite dev server, injects the doc into the
 * page before React mounts, waits for the real TipTap editor to lay it out,
 * then prints the canvas to PDF with the shared page geometry. Returns the PDF
 * bytes — feed straight into `extractPdfGeometry`.
 */
export async function renderEditorToPdf(
  doc: PortableDoc,
  options?: RenderOptions,
): Promise<Uint8Array> {
  const server = await getEditorServer();
  const baseUrl = serverUrl(server);

  const browser: Browser = await chromium.launch({ headless: true, ...options?.launch });
  try {
    const page = await browser.newPage();
    // Inject the doc BEFORE any app script runs. lib/fixtures.ts reads
    // window.__PAPERFLOW_FIXTURE_DOC__ in resolveFixtureFromUrl(), so the
    // editor boots straight onto this doc with no flash of the welcome
    // fixture and no on-disk fixture required.
    await page.addInitScript((injected) => {
      (window as unknown as { __PAPERFLOW_FIXTURE_DOC__: unknown }).__PAPERFLOW_FIXTURE_DOC__ =
        injected;
    }, doc as unknown);

    await page.goto(`${baseUrl}/?fixture=injected`, { waitUntil: 'load' });

    // Deterministic ready gate (App.tsx sets data-fixture-ready once the
    // TipTap instance mounts). Then wait for the ProseMirror surface to carry
    // actual text so we never print a blank or half-laid-out frame.
    await page.waitForSelector('[data-testid="paper-app"][data-fixture-ready="true"]', {
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => {
        const pm = document.querySelector('.paper-editor [contenteditable="true"], .ProseMirror');
        return !!pm && (pm.textContent ?? '').trim().length > 0;
      },
      undefined,
      { timeout: 30_000 },
    );
    // Hide the editor's app CHROME so the PDF captures the DOCUMENT canvas
    // only — the rendered blocks, not the surrounding UI. The footer status
    // strip, margin-diagnostics gutter, floating block-chrome cluster, and the
    // preview side-panels are editor affordances, not document content; left
    // visible they segment into extra PDF blocks (e.g. the footer's "✓ valid /
    // saved just now" strip) that have no counterpart in any export channel
    // and would mis-pair against the closing paragraph. We render the real
    // .ProseMirror layout under the editor's own paper.css; only the chrome is
    // suppressed.
    await page.addStyleTag({
      content: `
        .paper-footer,
        .paper-margin-diagnostics,
        .paper-floating-chrome,
        .paper-block__side-handle,
        [data-testid="paper-block-side-handle"],
        [data-testid="margin-diagnostics"],
        [data-testid="docx-preview-panel"],
        [data-testid="ink-preview-panel"],
        [data-testid="epub-preview-panel"],
        [data-testid="pdf-preview-panel"] { display: none !important; }
      `,
    });

    // Let fonts settle so glyph metrics (and thus block geometry) are stable.
    await page.evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready);

    const buf = await page.pdf(PDF_PAGE);
    return new Uint8Array(buf);
  } finally {
    await browser.close();
  }
}

/**
 * Render the HTML EXPORT of a fixture to PDF. Produces the channel via the
 * real `toHtmlBlob` serializer (the same bytes a writer would export), then
 * prints that document to PDF with the shared page geometry. Returns the PDF
 * bytes — feed straight into `extractPdfGeometry`. (Unchanged by pdoc-4pz.)
 */
export async function renderHtmlChannelToPdf(
  doc: PortableDoc,
  options?: RenderOptions,
): Promise<Uint8Array> {
  const blob = await toHtmlBlob(doc);
  const html = Buffer.from(await blob.arrayBuffer()).toString('utf8');
  const browser = await chromium.launch({ headless: true, ...options?.launch });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const buf = await page.pdf(PDF_PAGE);
    return new Uint8Array(buf);
  } finally {
    await browser.close();
  }
}
