/**
 * pdf-geometry — turn a PDF into per-block geometry read straight from the
 * glyph stream (no rasterization). The keystone of the "universal-PDF funnel"
 * verifier (Goal pdoc-r9p / T1): every export channel is rendered to PDF, then
 * compared block-by-block against the editor using the geometry this module
 * extracts.
 *
 * Why geometry-from-glyphs, not DOM rects: the prior semantic-diff harvested
 * `getBoundingClientRect()` off preview surfaces, which collapses opaque
 * renderers (docx-preview, epub.js) to a single wrapper div. PDF text items
 * carry exact glyph coordinates in PDF user space — deterministic, channel-
 * agnostic, and immune to the wrapper-collapse failure mode.
 *
 * Bound rules (grill 2026-05-23, parent pdoc-r9p `design`):
 *   #2 Block = maximal run of text items whose inter-run VERTICAL gap is
 *      `< 0.6 × measuredLineHeight`; START A NEW BLOCK on a font-size jump
 *      `>= 2pt`. `measuredLineHeight` is self-tuned from the PDF (median
 *      run-to-run dy), never hardcoded, and recorded in `meta` so a
 *      mis-segmentation is debuggable. The "inter-run gap" is the WHITESPACE
 *      between consecutive lines — i.e. the run-to-run advance MINUS one
 *      measured line height. Wrapped lines inside one paragraph advance by
 *      exactly one line height (gap ≈ 0), so they stay together; a paragraph
 *      break adds ≥ 0.6 × lineHeight of extra whitespace, so it splits.
 *   #4 Continuous document-y: PDF y resets per page, so stitch into a single
 *      monotonic axis = (sum of prior pages' usable content heights) +
 *      (pageTopY − itemY). A block on page 3 must have a larger documentY than
 *      every block on pages 1–2.
 *
 * PDF user space origin is bottom-left; we convert to top-left per page using
 * the page viewport height.
 *
 * Pure + typed. The main entry is `extractPdfGeometry(input)`; it accepts a
 * filesystem path (string) or raw bytes (Buffer / Uint8Array).
 */
import { promises as fs } from 'node:fs';

/**
 * pdfjs-dist's Node build leans on a couple of browser globals. Node 22 ships
 * `Promise.withResolvers` natively but has no `DOMMatrix`; pdfjs only needs it
 * as a constructor it can stamp matrix fields onto for text-layer math, so a
 * minimal 6-field stand-in is sufficient for `getTextContent()`. We install it
 * once at module load, guarded so we never clobber a real implementation (e.g.
 * when this module is imported under happy-dom/jsdom).
 */
function ensurePdfjsGlobals(): void {
  const g = globalThis as unknown as {
    DOMMatrix?: unknown;
    Promise: PromiseConstructor & { withResolvers?: unknown };
  };
  if (typeof g.DOMMatrix === 'undefined') {
    class MinimalDOMMatrix {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      m11 = 1;
      m12 = 0;
      m21 = 0;
      m22 = 1;
      m41 = 0;
      m42 = 0;
      constructor(init?: number[] | string) {
        if (Array.isArray(init) && init.length >= 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init as [
            number,
            number,
            number,
            number,
            number,
            number,
          ];
          this.m11 = this.a;
          this.m12 = this.b;
          this.m21 = this.c;
          this.m22 = this.d;
          this.m41 = this.e;
          this.m42 = this.f;
        }
      }
    }
    g.DOMMatrix = MinimalDOMMatrix as unknown;
  }
}

// ─── public types ───────────────────────────────────────────────────────────

export type PdfBlock = {
  /** 0-based index in reading order across the whole document. */
  idx: number;
  /** Left edge in PDF user-space points (page-local x). */
  x: number;
  /** CONTINUOUS document-y (top-left origin), stitched across pages. */
  y: number;
  /** Width of the block's bounding box, points. */
  w: number;
  /** Height of the block's bounding box, points. */
  h: number;
  /** Dominant font size of the block, points. */
  fontSize: number;
  /** First ~40 characters of the block's text. */
  textSnippet: string;
  /** 0-based page the block starts on. */
  pageIndex: number;
  /**
   * Block kind. `"text"` is a glyph-run block (the default — every prior
   * block was implicitly this). `"image"` is a first-class IMAGE block whose
   * geometry comes from the PDF's image-XObject placement (pdoc-evn), NOT from
   * glyphs: it carries position + size but an EMPTY `textSnippet`. Making images
   * real blocks stops their box-height leaking into the whitespace gap of the
   * FOLLOWING block (the gap is now measured from the image's BOTTOM), and lets
   * the comparison pair image↔image for position/size parity.
   */
  kind: 'text' | 'image';
};

