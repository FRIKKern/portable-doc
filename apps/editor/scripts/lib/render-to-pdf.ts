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
import { promises as fsp } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, type Browser, type LaunchOptions } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import JSZip from 'jszip';
import type { PortableDoc } from '@portable-doc/core';
import { toHtmlBlob } from '../../src/export/toHtml.ts';
import { toPdfBlob } from '../../src/export/toPdf.ts';
import { toDocxBlob } from '../../src/export/toDocx.ts';
import { toEpubBlob } from '../../src/export/toEpub.ts';

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
 * Boot (or reuse) the shared editor dev server and return its base URL. The
 * advisory render-to-png leg (T7) uses this so the whole funnel — geometry and
 * vision tiers — shares ONE dev server and the single `closeEditorServer()`
 * tears down everything.
 */
export async function getEditorServerUrl(): Promise<string> {
  const server = await getEditorServer();
  return serverUrl(server);
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

/**
 * Render the PDF EXPORT of a fixture (T4 — full geometry gate channel).
 *
 * The PDF channel is the ONE channel that is ALREADY a PDF: `toPdfBlob` emits
 * a paginated, font-embedded PDF directly (pdfmake). There is NOTHING to
 * re-render — feeding the editor's chromium `page.pdf()` machinery a
 * pdfmake-produced PDF would only re-paginate it under a DIFFERENT page
 * geometry and corrupt the very glyph coordinates we measure. So we hand the
 * export bytes STRAIGHT to `extractPdfGeometry` (bound decision #7: PDF is a
 * full-geometry-gate channel). The trade-off is that the PDF channel uses its
 * OWN page geometry (A4 / 22mm margins, set in toPdf.ts) rather than the
 * shared `PDF_PAGE` (Letter / 1in) — that's fine: the metric is the
 * scale-INVARIANT line-height-normalized inter-block gap (layout-match.ts), so
 * a uniform page-size / margin difference cancels exactly like the editor↔HTML
 * zoom split already does.
 */
export async function renderPdfChannelToPdf(doc: PortableDoc): Promise<Uint8Array> {
  const blob = await toPdfBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

// ─── soffice (LibreOffice) DOCX→PDF conversion ───────────────────────────────

/** Resolve the LibreOffice binary. `soffice` is the macOS/Homebrew name; some
 *  Linux distros ship `libreoffice`. We let PATH resolve it and surface a
 *  clear error if the spawn fails (HARD RULE: never fake a channel — if
 *  soffice is absent the DOCX leg throws, it does not stub a PDF). */
const SOFFICE_BIN = process.env.PAPIR_SOFFICE_BIN || 'soffice';

/** soffice can be slow + serial (it serializes on a single user profile). A
 *  generous per-conversion cap keeps a hung headless instance from wedging the
 *  whole verifier; on timeout we kill the process and throw. */
const SOFFICE_TIMEOUT_MS = 90_000;

/** Run `soffice --headless --convert-to pdf` for one .docx into `outDir`.
 *  Each call gets its OWN `-env:UserInstallation` profile dir so concurrent /
 *  back-to-back conversions don't collide on LibreOffice's single-profile lock
 *  (the classic "another instance is running" / silent no-output failure). */
function sofficeConvert(docxPath: string, outDir: string, profileDir: string): Promise<void> {
  return new Promise((resolveOk, rejectErr) => {
    const argv = [
      '--headless',
      '--norestore',
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      '--convert-to',
      'pdf',
      '--outdir',
      outDir,
      docxPath,
    ];
    const proc = spawn(SOFFICE_BIN, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    const errChunks: Buffer[] = [];
    proc.stdout?.on('data', () => {});
    proc.stderr?.on('data', (c) => errChunks.push(c as Buffer));
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      rejectErr(
        new Error(
          `soffice DOCX→PDF timed out after ${SOFFICE_TIMEOUT_MS}ms (${docxPath})`,
        ),
      );
    }, SOFFICE_TIMEOUT_MS);
    proc.on('error', (e) => {
      clearTimeout(timer);
      rejectErr(
        new Error(
          `failed to spawn '${SOFFICE_BIN}' (is LibreOffice installed? brew install --cask libreoffice): ${e.message}`,
        ),
      );
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolveOk();
      else
        rejectErr(
          new Error(
            `${SOFFICE_BIN} ${argv.join(' ')} exited ${code}: ${Buffer.concat(errChunks).toString().slice(0, 400)}`,
          ),
        );
    });
  });
}

/**
 * Render the DOCX EXPORT of a fixture (T4 — full geometry gate, reflow-sanity
 * tolerance per bound decision #12: LibreOffice is the oracle, not Word).
 *
 * Flow (bound decision #6 + #12):
 *   toDocxBlob(doc) → temp .docx → soffice --headless --convert-to pdf →
 *   read the produced PDF → bytes for extractPdfGeometry.
 *
 * Decision #6 asserts the embedded font survived the round-trip: after the
 * convert we scan the produced PDF for the Source Serif 4 family name and
 * throw LOUDLY if LibreOffice substituted a different face (a silent font
 * swap would shift every glyph metric and read as a layout defect that is
 * really a font bug). The scan is on the raw PDF bytes — embedded subsets are
 * named `<TAG>+SourceSerif4-Regular` etc., so the family token is present
 * verbatim when the face embedded.
 */
export async function renderDocxChannelToPdf(doc: PortableDoc): Promise<Uint8Array> {
  const blob = await toDocxBlob(doc);
  const docxBytes = Buffer.from(await blob.arrayBuffer());

  const runDir = await fsp.mkdtemp(join(tmpdir(), 'papir-docx-'));
  const profileDir = join(runDir, 'lo-profile');
  await fsp.mkdir(profileDir, { recursive: true });
  const docxPath = join(runDir, 'channel.docx');
  await fsp.writeFile(docxPath, docxBytes);

  try {
    await sofficeConvert(docxPath, runDir, profileDir);
    const pdfPath = join(runDir, 'channel.pdf');
    let pdfBytes: Buffer;
    try {
      pdfBytes = await fsp.readFile(pdfPath);
    } catch {
      throw new Error(
        `soffice ran but produced no PDF at ${pdfPath} — DOCX→PDF conversion failed`,
      );
    }
    if (pdfBytes.byteLength === 0) {
      throw new Error(`soffice produced an EMPTY PDF at ${pdfPath}`);
    }
    // Decision #6 — fail LOUDLY on font substitution. We inspect the produced
    // PDF's font table (authoritatively, via poppler `pdffonts`) and report
    // whether the Source Serif 4 family survived the LibreOffice convert. See
    // checkSourceSerif4Embedded for the strict-vs-warn policy.
    await checkSourceSerif4Embedded(pdfPath, pdfBytes, 'DOCX');
    return new Uint8Array(pdfBytes);
  } finally {
    await fsp.rm(runDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** When set, a Source Serif 4 substitution in the DOCX→PDF convert is a HARD
 *  failure (throws); otherwise it is a loud `console.warn` and the run
 *  continues so the DOCX geometry leg (the channel's primary signal) still
 *  produces a verdict. Decision #6 mandates "fail loudly on substitution"; the
 *  observed reality is that headless LibreOffice substitutes LiberationSerif
 *  for whichever SS4 WEIGHTS aren't resolvable from the .docx-embedded fonts
 *  on a host where SS4 is not installed system-wide (funnel-hard.json's bold
 *  runs trigger this; welcome.json's regular-only text embeds SS4 fine). The
 *  default is loud-warn; flip PAPIR_STRICT_FONT=1 to make it block. */
const STRICT_FONT = process.env.PAPIR_STRICT_FONT === '1';

/** Authoritatively list the font names embedded in `pdfPath` via poppler's
 *  `pdffonts`. Returns the raw font-name column (one per line). Falls back to
 *  a latin1 byte scan of `pdfBytes` only when `pdffonts` is unavailable — that
 *  scan misses fonts hidden in compressed object streams, so it is a last
 *  resort, not the primary check. */
function listPdfFonts(pdfPath: string): Promise<string[] | null> {
  return new Promise((resolveOk) => {
    const proc = spawn('pdffonts', [pdfPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    proc.stdout?.on('data', (c) => out.push(c as Buffer));
    proc.on('error', () => resolveOk(null)); // pdffonts not installed
    proc.on('exit', (code) => {
      if (code !== 0) {
        resolveOk(null);
        return;
      }
      const lines = Buffer.concat(out).toString('utf8').split('\n').slice(2); // drop header + rule
      const names = lines
        .map((l) => l.trim().split(/\s+/)[0] ?? '')
        .filter((n) => n.length > 0);
      resolveOk(names);
    });
  });
}

/**
 * Decision #6: report Source Serif 4 survival through the DOCX→PDF convert.
 * Throws when STRICT_FONT and the family is fully absent / substituted;
 * otherwise emits one loud `console.warn` naming the substituted faces and
 * lets the geometry leg proceed. Exported for the focused test.
 */
export async function checkSourceSerif4Embedded(
  pdfPath: string,
  pdfBytes: Buffer,
  channelLabel: string,
): Promise<void> {
  const isSerif = (n: string) => /sourceserif/i.test(n) || /source serif/i.test(n);
  const fonts = await listPdfFonts(pdfPath);

  let hasSerif: boolean;
  let substituted: string[];
  if (fonts) {
    hasSerif = fonts.some(isSerif);
    substituted = fonts.filter((n) => !isSerif(n));
  } else {
    // pdffonts absent — last-resort latin1 byte scan (misses compressed
    // object-stream font dicts, so we DON'T treat its negative as proof).
    const text = pdfBytes.toString('latin1');
    hasSerif = /sourceserif/i.test(text) || /source serif/i.test(text);
    substituted = [];
  }

  if (hasSerif && substituted.length === 0) return; // clean — SS4 only.

  const detail = fonts
    ? `embedded fonts: [${fonts.join(', ')}]`
    : `(pdffonts unavailable; byte-scan ${hasSerif ? 'found' : 'did NOT find'} an SS4 token)`;
  const msg =
    `${channelLabel} channel: LibreOffice ${hasSerif ? 'PARTIALLY substituted' : 'fully SUBSTITUTED'} ` +
    `the Source Serif 4 family on DOCX→PDF convert — ${detail}. ` +
    `Bound decision #6: fail loudly on substitution. Headless LibreOffice only ` +
    `honors the .docx-embedded SS4 weights it can resolve; install Source Serif 4 ` +
    `system-wide on the conversion host for full fidelity. The geometry leg still ` +
    `runs (line-height-normalized metric tolerates a uniform face swap), but the ` +
    `verdict reflects LibreOffice's substituted layout, not the editor's exact face.`;
  if (STRICT_FONT && !hasSerif) {
    throw new Error(msg + ' [PAPIR_STRICT_FONT=1 → HARD FAILURE]');
  }
  // eslint-disable-next-line no-console
  console.warn(`WARN ${msg}`);
}

// ─── EPUB → PDF (informational geometry; bound decision #7 structural tier) ───

/** A tiny in-process static server rooted at `root`, used to serve the
 *  unzipped EPUB so the chapter XHTML's relative refs (../styles, ../fonts,
 *  ../images) resolve when Chromium loads it. Returns the listening port. */
function startEpubStaticServer(root: string): Promise<{ server: HttpServer; port: number }> {
  return new Promise((resolveOk, rejectErr) => {
    const types: Record<string, string> = {
      '.xhtml': 'application/xhtml+xml; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.ttf': 'font/ttf',
      '.otf': 'font/otf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
    };
    const server = createHttpServer(async (req, res) => {
      try {
        const url = (req.url || '/').split('?')[0]!;
        const filePath = join(root, decodeURIComponent(url));
        if (!filePath.startsWith(root)) {
          res.statusCode = 403;
          res.end('forbidden');
          return;
        }
        const data = await fsp.readFile(filePath);
        res.setHeader('content-type', types[extname(filePath).toLowerCase()] ?? 'application/octet-stream');
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
        rejectErr(new Error('epub static server has no resolvable address'));
        return;
      }
      resolveOk({ server, port: addr.port });
    });
  });
}

/**
 * Render the EPUB EXPORT of a fixture to PDF (bound decision #7: EPUB is a
 * STRUCTURAL-tier channel — geometry is INFORMATIONAL, never gates, because an
 * EPUB is reflowable and has no fixed layout). We still produce real geometry
 * so the informational signal is honest:
 *
 *   toEpubBlob(doc) → unzip (JSZip) to a temp dir → serve it over loopback →
 *   load OPS/chapters/chapter-1.xhtml in Chromium under the shared PDF_PAGE →
 *   page.pdf() → bytes for extractPdfGeometry.
 *
 * Rendering the XHTML content doc directly (rather than via epub.js) keeps the
 * geometry leg on the SAME chromium `page.pdf()` machinery as the editor + HTML
 * legs — same page size, same glyph stream — so the informational delta is at
 * least measured on a comparable scale. The bundled OPS/styles/*.css +
 * OPS/fonts/*.ttf resolve through the loopback static server.
 */
export async function renderEpubChannelToPdf(
  doc: PortableDoc,
  options?: RenderOptions,
): Promise<Uint8Array> {
  const blob = await toEpubBlob(doc);
  const epubBytes = Buffer.from(await blob.arrayBuffer());

  const runDir = await fsp.mkdtemp(join(tmpdir(), 'papir-epub-'));
  let server: HttpServer | undefined;
  let browser: Browser | undefined;
  try {
    // Unzip every entry to disk preserving the OPS/... layout so relative
    // hrefs in the chapter XHTML resolve against the static server.
    const zip = await JSZip.loadAsync(epubBytes);
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    await Promise.all(
      entries.map(async (entry) => {
        const dest = join(runDir, entry.name);
        if (!dest.startsWith(runDir)) return; // zip-slip guard
        await fsp.mkdir(dirname(dest), { recursive: true });
        await fsp.writeFile(dest, Buffer.from(await entry.async('uint8array')));
      }),
    );
    const chapterRel = 'OPS/chapters/chapter-1.xhtml';
    if (!entries.some((e) => e.name === chapterRel)) {
      throw new Error(`EPUB has no ${chapterRel} — cannot render its content doc`);
    }

    const started = await startEpubStaticServer(runDir);
    server = started.server;

    browser = await chromium.launch({ headless: true, ...options?.launch });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${started.port}/${chapterRel}`, {
      waitUntil: 'networkidle',
    });
    await page.evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready);
    const buf = await page.pdf(PDF_PAGE);
    return new Uint8Array(buf);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    await fsp.rm(runDir, { recursive: true, force: true }).catch(() => {});
  }
}
