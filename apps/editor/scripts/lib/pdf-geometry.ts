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
   *
   * `"box"` is a first-class CONTAINER block (pdoc-alu): the filled/stroked
   * background or border rectangle that a callout, code block, or table cell
   * draws AROUND its text. Like images these carry no glyphs (`getTextContent()`
   * never sees them) — their geometry comes from the operator-list's
   * `OPS.constructPath` fill/stroke ops mapped through the current CTM. A padded
   * container's visual box is TALLER than the glyph extent it wraps, and under
   * glyph-only extraction that excess height leaked into the FOLLOWING block's
   * whitespace gap (the Info/Success/Neutral callout, code block, and table-row
   * false-fails). Synthesizing the box as a real block, merged into document
   * order by y, makes the next block's gap measure from the box's BOTTOM — the
   * true visual bottom — so the leak disappears and a genuine box size/position
   * divergence surfaces as the box's OWN localized verdict (like images).
   */
  kind: 'text' | 'image' | 'box';
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

/** A positioned CONTAINER box, harvested from the operator-list graphics state
 *  (pdoc-alu): the filled/stroked background or border of a callout / code
 *  block / table cell. Same continuous-document-y space as text + image. */
type BoxRect = {
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
  /** Cumulative content height of all pages before this box's page, points. */
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

/**
 * Map a path-bbox `[minX, minY, maxX, maxY]` (path-local user space) through a
 * CTM and flip to top-left y, exactly as the image corner-mapping does. pdf.js
 * 5.x hands `OPS.constructPath` its bbox as the third arg — a length-4
 * array-LIKE (numeric-indexed; not necessarily `Array.isArray`), so we read
 * indices directly rather than gating on `Array.isArray`. Returns null on a
 * non-finite / degenerate result so one bad path can't poison the stream.
 */
function pathBBoxToRect(
  bbox: ArrayLike<number>,
  ctm: number[],
  pageHeight: number,
): { x: number; topY: number; w: number; h: number } | null {
  const minX = bbox[0],
    minY = bbox[1],
    maxX = bbox[2],
    maxY = bbox[3];
  if (
    minX === undefined ||
    minY === undefined ||
    maxX === undefined ||
    maxY === undefined
  ) {
    return null;
  }
  const a = ctm[0] ?? 0,
    b = ctm[1] ?? 0,
    c = ctm[2] ?? 0,
    d = ctm[3] ?? 0,
    e = ctm[4] ?? 0,
    f = ctm[5] ?? 0;
  const corners: Array<[number, number]> = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
  const xs = corners.map(([px, py]) => a * px + c * py + e);
  const ys = corners.map(([px, py]) => b * px + d * py + f);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const w = x1 - x0;
  const h = y1 - y0;
  const topY = pageHeight - y1;
  if (
    !Number.isFinite(x0) ||
    !Number.isFinite(topY) ||
    !Number.isFinite(w) ||
    !Number.isFinite(h)
  ) {
    return null;
  }
  return { x: x0, topY, w, h };
}

/**
 * Pull every filled / stroked CONTAINER box off a page's operator list
 * (pdoc-alu). Callout backgrounds, code-block backgrounds, and table cell /
 * border boxes are drawn as `OPS.constructPath` ops whose FIRST arg is the
 * paint op (`OPS.fill` / `eoFill` / `stroke` / `fillStroke` / …) and whose THIRD
 * arg is the path bounding box in user space. We map that bbox through the
 * current CTM (the same save/restore/transform stack the image walk uses) to
 * recover the box's top-left rect, then keep only the boxes that are plausibly
 * a CONTAINER — not page-chrome, hairlines, or glyph-fill noise:
 *
 *   1. min-size floor — `w` and `h` both ≥ MIN_BOX_PT drops underlines / rules
 *      / table gridlines (h≈1pt) and the thin left-edge accent stripes
 *      (w≈4pt) callouts draw; those are decoration, not containers.
 *   2. container-height floor — `h` ≥ MIN_BOX_H_PT (more than one text line)
 *      keeps only boxes tall enough to WRAP content. A single-line-tall fill is
 *      either a highlight or a glyph drawn as a path (chromium renders some
 *      monospace glyphs as fills — those show one-line heights and absurd /
 *      negative widths), never a padded container.
 *   3. on-page-x guard — the box's left and right edges must lie within the
 *      page (`x ≥ -EPS` and `x + w ≤ pageWidth + EPS`). The glyph-fill noise
 *      from (2) frequently lands far off-page (negative x, width > page); a real
 *      container sits inside the margins.
 *   4. full-page-background drop — a fill spanning ≥ FULL_PAGE_FRACTION of the
 *      page height is the page / body background, not a content container, and
 *      would otherwise swallow the whole stream.
 *
 * Heuristic choice (table gridlines vs container): we do NOT emit one block per
 * gridline. Per-cell fills (a table row renders 3–5 short same-`topY` fills) and
 * a fill+stroke pair at identical geometry (a bordered code block) are both
 * collapsed downstream by `mergeOverlappingBoxes` into ONE union box — the OUTER
 * container — so a table contributes a single row/box block, not a block per
 * cell or per border line. Nested callouts likewise merge inner→outer.
 */
async function extractBoxRects(
  page: {
    getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  },
  ops: {
    save: number;
    restore: number;
    transform: number;
    constructPath: number;
    rectangle: number;
    paintOps: Set<number>;
  },
  pageHeight: number,
  pageWidth: number,
  pageIndex: number,
  pagePriorHeight: number,
): Promise<BoxRect[]> {
  const opList = await page.getOperatorList();
  const rects: BoxRect[] = [];
  let ctm: number[] = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const EPS = 2; // on-page slack, points.

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    if (fn === ops.save) {
      stack.push(ctm.slice());
    } else if (fn === ops.restore) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    } else if (fn === ops.transform) {
      const a = opList.argsArray[i] as number[];
      if (Array.isArray(a) && a.length >= 6) ctm = matMul(ctm, a);
    } else if (fn === ops.constructPath) {
      // pdf.js 5.x: argsArray[i] = [paintOp, pathData, bbox]. We only want a
      // PAINTED path (fill/stroke), never a clip / endPath (paint op `endPath`).
      const a = opList.argsArray[i] as [number, unknown, ArrayLike<number>];
      if (!Array.isArray(a)) continue;
      const paintOp = a[0];
      const bbox = a[2];
      if (!ops.paintOps.has(paintOp) || bbox == null) continue;
      const r = pathBBoxToRect(bbox, ctm, pageHeight);
      if (r === null) continue;
      // (1) min-size floor + (2) container-height floor.
      if (r.w < MIN_BOX_PT || r.h < MIN_BOX_H_PT) continue;
      // (3) on-page-x guard — drop off-page glyph-fill noise.
      if (r.x < -EPS || r.x + r.w > pageWidth + EPS) continue;
      // (4) full-page background drop.
      if (r.h >= FULL_PAGE_FRACTION * pageHeight) continue;
      rects.push({
        x: r.x,
        topY: r.topY,
        w: r.w,
        h: r.h,
        pageIndex,
        pagePriorHeight,
      });
    }
  }
  return mergeOverlappingBoxes(rects);
}