export type PdfGeometryMeta = {
  /** Number of pages in the source PDF. */
  pageCount: number;
  /** Self-tuned median run-to-run line height (points). */
  measuredLineHeight: number;
  /** The vertical-gap threshold that split blocks: 0.6 × measuredLineHeight. */
  groupingGapPt: number;
};

export type PdfGeometry = {
  blocks: PdfBlock[];
  meta: PdfGeometryMeta;
};

export type PdfGeometryInput = string | Buffer | Uint8Array;

// ─── internals ──────────────────────────────────────────────────────────────

/** A single positioned run (one pdfjs TextItem) on one page. */
type Run = {
  /** Page-local left, points. */
  x: number;
  /** Page-local TOP-left y (already flipped from PDF bottom-left), points. */
  topY: number;
  /** Width, points. */
  w: number;
  /** Glyph height, points. */
  h: number;
  /** Vertical font scale ≈ font size, points. */
  fontSize: number;
  /** Run text. */
  str: string;
  /** 0-based page index. */
  pageIndex: number;
  /** Cumulative content height of all pages before this run's page, points. */
  pagePriorHeight: number;
};

/** A positioned IMAGE placement, harvested from the operator-list graphics
 *  state (pdoc-evn). Same continuous-document-y space as text runs. */
type ImageRect = {
  /** Page-local left, points. */
  x: number;
  /** Page-local TOP-left y (flipped from PDF bottom-left), points. */
  topY: number;
  /** Width, points. */
  w: number;
  /** Height, points. */
  h: number;
  /** 0-based page index. */
  pageIndex: number;
  /** Cumulative content height of all pages before this image's page, points. */
  pagePriorHeight: number;
};

/** Compose two PDF 6-float affine matrices: result = m ∘ n (apply n then m). */
function matMul(m: number[], n: number[]): number[] {
  const m0 = m[0] ?? 0,
    m1 = m[1] ?? 0,
    m2 = m[2] ?? 0,
    m3 = m[3] ?? 0,
    m4 = m[4] ?? 0,
    m5 = m[5] ?? 0;
  const n0 = n[0] ?? 0,
    n1 = n[1] ?? 0,
    n2 = n[2] ?? 0,
    n3 = n[3] ?? 0,
    n4 = n[4] ?? 0,
    n5 = n[5] ?? 0;
  return [
    m0 * n0 + m2 * n1,
    m1 * n0 + m3 * n1,
    m0 * n2 + m2 * n3,
    m1 * n2 + m3 * n3,
    m0 * n4 + m2 * n5 + m4,
    m1 * n4 + m3 * n5 + m5,
  ];
}

/**
 * Pull every IMAGE placement off a page's operator list (pdoc-evn). Images
 * carry no glyphs, so `getTextContent()` never sees them — we instead walk the
 * graphics-state transform stack (`OPS.save` / `OPS.restore` / `OPS.transform`)
 * and, at each image-paint op, map the unit square [0,1]² through the CURRENT
 * transform to recover the placed rect's bounding box in PDF user space. The
 * unit-square corner mapping is robust to rotation/skew (pdfjs encodes a placed
 * image as a unit-square scaled+translated by the CTM). We flip to top-left y
 * exactly as text runs do (`topY = pageHeight − maxCornerY`).
 */
async function extractImageRects(
  page: {
    getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  },
  ops: { save: number; restore: number; transform: number; paintImageXObject: number; paintInlineImageXObject: number; paintImageMaskXObject: number },
  pageHeight: number,
  pageIndex: number,
  pagePriorHeight: number,
): Promise<ImageRect[]> {
  const opList = await page.getOperatorList();
  const rects: ImageRect[] = [];
  let ctm: number[] = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    if (fn === ops.save) {
      stack.push(ctm.slice());
    } else if (fn === ops.restore) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    } else if (fn === ops.transform) {
      const a = opList.argsArray[i] as number[];
      if (Array.isArray(a) && a.length >= 6) ctm = matMul(ctm, a);
    } else if (
      fn === ops.paintImageXObject ||
      fn === ops.paintInlineImageXObject ||
      fn === ops.paintImageMaskXObject
    ) {
      // Map the four corners of the unit square through the current transform.
      const a = ctm[0] ?? 0,
        b = ctm[1] ?? 0,
        c = ctm[2] ?? 0,
        d = ctm[3] ?? 0,
        e = ctm[4] ?? 0,
        f = ctm[5] ?? 0;
      const xs = [e, a + e, c + e, a + c + e];
      const ys = [f, b + f, d + f, b + d + f];
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      const w = x1 - x0;
      const h = y1 - y0;
      // PDF bottom-left → top-left: top edge is the page height minus the
      // highest corner. Mirror the text-run guard: drop a degenerate placement
      // (non-finite or zero-area) so one bad image can't poison the stream.
      // The MIN_IMAGE_PT floor additionally drops hairline / sub-visible
      // placements: a transparent 1×1 spacer PNG paints at < 1pt on one side
      // and may round just over zero on the other (e.g. with-images: editor
      // 0pt vs channel 0.7pt). Such a phantom is layout NOISE, not a content
      // image — keeping it would create an orphan-image and disrupt the gap of
      // the following block. A real content image is many points on a side.
      const topY = pageHeight - y1;
      if (
        !Number.isFinite(x0) ||
        !Number.isFinite(topY) ||
        !Number.isFinite(w) ||
        !Number.isFinite(h) ||
        w < MIN_IMAGE_PT ||
        h < MIN_IMAGE_PT
      ) {
        continue;
      }
      rects.push({ x: x0, topY, w, h, pageIndex, pagePriorHeight });
    }
  }
  return rects;
}

