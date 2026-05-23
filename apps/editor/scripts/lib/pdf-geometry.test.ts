/**
 * pdf-geometry.test — TDD harness for the PDF-geometry segmentation engine.
 *
 * Builds a KNOWN fixture PDF in-process: Playwright's chromium renders a small
 * controlled HTML string to PDF via `page.pdf()`. The HTML carries an H1, two
 * body paragraphs at a known size, a forced page break, then a 2nd-page
 * heading + paragraph — enough to exercise BOTH the grouping rule (bound #2)
 * and the multi-page continuous-y stitch (bound #4).
 *
 * If chromium can't launch in this environment, the suite would have to fall
 * back to a committed fixture; chromium is installed here so we generate live.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { extractPdfGeometry, type PdfGeometry } from './pdf-geometry.ts';

// Known sizes baked into the fixture so assertions can reason about them.
const H1_PT = 32;
const BODY_PT = 14;
const PAGE2_H_PT = 28;

const FIXTURE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: 612px 792px; margin: 48px; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Georgia, "Times New Roman", serif; color: #000; }
  h1 { font-size: ${H1_PT}px; line-height: 1.2; margin: 0 0 18px 0; }
  h2 { font-size: ${PAGE2_H_PT}px; line-height: 1.2; margin: 0 0 16px 0; }
  p  { font-size: ${BODY_PT}px; line-height: 1.5; margin: 0 0 14px 0; }
  .pb { page-break-before: always; break-before: page; }
</style>
</head>
<body>
  <h1>Universal PDF Funnel</h1>
  <p>This first paragraph sits directly under the heading and is long enough
     that it wraps across several lines, which lets us prove a single wrapped
     paragraph is grouped into one block rather than shattered into one block
     per visual line by the segmentation engine under test.</p>
  <p>The second paragraph is a distinct block separated by paragraph spacing,
     and it too wraps across more than one line so the vertical-gap rule has a
     real run-to-run cadence to self-tune the measured line height from.</p>
  <div class="pb"></div>
  <h2>Stitched Second Page</h2>
  <p>This paragraph lives on the second physical page. Its continuous document
     y must exceed the full content height of page one once the per-page PDF
     coordinates are stitched onto a single monotonic axis.</p>
</body>
</html>`;

let browser: Browser;
let geometry: PdfGeometry;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(FIXTURE_HTML, { waitUntil: 'networkidle' });
  const pdfBuffer = await page.pdf({
    width: '612px',
    height: '792px',
    printBackground: true,
    margin: { top: '48px', bottom: '48px', left: '48px', right: '48px' },
  });
  await page.close();
  await browser.close();
  geometry = await extractPdfGeometry(new Uint8Array(pdfBuffer));
}, 60_000);

describe('extractPdfGeometry', () => {
  it('reports a two-page document with a sane measured line height', () => {
    expect(geometry.meta.pageCount).toBe(2);
    expect(geometry.meta.measuredLineHeight).toBeGreaterThan(0);
    // Body line-height is 14px × 1.5 = 21px; the median run cadence should land
    // in a plausible single-line band, well clear of zero and not page-sized.
    expect(geometry.meta.measuredLineHeight).toBeLessThan(100);
    expect(geometry.meta.groupingGapPt).toBeCloseTo(
      0.6 * geometry.meta.measuredLineHeight,
      5,
    );
  });

  it('segments heading + two paragraphs + page-2 heading + paragraph into distinct blocks', () => {
    // 5 logical blocks: H1, p1, p2, H2, p3. Allow no merging and no shatter.
    expect(geometry.blocks.length).toBe(5);
  });

  it('does NOT merge the heading into the paragraph below it (font-size-jump rule)', () => {
    const h1 = geometry.blocks[0]!;
    const p1 = geometry.blocks[1]!;
    expect(h1.textSnippet.startsWith('Universal PDF Funnel')).toBe(true);
    // The heading is its own block; its font size is clearly larger than body.
    expect(h1.fontSize).toBeGreaterThan(p1.fontSize + 2);
    expect(p1.textSnippet.startsWith('This first paragraph')).toBe(true);
  });

  it('does NOT shatter a single wrapped paragraph into per-line blocks', () => {
    // p1 wraps over multiple lines but must remain a single block whose height
    // spans more than one line of body text.
    const p1 = geometry.blocks[1]!;
    expect(p1.h).toBeGreaterThan(geometry.meta.measuredLineHeight * 1.5);
    // And its snippet is the start of that one paragraph, not a fragment of
    // some merged neighbour.
    expect(p1.textSnippet.startsWith('This first paragraph')).toBe(true);
  });

  it('keeps the two body paragraphs as separate blocks', () => {
    const p1 = geometry.blocks[1]!;
    const p2 = geometry.blocks[2]!;
    expect(p1.textSnippet.startsWith('This first paragraph')).toBe(true);
    expect(p2.textSnippet.startsWith('The second paragraph')).toBe(true);
    expect(p2.y).toBeGreaterThan(p1.y);
    expect(p1.pageIndex).toBe(0);
    expect(p2.pageIndex).toBe(0);
  });

  it('stitches per-page coordinates: page-2 heading documentY exceeds all page-1 content', () => {
    const page1Blocks = geometry.blocks.filter((b) => b.pageIndex === 0);
    const page2Heading = geometry.blocks.find((b) => b.pageIndex === 1)!;
    expect(page2Heading).toBeDefined();
    expect(page2Heading.textSnippet.startsWith('Stitched Second Page')).toBe(
      true,
    );
    const maxPage1Bottom = Math.max(...page1Blocks.map((b) => b.y + b.h));
    // Continuous-y means the page-2 heading lands below everything on page 1.
    expect(page2Heading.y).toBeGreaterThan(maxPage1Bottom);
  });
});
