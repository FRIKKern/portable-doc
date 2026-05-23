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

  it('every text block carries kind:"text"', () => {
    for (const b of geometry.blocks) expect(b.kind).toBe('text');
  });
});

/**
 * pdoc-evn — images become first-class blocks. We render a known fixture with
 * an IMAGE sandwiched between two paragraphs and prove (1) the image is
 * extracted as its OWN block with real geometry from the PDF's image-XObject
 * placement (it has zero glyphs, so glyph-only extraction missed it entirely),
 * and (2) the block AFTER the image measures its whitespace gap from the IMAGE's
 * bottom — so the image height no longer leaks into the following block's gap.
 */
describe('extractPdfGeometry — image blocks (pdoc-evn)', () => {
  // A real 1×1 PNG; rendered at a known box size so its placed rect is large.
  const PNG_1x1 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const IMG_H_PX = 90; // declared image box height, px → ~67.5pt placed.
  const BODY_PT = 14;

  const IMAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { size: 612px 792px; margin: 48px; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Georgia, "Times New Roman", serif; color: #000; }
  p { font-size: ${BODY_PT}px; line-height: 1.5; margin: 0 0 14px 0; }
  img { display: block; width: 200px; height: ${IMG_H_PX}px; margin: 0 0 14px 0; }
</style></head><body>
  <p>This paragraph sits above the image and is long enough to wrap across a
     couple of lines so the line-height self-tunes from a real run cadence.</p>
  <img src="${PNG_1x1}">
  <p>This paragraph sits directly below the image. Its whitespace gap must be
     measured from the IMAGE bottom, not from the paragraph above the image.</p>
</body></html>`;

  let imageGeom: PdfGeometry;

  beforeAll(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(IMAGE_HTML, { waitUntil: 'networkidle' });
    const pdfBuffer = await page.pdf({
      width: '612px',
      height: '792px',
      printBackground: true,
      margin: { top: '48px', bottom: '48px', left: '48px', right: '48px' },
    });
    await page.close();
    await browser.close();
    imageGeom = await extractPdfGeometry(new Uint8Array(pdfBuffer));
  }, 60_000);

  it('extracts the image as a block with kind:"image", empty text, and a real size', () => {
    const images = imageGeom.blocks.filter((b) => b.kind === 'image');
    expect(images.length).toBe(1);
    const img = images[0]!;
    expect(img.textSnippet).toBe('');
    // 200×90px at the 0.75 px→pt factor ≈ 150×67.5pt; assert a real, non-trivial
    // box (not a stray hairline) with the expected wide-ish aspect.
    expect(img.w).toBeGreaterThan(100);
    expect(img.h).toBeGreaterThan(40);
  });

  it('orders the image between the two paragraphs by document-y', () => {
    const above = imageGeom.blocks.find((b) =>
      b.textSnippet.startsWith('This paragraph sits above'),
    )!;
    const img = imageGeom.blocks.find((b) => b.kind === 'image')!;
    const below = imageGeom.blocks.find((b) =>
      b.textSnippet.startsWith('This paragraph sits directly below'),
    )!;
    expect(above).toBeDefined();
    expect(below).toBeDefined();
    expect(img.y).toBeGreaterThan(above.y);
    expect(below.y).toBeGreaterThan(img.y);
  });

  it('the block AFTER the image measures its gap from the IMAGE bottom, not from the paragraph above it', () => {
    const above = imageGeom.blocks.find((b) =>
      b.textSnippet.startsWith('This paragraph sits above'),
    )!;
    const img = imageGeom.blocks.find((b) => b.kind === 'image')!;
    const below = imageGeom.blocks.find((b) =>
      b.textSnippet.startsWith('This paragraph sits directly below'),
    )!;
    // Gap from the image bottom to the next paragraph is a SMALL whitespace
    // margin (one CSS margin ≈ a fraction of a line height).
    const gapFromImage = below.y - (img.y + img.h);
    // Gap if we (wrongly) measured from the paragraph ABOVE the image: it would
    // include the entire image height — the old leak. The fix makes the real gap
    // FAR smaller than that phantom gap.
    const phantomGap = below.y - (above.y + above.h);
    expect(gapFromImage).toBeLessThan(phantomGap - img.h * 0.5);
    // And the real gap is a sane sub-line-height-to-few-line-heights margin,
    // never the multi-line phantom the leak produced.
    expect(gapFromImage).toBeLessThan(imageGeom.meta.measuredLineHeight * 3);
    expect(gapFromImage).toBeGreaterThan(0);
  });
});

/**
 * pdoc-alu — padded CONTAINER boxes (callout / code / table backgrounds) become
 * first-class `kind:"box"` blocks. We render a fixture with a PADDED box (a div
 * with a background + generous vertical padding, like a callout) wrapping a
 * single short line, followed by a paragraph. We prove (1) the box is captured
 * as its OWN block with real geometry from the operator-list fill — it has zero
 * glyphs, so glyph-only extraction never saw the background — and (2) the block
 * AFTER the callout measures its whitespace gap from the BOX's bottom (its true
 * visual bottom), not from the inner text's bottom: under the old glyph-only
 * extraction the box's bottom padding leaked into the following block's gap.
 */
describe('extractPdfGeometry — container-box blocks (pdoc-alu)', () => {
  const BODY_PT = 14;
  const PAD_PX = 40; // generous vertical padding → box bottom well below glyphs.

  // A callout = a padded, background-filled div around ONE short line. The
  // bottom padding makes the box materially TALLER than the glyph extent it
  // wraps — exactly the leak this captures. A trailing paragraph follows.
  const BOX_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { size: 612px 792px; margin: 48px; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Georgia, "Times New Roman", serif; color: #000; }
  p { font-size: ${BODY_PT}px; line-height: 1.5; margin: 0 0 14px 0; }
  .callout {
    font-size: ${BODY_PT}px; line-height: 1.5;
    background: #eef; border: 1px solid #99c;
    padding: ${PAD_PX}px 16px; margin: 0 0 14px 0;
  }
</style></head><body>
  <p>This paragraph sits above the callout and is intentionally long so that it
     wraps across several visual lines, giving the segmentation engine a real
     run-to-run cadence to self-tune the measured line height from before it
     ever reaches the padded container that follows it on the page.</p>
  <div class="callout">Single short callout line with lots of padding above and
     below it so the background box is materially taller than this one line.</div>
  <p>This paragraph sits directly below the callout and is also written long
     enough to wrap over several lines. Its whitespace gap must be measured from
     the callout BOX bottom, not from the callout's inner text bottom, which is
     the leak this container-box capture exists to remove from the verifier.</p>
</body></html>`;

  let boxGeom: PdfGeometry;

  beforeAll(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(BOX_HTML, { waitUntil: 'networkidle' });
    const pdfBuffer = await page.pdf({
      width: '612px',
      height: '792px',
      printBackground: true,
      margin: { top: '48px', bottom: '48px', left: '48px', right: '48px' },
    });
    await page.close();
    await browser.close();
    boxGeom = await extractPdfGeometry(new Uint8Array(pdfBuffer));
  }, 60_000);

  it('captures the padded callout background as a kind:"box" block with empty text and a real size', () => {
    const boxes = boxGeom.blocks.filter((b) => b.kind === 'box');
    expect(boxes.length).toBeGreaterThanOrEqual(1);
    const box = boxes[0]!;
    expect(box.textSnippet).toBe('');
    expect(box.fontSize).toBe(0);
    // A real container: wide (the column) and materially taller than one line
    // (the two padding bands + the glyph line).
    expect(box.w).toBeGreaterThan(100);
    expect(box.h).toBeGreaterThan(boxGeom.meta.measuredLineHeight * 2);
  });

  it('the block AFTER the callout measures its gap from the BOX bottom, not the callout text bottom', () => {
    const above = boxGeom.blocks.find((b) =>
      b.textSnippet.startsWith('This paragraph sits above'),
    )!;
    const below = boxGeom.blocks.find((b) =>
      b.textSnippet.startsWith('This paragraph sits directly below'),
    )!;
    const box = boxGeom.blocks.find((b) => b.kind === 'box')!;
    const calloutText = boxGeom.blocks.find((b) =>
      b.textSnippet.startsWith('Single short callout line'),
    )!;
    expect(above).toBeDefined();
    expect(below).toBeDefined();
    expect(box).toBeDefined();

    // The callout's box bottom sits BELOW its inner text bottom (the bottom
    // padding) — that is the height that used to leak. The leak fix absorbs the
    // box bottom into the wrapped text block, so the wrapped text now reaches
    // (at least) the box bottom and the following paragraph measures from there.
    const boxBottom = box.y + box.h;
    expect(boxBottom).toBeGreaterThan(calloutText.y); // box wraps the text
    // The wrapped callout text block now extends to the box bottom (the fix).
    expect(calloutText.y + calloutText.h).toBeGreaterThanOrEqual(
      boxBottom - 2,
    );

    // The gap below the callout, measured from the callout block bottom (= box
    // bottom), is a SMALL CSS margin — a fraction of a line height, NOT the
    // multi-line phantom that the leaked bottom padding would have produced.
    const gapAfterCallout = below.y - (calloutText.y + calloutText.h);
    expect(gapAfterCallout).toBeGreaterThan(0);
    expect(gapAfterCallout).toBeLessThan(boxGeom.meta.measuredLineHeight * 2);

    // Sanity: had we (wrongly) measured from the callout's GLYPH bottom before
    // absorption, the gap would have included the whole bottom padding band —
    // far larger than the real margin we now measure.
    const phantomGap = below.y - calloutText.y - boxGeom.meta.measuredLineHeight;
    expect(gapAfterCallout).toBeLessThan(phantomGap);
  });
});
