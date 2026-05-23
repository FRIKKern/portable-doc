/**
 * render-to-png — the human-eye render leg for the ADVISORY visual-agent tier
 * (Goal pdoc-r9p / T7). The geometry tier renders to PDF and reads glyph
 * coordinates; the visual tier needs the SAME live editor / channel rendered as
 * a RASTER a vision model can look at, PLUS the PDF geometry so overlay numbers
 * stay tied to the geometry block indices (the shared vocabulary across tiers).
 *
 * This mirrors `render-to-pdf.ts` EXACTLY — same shared Vite dev server, same
 * `__PAPERFLOW_FIXTURE_DOC__` injection, same ready gate, same chrome-hiding
 * stylesheet, same `toHtmlBlob` channel path — but in a single page visit it
 * captures BOTH `page.pdf(PDF_PAGE)` (for `extractPdfGeometry`) AND
 * `page.screenshot({ fullPage: true })` (for the overlay). One visit keeps the
 * two artifacts from the same DOM layout, so the geometry indices and the
 * pixels line up.
 *
 * It deliberately reuses `render-to-pdf.ts`'s exported page geometry, dev-server
 * singleton, and teardown rather than re-implementing them, so there is one
 * editor server for the whole funnel and `closeEditorServer()` still tears down
 * everything.
 *
 * Playwright is the only heavy dep and is imported at module top-level here —
 * this module is on the CLI path (`check:vision`), never imported by the pure
 * deterministic test (which exercises vision-verify.ts's pure units directly).
 */
import { chromium, type Browser } from 'playwright';
import type { PortableDoc } from '@portable-doc/core';
import { toHtmlBlob } from '../../src/export/toHtml.ts';
import {
  PDF_PAGE,
  getEditorServerUrl,
  type RenderOptions,
} from './render-to-pdf.ts';
import { injectFixtureDoc, waitForEditorReady, waitForFonts } from './editor-page.ts';

/**
 * Raster constants for the human-eye PNG leg, DERIVED from `PDF_PAGE` so the
 * screenshot and the PDF geometry share ONE coordinate basis (pdoc-7fq fix).
 *
 * `PDF_PAGE` is US Letter (8.5in × 11in) with 1in margins all round. PDF user
 * space is points (1pt = 1/72in); a browser screenshot is CSS pixels
 * (1px = 1/96in). So `px = pt × 96/72 = pt × 4/3`.
 *
 * We capture BOTH legs at a viewport whose CSS width equals the PDF page width
 * (816px) and at `deviceScaleFactor: 1`, so:
 *   - the editor PNG and the channel PNG come out at the SAME width (defect #2),
 *   - and overlay boxes map from geometry points to screenshot pixels by the
 *     single fixed scale below (defect #1) — no "stretch the bbox to fill"
 *     guesswork.
 *
 * A `page.pdf()` PAGINATES the same flow the full-page screenshot captures as
 * ONE continuous column. So a block's PDF document-y (stacked physical pages,
 * each carrying top+bottom margins) must be de-paginated back to a continuous
 * content-y before scaling — `geometryToOverlayBoxes` does that with these
 * numbers (see `RasterMap`).
 */
export const RASTER = {
  /** PDF page width in points (Letter, 8.5in). */
  pageWidthPt: 612,
  /** PDF page height in points (Letter, 11in). */
  pageHeightPt: 792,
  /** Page margin in points (1in, all sides — matches `PDF_PAGE`). */
  marginPt: 72,
  /** CSS px per PDF point (96 DPI screenshot / 72 DPI PDF). */
  pxPerPt: 96 / 72,
  /** Viewport CSS width = page width in px (612pt × 4/3). Both legs use it. */
  pageWidthPx: 816,
  /** No HiDPI upscaling — keeps px == pt × pxPerPt exactly. */
  deviceScaleFactor: 1,
} as const;

/** A render captured as BOTH a PDF (for geometry) and a full-page PNG (for the
 *  human-eye overlay), with the PNG's pixel dimensions for overlay mapping. */
export type PngRender = {
  /** PDF bytes — feed into `extractPdfGeometry` for the block indices. */
  pdf: Uint8Array;
  /** Full-page PNG screenshot bytes. */
  png: Buffer;
  /** PNG raster dimensions in pixels. */
  dims: { width: number; height: number };
  /** The screenshot's CONTENT ORIGIN in pixels — the top-left of the first laid
   *  out content element. The PDF's 1-inch top margin and a surface's own body
   *  padding are NOT identical (the editor canvas and the portable reader use
   *  different leading), so a fixed `marginPt × pxPerPt` assumption leaves a
   *  per-side vertical bias. Anchoring the overlay map to THIS measured origin
   *  removes that bias so box N tightly bounds block N. */
  contentOrigin: { x: number; y: number };
};