// Per-side slack (points) for treating two boxes as part of the SAME container:
// they merge when the gap between them is under 2× this. Table cells / rows are
// drawn as boxes that TOUCH (a shared edge → 0 gap) or sit a hairline apart, so
// they coalesce into ONE table container instead of one block per cell/row (the
// "don't explode every gridline" rule); a fill+stroke pair at identical geometry
// likewise merges. It is kept SMALL (gap < 3pt) so two SEPARATE callouts — a
// real inter-callout margin (several pt) apart — stay distinct blocks.
const BOX_MERGE_SLACK_PT = 1.5;

/**
 * Collapse overlapping / adjacent container boxes on a page into their union
 * (pdoc-alu). This is the "prefer the OUTER container, not every gridline" rule:
 *   - a fill + a stroke at identical geometry (a bordered code block) → one box;
 *   - a column of per-cell / per-row table fills that touch or sit a hairline
 *     apart → ONE table (or row) container box;
 *   - a nested callout's inner box inside its outer box → the outer box.
 * Two boxes merge when their rectangles overlap OR are within BOX_MERGE_SLACK_PT
 * of touching in both axes; the survivor is their bounding union. Iterates to a
 * fixed point so a chain (cell→cell→cell) collapses fully. Boxes a real margin
 * apart (two separate callouts) stay distinct.
 */
function mergeOverlappingBoxes(rects: BoxRect[]): BoxRect[] {
  if (rects.length <= 1) return rects;
  let boxes = rects.map((r) => ({ ...r }));
  let merged = true;
  while (merged) {
    merged = false;
    const next: BoxRect[] = [];
    for (const b of boxes) {
      let absorbed = false;
      for (const acc of next) {
        if (boxesAdjacentOrOverlap(acc, b)) {
          const x0 = Math.min(acc.x, b.x);
          const y0 = Math.min(acc.topY, b.topY);
          const x1 = Math.max(acc.x + acc.w, b.x + b.w);
          const y1 = Math.max(acc.topY + acc.h, b.topY + b.h);
          acc.x = x0;
          acc.topY = y0;
          acc.w = x1 - x0;
          acc.h = y1 - y0;
          absorbed = true;
          merged = true;
          break;
        }
      }
      if (!absorbed) next.push({ ...b });
    }
    boxes = next;
  }
  return boxes;
}