/** The 6-float affine matrix pdfjs attaches to each text item. */
function fontSizeFromTransform(transform: number[]): number {
  const c = transform[2] ?? 0;
  const d = transform[3] ?? 0;
  // Vertical scale = column-norm of the [c, d] basis vector. Robust to skew
  // and to the matrix encoding pdfjs emits for rotated text.
  const v = Math.hypot(c, d);
  return v > 0 ? v : Math.abs(d) || Math.abs(transform[0] ?? 0);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const FONT_JUMP_PT = 2; // bound rule #2: new block on font-size jump >= 2pt.
const GAP_FRACTION = 0.6; // bound rule #2: split when gap >= 0.6 × lineHeight.
const SNIPPET_LEN = 40;
// pdoc-evn: minimum per-side extent (points) for an image placement to count as
// a real content block. Below this it is a hairline / transparent-spacer
// artifact (a 1×1 PNG paints sub-point) — layout noise, not content.
const MIN_IMAGE_PT = 3;

/**
 * Compute the run-to-run vertical gaps (points) used both to self-tune the
 * line height and to drive block splitting. We only count gaps between runs
 * that move DOWN the page (positive dy) within the same page, since a negative
 * or near-zero dy means same-line continuation (multiple runs share a baseline).
 */
function collectVerticalGaps(runs: Run[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < runs.length; i++) {
    const prev = runs[i - 1]!;
    const cur = runs[i]!;
    if (cur.pageIndex !== prev.pageIndex) continue;
    const dy = cur.topY - prev.topY;
    if (dy > 0.1) gaps.push(dy);
  }
  return gaps;
}

/**
 * Self-tune the INTRA-block leading: the median run-to-run advance BETWEEN
 * consecutive lines of the same paragraph — never across a paragraph break.
 *
 * Why this matters (pdoc-sur root cause #3): the naive median over *all*
 * positive run-to-run gaps mixes the small wrapped-line advances (the true
 * leading) with the much larger paragraph-break advances. On a document of
 * many short blocks (headings, list items, callouts) the large breaks are a
 * sizeable fraction of all gaps, so the plain median lands well ABOVE one line
 * — we measured editor `measuredLineHeight` 42pt where ~28pt was correct. That
 * inflation poisons EVERY normalized delta downstream (every gap divided by a
 * too-big line height reads as too-few line-heights), so it must be excluded.
 *
 * Anchoring on the plain median is unsafe: when short blocks dominate, the
 * paragraph-break gaps are a large enough fraction that the median lands ABOVE
 * the wrapped-line cluster, and a window centred on it would exclude the very
 * cluster we want. The wrapped-line advances are instead the LOW, tight cluster
 * of the gap distribution (a paragraph break only ever ADDS whitespace, never
 * removes it). So we anchor on a low percentile — which falls inside that
 * cluster by construction — and keep the gaps within `WITHIN_PARA_FRACTION` of
 * it, then take their median. Paragraph breaks (≥ 0.6 line-heights of extra
 * leading, bound rule #2) sit above the window and are dropped. Falls back to
 * the plain median when too few intra-block gaps survive (e.g. a document with
 * no wrapped paragraphs at all), so single-line docs still tune.
 */
const WITHIN_PARA_FRACTION = 0.5; // a same-paragraph advance is within ±50% of the anchor.
const ANCHOR_PERCENTILE = 0.25; // low-quantile anchor lands inside the wrapped-line cluster.
const MIN_INTRA_GAPS = 3; // need a few clustered advances to trust the refined median.

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(p * (sorted.length - 1))),
  );
  return sorted[idx] ?? 0;
}

