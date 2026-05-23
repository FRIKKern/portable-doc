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

/** A render captured as BOTH a PDF (for geometry) and a full-page PNG (for the
 *  human-eye overlay), with the PNG's pixel dimensions for overlay mapping. */
export type PngRender = {
  /** PDF bytes — feed into `extractPdfGeometry` for the block indices. */
  pdf: Uint8Array;
  /** Full-page PNG screenshot bytes. */
  png: Buffer;
  /** PNG raster dimensions in pixels. */
  dims: { width: number; height: number };
};

const CHROME_HIDE_CSS = `
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
`;

async function capturePng(
  page: import('playwright').Page,
): Promise<PngRender> {
  const pdf = new Uint8Array(await page.pdf(PDF_PAGE));
  // Constrain the screenshot to the document canvas so the PNG frames the
  // rendered blocks (not the full viewport with empty gutters). Fall back to a
  // full-page shot if the canvas element isn't found.
  const canvas =
    (await page.$('.paper-editor')) ??
    (await page.$('.ProseMirror')) ??
    (await page.$('body'));
  const shot = canvas
    ? await canvas.screenshot({ type: 'png' })
    : await page.screenshot({ fullPage: true, type: 'png' });
  const png = Buffer.from(shot);
  const box = canvas ? await canvas.boundingBox() : null;
  const viewport = page.viewportSize();
  const dims = {
    width: Math.round(box?.width ?? viewport?.width ?? 0),
    height: Math.round(box?.height ?? viewport?.height ?? 0),
  };
  return { pdf, png, dims };
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
    const page = await browser.newPage();
    await page.addInitScript((injected) => {
      (window as unknown as { __PAPERFLOW_FIXTURE_DOC__: unknown }).__PAPERFLOW_FIXTURE_DOC__ =
        injected;
    }, doc as unknown);
    await page.goto(`${baseUrl}/?fixture=injected`, { waitUntil: 'load' });
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
    await page.addStyleTag({ content: CHROME_HIDE_CSS });
    await page.evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready);
    return await capturePng(page);
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
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready);
    const pdf = new Uint8Array(await page.pdf(PDF_PAGE));
    const shot = await page.screenshot({ fullPage: true, type: 'png' });
    const png = Buffer.from(shot);
    const dimsHandle = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    return { pdf, png, dims: { width: Math.round(dimsHandle.width), height: Math.round(dimsHandle.height) } };
  } finally {
    await browser.close();
  }
}