/** Two top-left rects belong to the same container when, after expanding by
 *  BOX_MERGE_SLACK_PT, they intersect in BOTH axes — i.e. they overlap, touch,
 *  or sit a hairline apart (table rows / cells, fill+stroke pairs, nested
 *  callouts). A genuine inter-callout margin exceeds the slack, so distinct
 *  callouts do NOT merge. */
function boxesAdjacentOrOverlap(a: BoxRect, b: BoxRect): boolean {
  const s = BOX_MERGE_SLACK_PT;
  const ax1 = a.x + a.w + s,
    ay1 = a.topY + a.h + s;
  const bx1 = b.x + b.w + s,
    by1 = b.topY + b.h + s;
  return a.x - s < bx1 && b.x - s < ax1 && a.topY - s < by1 && b.topY - s < ay1;
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
// pdoc-alu: a container box must clear these floors to be kept (see
// extractBoxRects). MIN_BOX_PT drops hairline rules / table gridlines (h≈1pt)
// and thin accent stripes (w≈4pt). MIN_BOX_H_PT additionally requires the box
// to be TALLER than a single text line — a real padded container wraps content,
// while a one-line-tall fill is a highlight or a glyph drawn as a path (layout
// noise). 22pt ≈ comfortably over one ~12–18pt body line but well under any
// padded callout/code/table-row box (those run 26pt+ in the fixtures).
const MIN_BOX_PT = 8;
const MIN_BOX_H_PT = 22;
// A fill spanning at least this fraction of the page height is the page / body
// background (the editor + channels paint a full-content-area background that
// runs the whole text column — ~648pt of a 792pt page once the 72pt margins are
// removed, i.e. ~0.82). It is page chrome, not a content container, and would
// otherwise swallow the whole stream with a single block taller than every gap.
// The tallest REAL container in the fixtures (a multi-line code block) is ~110pt
// (~0.14 of the page), so a 0.55 cutoff drops the background with wide margin
// while keeping every genuine callout / code / table box.
const FULL_PAGE_FRACTION = 0.55;

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
  // pdoc-alu: the paint ops whose `OPS.constructPath` paths are CONTAINER boxes
  // (a filled or stroked rectangle). `endPath` (clip / no-paint) is excluded so
  // clipping rects never become blocks.
  const boxOps = {
    save: OPS.save!,
    restore: OPS.restore!,
    transform: OPS.transform!,
    constructPath: OPS.constructPath!,
    rectangle: OPS.rectangle!,
    paintOps: new Set<number>(
      [
        OPS.fill,
        OPS.eoFill,
        OPS.stroke,
        OPS.closeStroke,
        OPS.fillStroke,
        OPS.eoFillStroke,
        OPS.closeFillStroke,
      ].filter((v): v is number => typeof v === 'number'),
    ),
  };

  const runs: Run[] = [];
  const imageRects: ImageRect[] = [];
  const boxRects: BoxRect[] = [];
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

    // Container boxes (callout / code / table backgrounds + borders) carry no
    // glyphs either — harvest their filled/stroked rects from the SAME
    // operator-list walk (pdoc-alu), per-page merged to the outer container.
    const pageBoxes = await extractBoxRects(
      page,
      boxOps,
      pageHeight,
      viewport.width,
      p,
      priorHeight,
    );
    for (const r of pageBoxes) boxRects.push(r);

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

  // ─── apply CONTAINER-BOX blocks (pdoc-alu) ───────────────────────────────
  // A padded callout / code / table draws a background/border box that is
  // TALLER than the glyph run it wraps; under glyph-only extraction that excess
  // height leaked into the FOLLOWING block's whitespace gap (the gap was
  // measured from the inner text's bottom, far above the box bottom). The fix
  // has TWO halves, applied in order:
  //
  //   1. ABSORB the box bottom into the text it wraps. We extend the LAST text
  //      block the box overlaps so its bottom reaches the box bottom. This is
  //      what makes the leak fix SYMMETRIC and robust to the two sides
  //      segmenting text differently: the gap to the next block is then measured
  //      from each side's own box bottom regardless of which kind of block
  //      happens to be the predecessor. A box whose bottom does NOT extend past
  //      the text it wraps (a flush highlight) changes nothing.
  //   2. EMIT the box as a first-class `kind:"box"` block, interleaved by TOP-y.
  //      It carries the container's true position + size for box↔box parity
  //      (advisory; layout-match excludes it from font sizing and gates it like
  //      an image but looser). Sorting by TOP — not bottom — keeps the box from
  //      DISPLACING the text spacing chain: the next text block still measures
  //      its gap from the (now box-bottom-extended) text block, while the box
  //      block sits adjacent for diagnostics.
  //
  // Boxes that merely DUPLICATE a text block's extent (no material bottom past
  // the glyphs) are dropped — they would add a redundant block with no leak to
  // fix.
  const keptBoxRects = boxRects.filter((r) => !boxDuplicatesText(r, blocks));

  // (1) Absorb: extend the text block this box wraps so its bottom reaches the
  // box bottom. The owner is the BOTTOM-MOST text block the box covers — either
  // one whose top is INSIDE the box (the common callout/code case) or one that
  // sits immediately ABOVE the box with no text of its own inside it (a callout
  // box continued onto the next page, or a box whose text the segmenter merged
  // into the preceding block). We pick the text block with the largest `y` whose
  // top precedes the box bottom AND whose bottom is no further than one line
  // above the box top — i.e. it is the content this box belongs to, not an
  // unrelated paragraph far above.
  for (const r of keptBoxRects) {
    const boxTop = r.pagePriorHeight + r.topY;
    const boxBottom = boxTop + r.h;
    let target: PdfBlock | null = null;
    for (const b of blocks) {
      if (b.kind !== 'text') continue;
      const bBottom = b.y + b.h;
      const startsBeforeBoxEnds = b.y < boxBottom;
      const reachesBox = bBottom >= boxTop - measuredLineHeight;
      if (startsBeforeBoxEnds && reachesBox) {
        if (target === null || b.y > target.y) target = b;
      }
    }
    if (target !== null) {
      const targetBottom = target.y + target.h;
      if (boxBottom > targetBottom) target.h = boxBottom - target.y;
    }
  }

  // (2) Emit box blocks, interleaved by top-y.
  const boxBlocks: PdfBlock[] = keptBoxRects.map((r) => ({
    idx: 0,
    x: r.x,
    y: r.pagePriorHeight + r.topY,
    w: r.w,
    h: r.h,
    fontSize: 0, // boxes have no glyphs; excluded from body/font sizing.
    textSnippet: '',
    pageIndex: r.pageIndex,
    kind: 'box' as const,
  }));

  const merged = [...blocks, ...imageBlocks, ...boxBlocks].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    // Tie on top-y: image/box sit visually first (text wraps around / below).
    if (a.kind !== b.kind) {
      const rank = (k: PdfBlock['kind']) => (k === 'text' ? 1 : 0);
      return rank(a.kind) - rank(b.kind);
    }
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

/**
 * Does a captured container box merely DUPLICATE a text block's bounds rather
 * than wrap it with materially more height (pdoc-alu)? A box that is
 * co-extensive with a single text run (a highlight tight around the glyphs)
 * adds no bottom padding to "own", so synthesizing it as a block is pure noise.
 * We keep a box only when it MATERIALLY exceeds the glyph extent it overlaps:
 * its bottom must sit at least DUP_SLACK_PT below the bottom of every text block
 * it vertically contains, OR it must contain NO text block at all (a box around
 * an image / empty cell still represents real height). A box that wraps text
 * AND extends past it (the padded callout / code / table case — the leak) is
 * kept; a box flush with its text is dropped.
 */
const DUP_SLACK_PT = 6;

function boxDuplicatesText(box: BoxRect, textBlocks: PdfBlock[]): boolean {
  const boxTop = box.pagePriorHeight + box.topY;
  const boxBottom = boxTop + box.h;
  let containsText = false;
  let maxContainedTextBottom = -Infinity;
  for (const t of textBlocks) {
    if (t.kind !== 'text') continue;
    const tTop = t.y;
    const tBottom = t.y + t.h;
    // "Vertically contained": the text's top sits within the box's span (the
    // text is inside this container, not a neighbour above/below it).
    if (tTop >= boxTop - DUP_SLACK_PT && tTop <= boxBottom) {
      containsText = true;
      if (tBottom > maxContainedTextBottom) maxContainedTextBottom = tBottom;
    }
  }
  if (!containsText) return false; // box around an image / empty cell — keep.
  // Keep only if the box bottom is materially below the wrapped text's bottom
  // (real bottom padding to own); otherwise it just duplicates the text.
  return boxBottom <= maxContainedTextBottom + DUP_SLACK_PT;
}