function intraBlockLineHeight(allGaps: number[]): number {
  const positive = allGaps.filter((g) => g > 0);
  const fallback = median(positive);
  if (fallback <= 0) return 0;
  // Anchor inside the low (wrapped-line) cluster, not on the inflated median.
  const anchor = percentile(positive, ANCHOR_PERCENTILE);
  if (anchor <= 0) return fallback;
  const lo = anchor * (1 - WITHIN_PARA_FRACTION);
  const hi = anchor * (1 + WITHIN_PARA_FRACTION);
  const intra = positive.filter((g) => g >= lo && g <= hi);
  if (intra.length < MIN_INTRA_GAPS) return fallback;
  return median(intra);
}

// ─── extraction ─────────────────────────────────────────────────────────────

export async function extractPdfGeometry(
  input: PdfGeometryInput,
): Promise<PdfGeometry> {
  ensurePdfjsGlobals();

  const bytes: Uint8Array =
    typeof input === 'string'
      ? new Uint8Array(await fs.readFile(input))
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);

  // Legacy build is the Node-targeted bundle (no browser worker, no top-level
  // DOM assumptions). Dynamic import keeps the heavy dep out of the module's
  // sync init path and lets the global shim land first.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // In Node there is no Worker; point workerSrc at the legacy worker bundle so
  // pdfjs's fake-worker path resolves it on the main thread instead of throwing
  // "No GlobalWorkerOptions.workerSrc specified".
  const { fileURLToPath } = await import('node:url');
  const workerUrl = await import.meta.resolve(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
  );
  (
    pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }
  ).GlobalWorkerOptions.workerSrc = fileURLToPath(workerUrl);

  const doc = await pdfjs.getDocument({
    data: bytes,
    // Geometry only needs the text-item transforms, not rendered glyphs, so we
    // keep system-font loading off to avoid network fetches for standard fonts.
    useSystemFonts: false,
  }).promise;

  // pdfjs OPS codes for the graphics-state + image ops we walk (pdoc-evn).
  const OPS = (pdfjs as unknown as { OPS: Record<string, number> }).OPS;
  const imageOps = {
    save: OPS.save!,
    restore: OPS.restore!,
    transform: OPS.transform!,
    paintImageXObject: OPS.paintImageXObject!,
    paintInlineImageXObject: OPS.paintInlineImageXObject!,
    paintImageMaskXObject: OPS.paintImageMaskXObject!,
  };

  const runs: Run[] = [];
  const imageRects: ImageRect[] = [];
  let priorHeight = 0;

  for (let p = 0; p < doc.numPages; p++) {
    const page = await doc.getPage(p + 1);
    const viewport = page.getViewport({ scale: 1 });
    const pageHeight = viewport.height;
    const content = await page.getTextContent();

    // Images carry no glyphs, so harvest their placements from the operator
    // list's graphics-state transform stack (pdoc-evn) — same page, same
    // continuous-document-y space as the text runs collected just below.
    const pageImages = await extractImageRects(
      page,
      imageOps,
      pageHeight,
      p,
      priorHeight,
    );
    for (const r of pageImages) imageRects.push(r);

    for (const item of content.items) {
      // Skip TextMarkedContent entries — they carry no transform/str.
      if (!('transform' in item) || !('str' in item)) continue;
      const ti = item as {
        str: string;
        transform: number[];
        width: number;
        height: number;
      };
      const str = ti.str;
      if (str.trim().length === 0) continue; // pure whitespace runs add noise.

      const transform = ti.transform;
      const baselineY = transform[5] ?? 0; // PDF bottom-left y of the baseline.
      const x = transform[4] ?? 0;
      const fontSize = fontSizeFromTransform(transform);
      const h = ti.height > 0 ? ti.height : fontSize;
      // PDF baseline → top-left: flip the page, then lift by the glyph ascent
      // (approximated by the glyph height) so topY is the visual top of the run.
      const topY = pageHeight - baselineY - h;

      // Guard against degenerate glyph transforms (pdoc-vxn FIX 2): a NaN/∞ in
      // any positional/size field would flow into measuredLineHeight and every
      // downstream normalized delta, where `classify(NaN)`/`classify(∞)` would
      // silently read as 'fail'. We drop the poisoned RUN here so a single bad
      // glyph can't corrupt the whole side's metric; a block that ends up with
      // NO finite runs surfaces as an explicit `degenerate` verdict in
      // layout-match (block-level guard), never a silent numeric fail.
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(topY) ||
        !Number.isFinite(h) ||
        !Number.isFinite(fontSize) ||
        !Number.isFinite(ti.width)
      ) {
        continue;
      }

      runs.push({
        x,
        topY,
        w: ti.width,
        h,
        fontSize,
        str,
        pageIndex: p,
        pagePriorHeight: priorHeight,
      });
    }

    priorHeight += pageHeight;
  }

  await doc.cleanup();

  // Self-tune the line height from the PDF's own run-to-run cadence — using
  // only the INTRA-block (same-paragraph) advances so paragraph-break gaps
  // don't inflate it (pdoc-sur root cause #3).
  const gaps = collectVerticalGaps(runs);
  const measuredLineHeight = intraBlockLineHeight(gaps) || 12;
  const groupingGapPt = GAP_FRACTION * measuredLineHeight;

  // ─── group runs → blocks ───────────────────────────────────────────────
  const blocks: PdfBlock[] = [];
  let cur: Run[] = [];

  const flush = () => {
    if (cur.length === 0) return;
    const first = cur[0]!;
    const minX = Math.min(...cur.map((r) => r.x));
    const maxX = Math.max(...cur.map((r) => r.x + r.w));
    const minTop = Math.min(...cur.map((r) => r.topY));
    const maxBottom = Math.max(...cur.map((r) => r.topY + r.h));
    // Dominant font size = the most common rounded size in the block.
    const sizeCounts = new Map<number, number>();
    for (const r of cur) {
      const k = Math.round(r.fontSize * 10) / 10;
      sizeCounts.set(k, (sizeCounts.get(k) ?? 0) + 1);
    }
    let fontSize = first.fontSize;
    let best = -1;
    for (const [size, count] of sizeCounts) {
      if (count > best) {
        best = count;
        fontSize = size;
      }
    }
    const text = cur
      .map((r) => r.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const documentY = first.pagePriorHeight + minTop;

    blocks.push({
      idx: blocks.length,
      x: minX,
      y: documentY,
      w: maxX - minX,
      h: maxBottom - minTop,
      fontSize,
      textSnippet: text.slice(0, SNIPPET_LEN),
      pageIndex: first.pageIndex,
      kind: 'text',
    });
    cur = [];
  };

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    if (cur.length === 0) {
      cur.push(run);
      continue;
    }
    const prev = cur[cur.length - 1]!;

    // Page break always starts a new block — continuous-y handles ordering.
    if (run.pageIndex !== prev.pageIndex) {
      flush();
      cur.push(run);
      continue;
    }

    const dy = run.topY - prev.topY;
    const fontJump = Math.abs(run.fontSize - prev.fontSize) >= FONT_JUMP_PT;
    // Inter-run gap = whitespace BETWEEN lines = advance minus one line height.
    // Wrapped lines advance by ~1 line height → gap ≈ 0 → stay together.
    // A paragraph break adds extra leading → gap ≥ groupingGapPt → split.
    // Same-line continuation (dy ≤ 0, runs sharing a baseline) never splits.
    const interRunGap = dy - measuredLineHeight;
    const verticalBreak = interRunGap >= groupingGapPt;

    if (fontJump || verticalBreak) {
      flush();
    }
    cur.push(run);
  }
  flush();

  // ─── merge IMAGE blocks into the document-order stream (pdoc-evn) ────────
  // Build an image PdfBlock per harvested rect (continuous-document-y, empty
  // text), then interleave with the text blocks by document-y. Merging by
  // y-position — rather than appending — means the whitespace gap to the block
  // FOLLOWING an image is now measured from the image's BOTTOM, so an image no
  // longer leaks its height into its successor's gap. Ties (an image whose top
  // equals a text block's top) break image-first, the visual reading order.
  const imageBlocks: PdfBlock[] = imageRects.map((r) => ({
    idx: 0, // re-indexed below after the merge sorts the full stream.
    x: r.x,
    y: r.pagePriorHeight + r.topY,
    w: r.w,
    h: r.h,
    fontSize: 0, // images have no glyphs; size is irrelevant for classification.
    textSnippet: '',
    pageIndex: r.pageIndex,
    kind: 'image',
  }));

  const merged = [...blocks, ...imageBlocks].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    // Tie on top-y: the image sits visually first (text wraps around / below).
    if (a.kind !== b.kind) return a.kind === 'image' ? -1 : 1;
    return 0;
  });
  merged.forEach((b, i) => {
    b.idx = i;
  });

  return {
    blocks: merged,
    meta: {
      pageCount: doc.numPages,
      measuredLineHeight,
      groupingGapPt,
    },
  };
}