/** Read a captured PNG's true raster dimensions from its IHDR header so `dims`
 *  reflects the actual bytes (not a viewport guess). A PNG starts with an
 *  8-byte signature, then the IHDR chunk: 4-byte length, "IHDR", then big-endian
 *  uint32 width + uint32 height. */
function pngDims(png: Buffer): { width: number; height: number } {
  // IHDR width at byte 16, height at byte 20 (after sig[8] + len[4] + "IHDR"[4]).
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * Measure the screenshot CONTENT ORIGIN: the top-left pixel of the first laid
 * out content element on the page. This is the same point the PDF's first block
 * occupies (the document's content top-left), so anchoring the overlay map here
 * cancels the per-surface body-padding bias. Selectors are tried in order; we
 * scan a paragraph/heading inside the content container rather than the
 * container itself (the container's own padding is the bias we are removing).
 */
async function measureContentOrigin(
  page: import('playwright').Page,
): Promise<{ x: number; y: number }> {
  const box = await page.evaluate(() => {
    const roots = [
      '.paper-editor [contenteditable="true"]',
      '.ProseMirror',
      'main',
      'article',
      'body',
    ];
    for (const sel of roots) {
      const root = document.querySelector(sel);
      if (!root) continue;
      // First element child that actually renders content (skips empty wrappers).
      const first = Array.from(root.children).find((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const el = first ?? root;
      const r = el.getBoundingClientRect();
      return {
        x: r.left + window.scrollX,
        y: r.top + window.scrollY,
      };
    }
    return { x: 0, y: 0 };
  });
  return { x: Math.round(box.x), y: Math.round(box.y) };
}

/** Full-page screenshot (NOT an element bounding box) so the PNG flow tiles the
 *  SAME way the PDF paginates, and so editor + channel come out at the SAME
 *  width — the viewport width is pinned to the PDF page width by the caller.
 *  Takes the already-printed PDF bytes so each leg prints exactly once. */
async function capturePng(
  page: import('playwright').Page,
  pdf: Uint8Array,
): Promise<PngRender> {
  const contentOrigin = await measureContentOrigin(page);
  const shot = await page.screenshot({ fullPage: true, type: 'png' });
  const png = Buffer.from(shot);
  return { pdf, png, dims: pngDims(png), contentOrigin };
}

/**
 * Render the EDITOR CANVAS of a fixture to PDF + PNG by driving the LIVE editor
 * app — same flow as `renderEditorToPdf`, with a screenshot captured alongside.
 */
export async function renderEditorToPng(
  doc: PortableDoc,
  options?: RenderOptions,
): Promise<PngRender> {
  const baseUrl = await getEditorServerUrl();
  const browser: Browser = await chromium.launch({ headless: true, ...options?.launch });
  try {
    // Pin the viewport CSS width to the PDF page width and disable HiDPI so the
    // screenshot raster is px == pt × pxPerPt and matches the channel leg width.
    const page = await browser.newPage({
      viewport: { width: RASTER.pageWidthPx, height: 1024 },
      deviceScaleFactor: RASTER.deviceScaleFactor,
    });
    // Same shared fixture/ready/chrome/font gate as the geometry PDF leg
    // (editor-page.ts) so the screenshot and the PDF come off an identical DOM.
    await injectFixtureDoc(page, doc);
    await page.goto(`${baseUrl}/?fixture=injected`, { waitUntil: 'load' });
    await waitForEditorReady(page);
    const pdf = new Uint8Array(await page.pdf(PDF_PAGE));
    return await capturePng(page, pdf);
  } finally {
    await browser.close();
  }
}

/**
 * Render the HTML EXPORT of a fixture to PDF + PNG via the real `toHtmlBlob`
 * serializer — same flow as `renderHtmlChannelToPdf`, with a screenshot
 * captured alongside.
 */
export async function renderHtmlChannelToPng(
  doc: PortableDoc,
  options?: RenderOptions,
): Promise<PngRender> {
  const blob = await toHtmlBlob(doc);
  const html = Buffer.from(await blob.arrayBuffer()).toString('utf8');
  const browser = await chromium.launch({ headless: true, ...options?.launch });
  try {
    // Same viewport width + deviceScaleFactor as the editor leg so the two PNGs
    // are directly comparable side by side (defect #2) and the geometry → px
    // mapping is identical for both (defect #1).
    const page = await browser.newPage({
      viewport: { width: RASTER.pageWidthPx, height: 1024 },
      deviceScaleFactor: RASTER.deviceScaleFactor,
    });
    await page.setContent(html, { waitUntil: 'networkidle' });
    await waitForFonts(page);
    const pdf = new Uint8Array(await page.pdf(PDF_PAGE));
    return await capturePng(page, pdf);
  } finally {
    await browser.close();
  }
}
