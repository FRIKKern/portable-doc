/**
 * editor-page — the shared LIVE-editor Playwright setup for the two render legs
 * (`render-to-pdf.ts` geometry tier, `render-to-png.ts` advisory vision tier).
 *
 * Both legs boot the SAME editor app, inject the SAME in-memory fixture doc,
 * wait through the SAME ready gate, hide the SAME app chrome, and settle fonts
 * the SAME way before printing / screenshotting. That setup used to be
 * copy-pasted byte-for-byte across the two files; this module is the ONE source
 * of truth so the geometry PDF and the vision PNG come off an identical DOM.
 *
 * It owns only the page-level setup. The shared Vite dev server lives in
 * `render-to-pdf.ts` (the `getEditorServerUrl()` / `closeEditorServer()`
 * singleton both legs share), and each leg still owns its own browser launch,
 * page geometry, and capture call (PDF vs. PDF+PNG) — only the byte-identical
 * fixture/ready/chrome/font sequence is hoisted here.
 */
import type { Page } from 'playwright';
import type { PortableDoc } from '@portable-doc/core';

/**
 * Hide the editor's app CHROME so a capture shows the DOCUMENT canvas only —
 * the rendered blocks, not the surrounding UI. The footer status strip,
 * margin-diagnostics gutter, floating block-chrome cluster, and the preview
 * side-panels are editor affordances, not document content; left visible they
 * segment into extra PDF blocks (e.g. the footer's "✓ valid / saved just now"
 * strip) that have no counterpart in any export channel and would mis-pair
 * against the closing paragraph. We render the real .ProseMirror layout under
 * the editor's own paper.css; only the chrome is suppressed.
 */
export const CHROME_HIDE_CSS = `
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

/**
 * Queue the fixture-doc injection so it runs BEFORE any app script. lib/fixtures
 * reads `window.__PAPERFLOW_FIXTURE_DOC__` in resolveFixtureFromUrl(), so the
 * editor boots straight onto this doc with no flash of the welcome fixture and
 * no on-disk fixture required. Call this BEFORE `page.goto(...)`.
 */
export async function injectFixtureDoc(page: Page, doc: PortableDoc): Promise<void> {
  await page.addInitScript((injected) => {
    (window as unknown as { __PAPERFLOW_FIXTURE_DOC__: unknown }).__PAPERFLOW_FIXTURE_DOC__ =
      injected;
  }, doc as unknown);
}

/**
 * Wait through the editor's deterministic ready gate, then hide the app chrome
 * and let fonts settle — i.e. everything between `page.goto(...)` and the
 * capture. App.tsx sets `data-fixture-ready` once the TipTap instance mounts;
 * we then wait for the ProseMirror surface to carry actual text so we never
 * capture a blank or half-laid-out frame, suppress the chrome, and finally
 * await `document.fonts.ready` so glyph metrics (and thus block geometry) are
 * stable. Call this AFTER `page.goto(...)` and BEFORE `page.pdf()` /
 * `page.screenshot()`.
 */
export async function waitForEditorReady(page: Page): Promise<void> {
  // Deterministic ready gate (App.tsx sets data-fixture-ready once the TipTap
  // instance mounts). Then wait for the ProseMirror surface to carry actual
  // text so we never capture a blank or half-laid-out frame.
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
  // Let fonts settle so glyph metrics (and thus block geometry) are stable.
  await page.evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready);
}

/**
 * Settle web fonts on a page that does NOT use the editor canvas (the HTML /
 * EPUB channel legs, which load their own document). Just awaits
 * `document.fonts.ready` so glyph metrics are stable before a capture.
 */
export async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready);
}
