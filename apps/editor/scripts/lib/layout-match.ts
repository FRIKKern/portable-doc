/**
 * layout-match — the comparison engine of the universal-PDF funnel verifier
 * (Goal pdoc-r9p / T3). It turns two streams of per-block PDF geometry (the
 * editor canvas and one export channel, both from `extractPdfGeometry`) into
 * agent-actionable per-block VERDICTS. This is the part that replaces the
 * broken `semantic-diff` prototype with something whose PASS means parity and
 * whose FAIL localizes the offending block.
 *
 * Two ideas carry the whole module:
 *
 * 1. Pair CONTAINERS, not items (T2 finding #1).
 *    `extractPdfGeometry` already groups each list / table / callout into ONE
 *    container block (the inter-run gap rule keeps wrapped lines together), so
 *    in the common case the two block streams line up 1:1 by document order.
 *    We only reach for sequence-alignment to absorb a genuine insert/delete,
 *    so an extra/missing block yields a LOCALIZED `orphan` verdict instead of
 *    cascading every downstream row out of alignment.
 *
 * 2. The metric is RELATIVE and LINE-HEIGHT-NORMALIZED (refines bound #5 + #8,
 *    forced by T2 finding #2).
 *    The editor canvas renders body text at ~18px while the HTML export renders
 *    11pt, so RAW absolute-pt gaps accumulate badly down the page (T2 measured
 *    187pt of drift that was pure ZOOM, not a real layout defect). So we never
 *    gate on absolute-y. For each paired block i we measure the gap to the
 *    PREVIOUS block on each side and divide by THAT side's measured line height:
 *
 *        gapNormChannel = (y_i − y_{i−1})_channel / lineHeightChannel
 *        gapNormEditor  = (y_i − y_{i−1})_editor  / lineHeightEditor
 *        deltaLH        = |gapNormChannel − gapNormEditor|     (line-heights)
 *
 *    A uniform display-vs-print SCALE difference cancels in the ratio → deltaLH
 *    ≈ 0 (correct: zoom is not a defect). A genuine vertical-RHYTHM mismatch
 *    (an extra blank line, a collapsed paragraph gap) still shows. Absolute-pt
 *    drift is kept as a non-gating diagnostic field (`dyPtAbs`) only.
 *
 * Threshold bands (bound #8, expressed in line-heights):
 *    pass  deltaLH < 0.5
 *    warn  0.5 ≤ deltaLH ≤ 1.0
 *    fail  deltaLH > 1.0
 * A per-channel seam (`toleranceForChannel`) lets DOCX widen to 1.5 in T4; for
 * this task only the html/editor tolerance matters.
 *
 * Pure + typed. No I/O — `semantic-diff.ts` owns rendering and persistence.
 */
import type { PdfBlock, PdfGeometry } from './pdf-geometry.ts';

// ─── public types ────────────────────────────────────────────────────────────

/** The export channels this engine compares the editor against. The metric is
 *  channel-agnostic; the only channel-specific knob is the tolerance band. */
export type Channel = 'html' | 'docx' | 'epub' | 'markdown' | 'pdf';

/** Per-block outcome, the agent-facing unit (bound #9). `degenerate` is an
 *  EXPLICIT diagnostic for a block whose geometry is non-finite (NaN/∞ y / h /
 *  fontSize) — a gating failure that names the breakage rather than letting
 *  `classify(NaN)` collapse it to a silent `fail` (pdoc-vxn FIX 2). */
export type Verdict = 'pass' | 'warn' | 'fail' | 'orphan' | 'no-text' | 'degenerate';

/** Where this verdict sits in the gate hierarchy (bound #7). `geometry` rows
 *  hard-gate CI; `reflow-sanity` (DOCX, T4) and `structural` are looser. */
export type GateLevel = 'geometry' | 'reflow-sanity' | 'structural';

/** Threshold band edges in line-height units (bound #8). */
export type Thresholds = {
  /** deltaLH below this is a pass. */
  pass: number;
  /** deltaLH above this is a fail; in between is a warn. */
  fail: number;
};

/** One verdict record per paired (or orphaned) block — what an agent reads to
 *  know exactly which block drifted and by how much. */
export type VerdictRecord = {
  /** Stable id: prefers the channel block's source id when present, else a
   *  synthetic `<channel>-block-<idx>`. */
  blockId: string;
  channel: Channel;
  /** PRIMARY metric: |normalized WHITESPACE-gap delta|, in line-heights — the
   *  true inter-block spacing rhythm (top of this block minus BOTTOM of the
   *  previous block, each side normalized by its own line height). null for
   *  orphans (no pair to measure against). This is what the verdict gates on. */
  deltaLH: number | null;
  /** ADVISORY ONLY — non-gating (pdoc-vxn FIX 1). |this block's own height vs
   *  its paired editor block's height|, each normalized by THAT side's own
   *  self-tuned line height. This number is UNVALIDATED as a parity signal: the
   *  two sides' `measuredLineHeight` diverge in practice (welcome: editor ~33pt
   *  vs channel ~21pt, the legitimate display-vs-print scale), so a faithful
   *  block can show a large `heightDeltaLH` (welcome body block: 6.71LH) purely
   *  from that scale split — a FALSE RED — and the symmetric case can mask a
   *  real divergence as a FALSE GREEN. Until height parity is normalized against
   *  a shared reference it is reported for debuggability but NEVER gates the
   *  verdict. The scale-invariant whitespace-gap `deltaLH` is the sole gate.
   *  null for orphans. */
  heightDeltaLH: number | null;
  /** DIAGNOSTIC ONLY (non-gating): absolute whitespace-gap delta in points.
   *  Carries the raw zoom-inflated drift T2 saw, kept for debuggability. */
  dyPtAbs: number | null;
  /** The pass/fail band edges applied (channel-specific). */
  threshold: Thresholds;
  verdict: Verdict;
  /** Coarse block kind inferred from font-size / snippet (heading vs body). */
  blockType: string;
  /** First ~40 chars of the block's text — names the block in human reports. */
  textSnippet: string;
  /** Human sentence an agent can paste into a PR comment. */
  reason: string;
  gateLevel: GateLevel;
};

// ─── pairing ──────────────────────────────────────────────────────────────────

/** A matched pair, or an orphan on exactly one side. */
export type Pair = {
  editor: PdfBlock | null;
  channel: PdfBlock | null;
};

/**
 * Coarse alignment key for sequence-alignment. We don't have AST node ids in
 * the PDF stream, so we approximate "same kind of block" from geometry.
 *
 * It MUST be scale-invariant: the editor canvas (~18px body) and an export
 * channel (11pt body) render the same logical block at different absolute
 * font sizes, so keying on absolute size would make NO key match across sides
 * (T2 finding #2). Instead we key on the block's size RELATIVE to its own
 * side's BODY size — a heading is "clearly larger than this side's body" —
 * which survives a uniform zoom.
 *
 * We base the ratio on the body size (the most-common font size on that side),
 * NOT the median: a document heavy in headings can drag the median up so far
 * that real headings stop reading as "larger than typical", and a side that
 * gained a stray small block can drag the median down. The body MODE is
 * immune to both — it tracks the dominant running-text size, which is the
 * stable reference a heading is defined relative to.
 */
function alignKey(b: PdfBlock, bodySize: number): string {
  // Image blocks (pdoc-evn) carry no glyphs — font-size buckets are meaningless
  // and they have no text for the Jaccard pairing. They get their OWN bucket so
  // the aligner pairs image↔image by type + order and never substitutes an
  // image for a text block (or vice versa).
  if (b.kind === 'image') return 'img';
  // Container-box blocks (pdoc-alu) likewise carry no glyphs — own bucket so the
  // aligner pairs box↔box by kind + order, never box-for-text or box-for-image.
  if (b.kind === 'box') return 'box';
  const ratio = bodySize > 0 ? b.fontSize / bodySize : 1;
  // Three buckets, deliberately coarse: heading (clearly larger than body),
  // small (clearly smaller — captions, fine print), body (everything else).
  if (ratio >= 1.15) return 'h';
  if (ratio <= 0.85) return 's';
  return 'b';
}

/** The dominant (most-common, rounded) font size on a side — the body text
 *  size. Headings/captions are the minority, so the mode lands on body. */
function bodyFontSize(blocks: PdfBlock[]): number {
  // Image (pdoc-evn) and box (pdoc-alu) blocks have fontSize 0 — exclude them so
  // they don't drag the body mode toward zero and mis-bucket real text as
  // 'heading'.
  const textBlocks = blocks.filter((b) => b.kind === 'text');
  if (textBlocks.length === 0) return 12;
  const counts = new Map<number, number>();
  for (const b of textBlocks) {
    const k = Math.round(b.fontSize);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = textBlocks[0]!.fontSize;
  let bestCount = -1;
  for (const [size, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = size;
    }
  }
  return best;
}

function medianFontSize(blocks: PdfBlock[]): number {
  // Exclude image (pdoc-evn) and box (pdoc-alu) blocks (fontSize 0) so the
  // median tracks real text only.
  const textBlocks = blocks.filter((b) => b.kind === 'text');
  if (textBlocks.length === 0) return 12;
  const sorted = textBlocks.map((b) => b.fontSize).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// ─── text-content similarity (pdoc-sur root cause #2) ──────────────────────────

/**
 * Normalize a block's text into comparable tokens. The two sides render the
 * SAME document, so their block TEXT matches even when their block SETS don't —
 * but only after we strip the rendering noise:
 *   - lowercase + collapse whitespace (font/scale differences shift wrapping);
 *   - strip the pdf.js ligature artifact where "fi"/"fl"/"ff" glyphs come back
 *     split by a stray space ("fi xture" → "fixture", "con fl ict" → "conflict").
 * Returns the cleaned string; `tokenSet` derives the token set from it.
 */
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    // Rejoin ligature-split fragments: a space sitting immediately after an
    // f-ligature prefix between two letters is a pdf.js extraction artifact.
    .replace(/\b(f[ifl]?)\s+(?=[a-z])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token SET (dedup) of a normalized snippet — order-free, so a re-wrapped or
 *  re-segmented line still overlaps its counterpart heavily. */
function tokenSet(s: string): Set<string> {
  const norm = normalizeText(s);
  if (norm.length === 0) return new Set();
  return new Set(norm.split(' ').filter((t) => t.length > 0));
}

/**
 * Text-content similarity in [0, 1]: token-set Jaccard, the share of distinct
 * tokens the two snippets agree on. Robust to the re-wrapping and incidental
 * re-segmentation that drove orphan inflation — two blocks covering the same
 * prose overlap heavily even when one side split it differently. Two empty
 * snippets are treated as similarity 0 (no positive evidence to pair on; the
 * no-text rule and order tiebreak handle genuinely text-less blocks).
 */
function textSimilarity(a: string, b: string): number {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union > 0 ? inter / union : 0;
}

/** A text match is only trusted as a pairing above this Jaccard floor; below
 *  it the blocks are too dissimilar to be "the same content" and we let the
 *  order/tag tiebreak (or an orphan) decide instead. */
const TEXT_MATCH_FLOOR = 0.34;

/**
 * Score a candidate diagonal pairing of editor block `e` with channel block
 * `c`. Both sides render the SAME document, so the dominant signal is TEXT
 * CONTENT (pdoc-sur root cause #2): incidental segmentation differences between
 * the editor and the channel left high orphan counts when we keyed only on
 * geometry, even though the prose plainly matched. We therefore drive pairing
 * by token-set similarity, and fall back to the coarse tag/order key only to
 * break ties when text gives no signal (both snippets empty, or below the
 * trust floor).
 *
 * Returns a score in roughly [0, 1.1]: the text similarity when it clears the
 * floor (a strong, content-confirmed pair), a small TAG_BONUS when text is
 * silent but the geometric kind agrees (a weak, order-confirmed pair), or 0
 * when neither signal supports the pairing (leave it to become an orphan).
 */
const TAG_BONUS = 0.2; // weak pull toward same-kind blocks when text is silent.

const IMAGE_PAIR_SCORE = 0.9; // image↔image is a strong, content-free pairing.
const BOX_PAIR_SCORE = 0.9; // box↔box (pdoc-alu) is a strong, content-free pairing.

function pairScore(e: PdfBlock, c: PdfBlock, ekKey: string, ckKey: string): number {
  // Image blocks (pdoc-evn) have no text — pair them image↔image by kind +
  // order. A high fixed score keeps two images in document order paired (the
  // aligner is order-preserving), while a kind MISMATCH (image vs text) scores
  // 0 so an image is never force-substituted for a paragraph or vice versa.
  if (e.kind === 'image' || c.kind === 'image') {
    return e.kind === 'image' && c.kind === 'image' ? IMAGE_PAIR_SCORE : 0;
  }
  // Container-box blocks (pdoc-alu) also carry no text — pair box↔box by kind +
  // order, the same content-free pairing as images. A kind mismatch (box vs
  // text/image) scores 0 so a box never substitutes for another kind.
  if (e.kind === 'box' || c.kind === 'box') {
    return e.kind === 'box' && c.kind === 'box' ? BOX_PAIR_SCORE : 0;
  }
  const sim = textSimilarity(e.textSnippet, c.textSnippet);
  if (sim >= TEXT_MATCH_FLOOR) {
    // Content-confirmed. Nudge same-kind matches above near-identical text so a
    // heading and a paragraph that happen to share words don't outrank the real
    // same-kind pairing — but text always dominates.
    return sim + (ekKey === ckKey ? 0.1 : 0);
  }
  // Text too weak to confirm: only same-kind blocks earn a faint pull, so a
  // genuinely inserted/deleted block (no text overlap, possibly off-kind)
  // stays an orphan rather than being force-paired.
  return ekKey === ckKey ? TAG_BONUS : 0;
}

/**
 * Pair editor blocks against channel blocks by TEXT CONTENT, order-preserving.
 *
 * `extractPdfGeometry` collapses each list / table / callout into ONE block, so
 * the streams often line up by order — but complex fixtures segment into
 * different block SETS on the two sides, and the old geometry-only alignment
 * dropped that surplus as orphans even when the prose matched (pdoc-sur root
 * cause #2). We instead run a max-score monotonic (Needleman–Wunsch) alignment
 * whose diagonal score is `pairScore` — text-similarity-first, tag/order only
 * to break ties. A gap (no pairing) costs `GAP_PENALTY`, so the alignment only
 * emits an orphan when leaving a block UNPAIRED beats every available pairing —
 * i.e. for a genuine structural insert/delete, not an incidental re-segmentation.
 * Order is preserved (no crossing), so a localized insert stays localized.
 */
const GAP_PENALTY = 0.05; // cost of leaving a block unpaired; below it, pairing wins.

export function pairBlocks(
  editorBlocks: PdfBlock[],
  channelBlocks: PdfBlock[],
): Pair[] {
  const m = editorBlocks.length;
  const n = channelBlocks.length;
  if (m === 0 || n === 0) {
    return [
      ...editorBlocks.map((e) => ({ editor: e, channel: null })),
      ...channelBlocks.map((c) => ({ editor: null, channel: c })),
    ];
  }

  // Coarse geometric keys, scale-invariant per side (the tie-break signal).
  const bodyEditor = bodyFontSize(editorBlocks);
  const bodyChannel = bodyFontSize(channelBlocks);
  const ek = editorBlocks.map((b) => alignKey(b, bodyEditor));
  const ck = channelBlocks.map((b) => alignKey(b, bodyChannel));

  // dp[i][j] = MAX total score aligning editor[0..i) with channel[0..j).
  // A pairing adds pairScore; a gap (orphan on either side) subtracts the gap
  // penalty. Maximizing total score pairs everything the content supports and
  // only leaves genuine inserts/deletes unpaired.
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) dp[i]![0] = -i * GAP_PENALTY;
  for (let j = 1; j <= n; j++) dp[0]![j] = -j * GAP_PENALTY;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const score = pairScore(
        editorBlocks[i - 1]!,
        channelBlocks[j - 1]!,
        ek[i - 1]!,
        ck[j - 1]!,
      );
      dp[i]![j] = Math.max(
        dp[i - 1]![j - 1]! + score, // pair editor i with channel j
        dp[i - 1]![j]! - GAP_PENALTY, // editor i is an orphan (delete)
        dp[i]![j - 1]! - GAP_PENALTY, // channel j is an orphan (insert)
      );
    }
  }

  // Traceback from (m, n), emitting in reverse, then reverse to document order.
  const out: Pair[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const score = pairScore(
        editorBlocks[i - 1]!,
        channelBlocks[j - 1]!,
        ek[i - 1]!,
        ck[j - 1]!,
      );
      // Take the diagonal pairing whenever it lies on the optimal path AND it
      // carried any positive support (score > 0). A zero-score "pairing" is no
      // better than two orphans, so we reserve it for last and prefer the
      // explicit orphan moves below — a genuine insert/delete stays localized.
      if (score > 0 && dp[i]![j] === dp[i - 1]![j - 1]! + score) {
        out.push({ editor: editorBlocks[i - 1]!, channel: channelBlocks[j - 1]! });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && dp[i]![j] === dp[i - 1]![j]! - GAP_PENALTY) {
      out.push({ editor: editorBlocks[i - 1]!, channel: null });
      i--;
      continue;
    }
    if (j > 0 && dp[i]![j] === dp[i]![j - 1]! - GAP_PENALTY) {
      out.push({ editor: null, channel: channelBlocks[j - 1]! });
      j--;
      continue;
    }
    // Fallback: a zero-score diagonal is the only move left on the path. Never
    // CROSS KINDS here (pdoc-alu / pdoc-evn) — a box/image must not be force-
    // paired with a text block (it would mis-fire the no-text rule and pollute
    // parity). When the two remaining blocks are different kinds, emit them as
    // two orphans (channel first so reading order is preserved on reverse); only
    // a same-kind residue takes the zero-score diagonal.
    const eB = i > 0 ? editorBlocks[i - 1]! : null;
    const cB = j > 0 ? channelBlocks[j - 1]! : null;
    if (i > 0 && j > 0 && eB!.kind !== cB!.kind) {
      out.push({ editor: null, channel: cB! });
      j--;
      continue;
    }
    out.push({ editor: eB, channel: cB });
    if (i > 0) i--;
    if (j > 0) j--;
  }
  out.reverse();
  return out;
}

// ─── metric + verdicts ─────────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS: Thresholds = { pass: 0.5, fail: 1.0 };
const DOCX_THRESHOLDS: Thresholds = { pass: 0.5, fail: 1.5 };

/**
 * Per-channel tolerance seam (bound #8). HTML/editor use the strict band;
 * DOCX (T4) reflows enough that it earns a looser fail edge at 1.5
 * line-heights. The seam exists now so T4 needs no metric change.
 */
export function toleranceForChannel(channel: Channel): Thresholds {
  return channel === 'docx' ? DOCX_THRESHOLDS : DEFAULT_THRESHOLDS;
}

/** geometry-tier channels hard-gate CI; DOCX runs at reflow-sanity (T4). */
export function gateLevelForChannel(channel: Channel): GateLevel {
  if (channel === 'docx') return 'reflow-sanity';
  if (channel === 'epub' || channel === 'markdown') return 'structural';
  return 'geometry';
}

function classify(deltaLH: number, t: Thresholds): Verdict {
  // FIX 2: a non-finite delta must NOT collapse to a silent 'fail'. The
  // extraction guard + the block-level guard in computeVerdicts catch this
  // first, but classify stays defensive: a NaN/∞ here is an explicit
  // `degenerate`, never a fabricated numeric verdict.
  if (!Number.isFinite(deltaLH)) return 'degenerate';
  if (deltaLH < t.pass) return 'pass';
  if (deltaLH <= t.fail) return 'warn';
  return 'fail';
}

/**
 * Height-parity ADVISORY edge, in line-heights (pdoc-vxn FIX 1, demoting the
 * pdoc-sur root-cause-#1 gate). `heightParityLH` divides each block's height by
 * THAT side's own self-tuned `measuredLineHeight`, and those line-heights
 * diverge across sides in practice (welcome: editor ~33pt vs channel ~21pt — a
 * legitimate display-vs-print scale, NOT a derivation bug). A faithful block
 * therefore shows a large `heightDeltaLH` purely from the scale split (welcome
 * body block: 6.71LH → spurious FAIL), and the symmetric case can mask a real
 * divergence (FALSE GREEN). Because the signal is UNVALIDATED, height NEVER
 * gates the verdict — `heightDeltaLH` is reported for debuggability and a
 * block whose height divergence exceeds this edge merely earns an advisory NOTE
 * in its reason. The scale-invariant whitespace-gap `deltaLH` is the sole gate.
 */
const HEIGHT_ADVISORY_LH = 2.0;

function blockTypeOf(b: PdfBlock, medianSize: number): string {
  // Image (pdoc-evn) and box (pdoc-alu) blocks are their own kinds — never
  // heading/body.
  if (b.kind === 'image') return 'image';
  if (b.kind === 'box') return 'box';
  return b.fontSize >= medianSize + 2 ? 'heading' : 'body';
}

/**
 * Image position + size parity (pdoc-evn), in line-heights. For a paired
 * image↔image block the spacing `deltaLH` already covers its VERTICAL placement
 * relative to the previous block; this separate signal catches a genuine
 * divergence in the image's own WIDTH or HEIGHT (e.g. the channel rendered it
 * at a different aspect or scale than the editor). Each dimension is normalized
 * by THAT side's line height so a uniform display-vs-print zoom cancels — the
 * same scale-invariance the whitespace gap relies on. Returns the larger of the
 * width- and height-deltas (the dominant divergence). */
function imageParityLH(
  editor: PdfBlock,
  chBlk: PdfBlock,
  lhEditor: number,
  lhChannel: number,
): number {
  const wDelta = Math.abs(chBlk.w / lhChannel - editor.w / lhEditor);
  const hDelta = Math.abs(chBlk.h / lhChannel - editor.h / lhEditor);
  return Math.max(wDelta, hDelta);
}

/** Image size/position divergence band, in line-heights (pdoc-evn). An image
 *  whose own width/height differs from its editor counterpart by more than this
 *  (after scale-invariant normalization) is a genuine, LOCALIZED defect and
 *  gates — distinct from the spacing gate, which now reads correctly because the
 *  image is a real block. Set generously so faithful renders (the dominant case)
 *  pass while a real aspect/scale break still surfaces. */
const IMAGE_PARITY_FAIL_LH = 4.0;

/** Container-box size divergence band, in line-heights (pdoc-alu). Reuses the
 *  image size-parity machinery: a box whose own width/height diverges from its
 *  editor counterpart by more than this surfaces as the box's OWN localized
 *  fail, while the spacing gate to its neighbours now reads correctly because
 *  the box is a real block measured from its own bottom. Boxes legitimately
 *  reflow more than images (a callout's width tracks the column; LibreOffice
 *  reflows code/table boxes), so the band is set LOOSER than images so a
 *  faithful reflow of the wrapper doesn't false-fail — the gap-leak fix, not box
 *  size policing, is the goal of this task. */
const BOX_PARITY_FAIL_LH = 6.0;

function blockIdOf(b: PdfBlock, channel: Channel): string {
  return `${channel}-block-${b.idx}`;
}

/** Block-height parity (pdoc-sur root cause #1): the difference between a
 *  block's own height on each side, each normalized by that side's line height.
 *  A uniform display-vs-print scale cancels in the ratio (a faithful container
 *  at different absolute heights but the same line-count → ~0), so a non-zero
 *  value means the block occupies a different NUMBER of lines on the two sides. */
function heightParityLH(
  editor: PdfBlock,
  chBlk: PdfBlock,
  lhEditor: number,
  lhChannel: number,
): number {
  const hNormEditor = editor.h / lhEditor;
  const hNormChannel = chBlk.h / lhChannel;
  return Math.abs(hNormChannel - hNormEditor);
}

/**
 * Compare a paired block list and emit one VerdictRecord per pair / orphan.
 *
 * Two ORTHOGONAL signals, both line-height-normalized (pdoc-sur root cause #1):
 *
 *   1. `deltaLH` — the PRIMARY, gating metric: the WHITESPACE gap between this
 *      block and the previous one, i.e. `top_i − bottom_{i−1}` on each side
 *      (NOT top-to-top). The old top-to-top gap folded the previous block's
 *      HEIGHT into the spacing, so a tall container rendered at different
 *      heights editor-vs-channel inflated the gap into the NEXT block — a
 *      container-height difference masquerading as a spacing-rhythm defect.
 *      Measuring bottom-of-prev → top-of-current isolates the true inter-block
 *      spacing. Gates on the strict 0.5 / 1.0 LH bands.
 *
 *   2. `heightDeltaLH` — a SEPARATE per-block signal: this block's own height
 *      vs its paired editor block's height, each normalized by its side's line
 *      height. Reported always; gates only on a LARGE divergence
 *      (> HEIGHT_FAIL_LH), so a container that legitimately renders a different
 *      height flags HERE, localized to itself, instead of cascading a fake
 *      spacing fail downstream.
 *
 * For the FIRST paired block there is no previous block to measure a whitespace
 * gap against, so we anchor its spacing at 0 (pass) — but we STILL compute its
 * height parity, since that needs no predecessor.
 *
 * Rules baked in (bound #9):
 *   - orphan: a block present on only one side → `verdict:"orphan"`, deltaLH
 *     and heightDeltaLH null. No cascade — the alignment already localized it.
 *   - no-text: a channel block whose snippet is empty while the editor side
 *     HAS text → `verdict:"no-text"` (a FAIL), never a silent pass.
 */
export function computeVerdicts(
  pairs: Pair[],
  channel: Channel,
  editorMeta: PdfGeometry['meta'],
  channelMeta: PdfGeometry['meta'],
): VerdictRecord[] {
  const threshold = toleranceForChannel(channel);
  const gateLevel = gateLevelForChannel(channel);
  const lhEditor = editorMeta.measuredLineHeight || 12;
  const lhChannel = channelMeta.measuredLineHeight || 12;

  // Median font sizes for heading/body classification, computed per side.
  const editorBlocks = pairs
    .map((p) => p.editor)
    .filter((b): b is PdfBlock => b !== null);
  const channelBlocks = pairs
    .map((p) => p.channel)
    .filter((b): b is PdfBlock => b !== null);
  const medEditor = medianFontSize(editorBlocks);
  const medChannel = medianFontSize(channelBlocks);

  // ── FIX 3: blank / failed render is a FALSE GREEN unless we gate it ──
  // If one side extracted ZERO blocks while the other has many, the document
  // failed to render on that side — today every resulting orphan is non-gating
  // so the run would exit GREEN. A pairing where ONE side is empty while the
  // other carries real content, OR a pairing that produced ZERO real pairs (an
  // all-orphan run) with content on both sides, is a structural breakage: we
  // mark each orphan in that scenario as a GATING `degenerate` so a blank or
  // wholly-unpaired render goes RED. A handful of orphans amid real pairs is
  // still a localized insert/delete and stays non-gating.
  const editorEmpty = editorBlocks.length === 0;
  const channelEmpty = channelBlocks.length === 0;
  const realPairs = pairs.filter((p) => p.editor && p.channel).length;
  const oneSideBlank =
    (editorEmpty && channelBlocks.length > 0) ||
    (channelEmpty && editorBlocks.length > 0);
  const allOrphan =
    realPairs === 0 && editorBlocks.length > 0 && channelBlocks.length > 0;
  const renderBroken = oneSideBlank || allOrphan;

  const records: VerdictRecord[] = [];

  // Track the previous PAIRED block on each side so an orphan in between does
  // not corrupt the gap of the next real pair — we measure gap to the last
  // block that actually existed on that side.
  let prevEditor: PdfBlock | null = null;
  let prevChannel: PdfBlock | null = null;

  for (const pair of pairs) {
    const { editor, channel: chBlk } = pair;

    // ── orphan: present on exactly one side ──────────────────────────────
    if (!editor || !chBlk) {
      const present = (editor ?? chBlk)!;
      const side = editor ? 'editor' : channel;
      const med = editor ? medEditor : medChannel;
      const blockType = blockTypeOf(present, med);
      // FIX 3: in a broken render (one side blank, or zero real pairs) every
      // orphan is GATING — a blank/failed render must go RED, not silently
      // pass. A localized orphan amid real pairs stays the non-gating `orphan`.
      const verdict: Verdict = renderBroken ? 'degenerate' : 'orphan';
      const reason = renderBroken
        ? (oneSideBlank
            ? `${blockType} '${present.textSnippet || '∅'}' — the ${editor ? channel : 'editor'} side extracted ZERO blocks while the ${side} side has ${editor ? editorBlocks.length : channelBlocks.length}; a blank/failed render is a gating failure, not a silent pass`
            : `${blockType} '${present.textSnippet || '∅'}' — NO blocks paired across the two sides (all-orphan render); the document failed to align at all and is a gating failure`)
        : `${blockType} '${present.textSnippet || '∅'}' exists only on the ${side} side — no counterpart to pair against`;
      records.push({
        blockId: editor ? `editor-block-${present.idx}` : blockIdOf(present, channel),
        channel,
        deltaLH: null,
        heightDeltaLH: null,
        dyPtAbs: null,
        threshold,
        verdict,
        blockType,
        textSnippet: present.textSnippet,
        reason,
        gateLevel,
      });
      // pdoc-alu: a BOX orphan is also transparent to the spacing chain — it
      // must not become the predecessor (the absorbed text block already owns
      // the box bottom). Only a TEXT/IMAGE orphan advances prev.
      if (present.kind !== 'box') {
        if (editor) prevEditor = editor;
        else prevChannel = chBlk;
      }
      continue;
    }

    // ── FIX 2: degenerate geometry guard (defense in depth) ──────────────
    // Extraction (pdf-geometry.ts) already drops non-finite RUNS, but if a
    // block still reaches here with a non-finite y / h / fontSize on either
    // side, emit an EXPLICIT diagnostic — never let it flow into classify,
    // where `classify(NaN)`/`classify(∞)` would silently return 'fail'.
    if (
      !Number.isFinite(editor.y) ||
      !Number.isFinite(editor.h) ||
      !Number.isFinite(editor.fontSize) ||
      !Number.isFinite(chBlk.y) ||
      !Number.isFinite(chBlk.h) ||
      !Number.isFinite(chBlk.fontSize)
    ) {
      records.push({
        blockId: blockIdOf(chBlk, channel),
        channel,
        deltaLH: null,
        heightDeltaLH: null,
        dyPtAbs: null,
        threshold,
        verdict: 'degenerate',
        blockType: blockTypeOf(chBlk, medChannel),
        textSnippet: chBlk.textSnippet || editor.textSnippet,
        reason: `block '${chBlk.textSnippet || editor.textSnippet || '∅'}' has non-finite geometry (y/h/fontSize NaN or ∞) — degenerate glyph transform; cannot measure parity, flagged explicitly rather than collapsing to a silent numeric fail`,
        gateLevel,
      });
      prevEditor = editor;
      prevChannel = chBlk;
      continue;
    }

    const blockType = blockTypeOf(chBlk, medChannel);
    // Image pairs (pdoc-evn) have no text; the aligner already guaranteed they
    // pair image↔image. A human-readable label for the reason string.
    const isImagePair = editor.kind === 'image' && chBlk.kind === 'image';
    // Box pairs (pdoc-alu) — callout / code / table container boxes — also carry
    // no text and pair box↔box; treated like images for sizing + parity.
    const isBoxPair = editor.kind === 'box' && chBlk.kind === 'box';
    // Either kind is a content-free, no-glyph pair (no Jaccard, no no-text rule).
    const isGlyphlessPair = isImagePair || isBoxPair;
    const glyphlessLabel = isImagePair ? '[image]' : '[box]';
    const label = isGlyphlessPair ? glyphlessLabel : `'${chBlk.textSnippet}'`;
    const editorLabel = isGlyphlessPair ? glyphlessLabel : `'${editor.textSnippet}'`;

    // ── no-text: channel dropped a block's text the editor had ───────────
    // Image + box blocks legitimately carry NO text on both sides, so the
    // no-text rule (a dropped/rasterized TEXT block) must not fire for them.
    const editorHasText = !isGlyphlessPair && editor.textSnippet.trim().length > 0;
    const channelHasText = chBlk.textSnippet.trim().length > 0;
    if (editorHasText && !channelHasText) {
      records.push({
        blockId: blockIdOf(chBlk, channel),
        channel,
        deltaLH: null,
        heightDeltaLH: null,
        dyPtAbs: null,
        threshold,
        verdict: 'no-text',
        blockType,
        textSnippet: editor.textSnippet,
        reason: `${blockType} ${editorLabel} has text in the editor but the ${channel} channel rendered no extractable text — likely a dropped or rasterized block`,
        gateLevel,
      });
      prevEditor = editor;
      prevChannel = chBlk;
      continue;
    }

    // Height parity is computable for any pair (needs no predecessor). FIX 1:
    // it is ADVISORY ONLY — `heightAdvisory` adds a NOTE to the reason but never
    // flips the verdict (the per-side line-heights diverge by legit scale, so
    // this number is an unvalidated parity signal — see HEIGHT_ADVISORY_LH).
    const heightDeltaLH = heightParityLH(editor, chBlk, lhEditor, lhChannel);
    const heightAdvisory = heightDeltaLH > HEIGHT_ADVISORY_LH;
    const heightNote = heightAdvisory
      ? `height parity ${heightDeltaLH.toFixed(2)}LH (ADVISORY ONLY — exceeds ${HEIGHT_ADVISORY_LH}LH but height is non-gating; per-side line-heights diverge by display-vs-print scale, so this is unvalidated)`
      : `height parity ${heightDeltaLH.toFixed(2)}LH (advisory)`;

    // Image / box size parity (pdoc-evn / pdoc-alu), reusing the same scale-
    // invariant `imageParityLH` machinery. The spacing gate covers vertical
    // PLACEMENT; this catches a divergent width/height (aspect or scale break)
    // on the rect's OWN box.
    //
    //   - IMAGE pairs: a divergent size GATES (IMAGE_PARITY_FAIL_LH) — an image
    //     rendered at the wrong aspect/scale is a real, localized defect.
    //   - BOX pairs (pdoc-alu): size parity is ADVISORY ONLY, never gates. The
    //     two renderers draw a callout/code/table WRAPPER with materially
    //     different geometry by design (LibreOffice reflows the box, HTML tracks
    //     the column, the editor pads differently) — and the two sides capture
    //     different box COUNTS, so a box's own width/height is an UNVALIDATED
    //     parity signal exactly like block height (HEIGHT_ADVISORY_LH). This
    //     task's goal is the GAP-LEAK fix (the box owning its bottom so the next
    //     block's spacing reads correctly), NOT policing wrapper size. A real
    //     box-size divergence is REPORTED in the reason but must not gate, or it
    //     would re-introduce the very false-fails this task removes.
    const sizeParityLH = isGlyphlessPair
      ? imageParityLH(editor, chBlk, lhEditor, lhChannel)
      : 0;
    const sizeParityBand = isBoxPair ? BOX_PARITY_FAIL_LH : IMAGE_PARITY_FAIL_LH;
    const sizeParityOver = isGlyphlessPair && sizeParityLH > sizeParityBand;
    // Only an IMAGE size divergence GATES; a box size divergence is advisory.
    const imgParityFail = isImagePair && sizeParityOver;
    const parityKind = isImagePair ? 'image' : 'box';
    const imgNote = isGlyphlessPair
      ? `; ${parityKind} size parity ${sizeParityLH.toFixed(2)}LH${
          sizeParityOver
            ? isImagePair
              ? ` (FAIL — exceeds ${sizeParityBand}LH; ${parityKind} rendered at a divergent size)`
              : ` (ADVISORY ONLY — exceeds ${sizeParityBand}LH but box size is non-gating; the two renderers draw the wrapper at divergent geometry by design, so this is unvalidated)`
            : ' (within tolerance)'
        }`
      : '';

    // ── metric: line-height-normalized inter-block WHITESPACE gap delta ──
    if (!prevEditor || !prevChannel) {
      // First paired block — no previous block to measure a whitespace gap
      // against. Anchor its SPACING at 0; height parity is advisory, not a gate.
      // An image's own size parity still gates here (needs no predecessor).
      const verdict: Verdict = imgParityFail ? 'fail' : 'pass';
      const reason = `${blockType} ${label} is the first paired block (anchor) — gap measured from here on; ${heightNote}${imgNote}`;
      records.push({
        blockId: blockIdOf(chBlk, channel),
        channel,
        deltaLH: 0,
        heightDeltaLH,
        dyPtAbs: 0,
        threshold,
        verdict,
        blockType,
        textSnippet: chBlk.textSnippet,
        reason,
        gateLevel,
      });
      // Box pairs stay transparent to the spacing chain (see below).
      if (!isBoxPair) {
        prevEditor = editor;
        prevChannel = chBlk;
      }
      continue;
    }

    // WHITESPACE gap = top of this block minus BOTTOM of the previous block.
    // Subtracting the previous block's height removes its container size from
    // the spacing signal (pdoc-sur root cause #1).
    const gapEditorPt = editor.y - (prevEditor.y + prevEditor.h);
    const gapChannelPt = chBlk.y - (prevChannel.y + prevChannel.h);
    const gapNormEditor = gapEditorPt / lhEditor;
    const gapNormChannel = gapChannelPt / lhChannel;
    const deltaLH = Math.abs(gapNormChannel - gapNormEditor);
    const dyPtAbs = Math.abs(gapChannelPt - gapEditorPt);

    // FIX 1: the scale-invariant spacing band is the SOLE gate for TEXT blocks.
    // Height is advisory only — a large `heightDeltaLH` adds a note but never
    // flips the verdict, because the per-side line-heights diverge by legit
    // scale and the raw height ratio is therefore unvalidated as a parity
    // signal. For IMAGE blocks (pdoc-evn) a divergent own-size ALSO gates, so
    // an image rendered at the wrong scale surfaces as its OWN localized fail —
    // distinct from the spacing rhythm, which now reads correctly because the
    // image is a real block measured from its own bottom.
    const rawSpacingVerdict: Verdict = classify(deltaLH, threshold);
    // pdoc-alu: a BOX block's OWN spacing never GATES. Box capture is renderer-
    // divergent (the two sides paint different fill/stroke patterns and merge to
    // different box counts), so a box's own gap-to-predecessor is an unvalidated
    // signal — its VALUE is owning its bottom so the NEXT text block's gap reads
    // correctly, not policing its own placement. A box that would gate-fail on
    // spacing is downgraded to a (visible, non-blocking) `warn`; a clean box
    // stays a pass. This mirrors why box size parity is advisory.
    const spacingVerdict: Verdict =
      isBoxPair && rawSpacingVerdict === 'fail' ? 'warn' : rawSpacingVerdict;
    const verdict: Verdict =
      imgParityFail && spacingVerdict !== 'fail' ? 'fail' : spacingVerdict;

    const spacingClause =
      spacingVerdict === 'pass'
        ? `gap ${gapNormChannel.toFixed(2)} line-heights vs editor ${gapNormEditor.toFixed(2)} (Δ ${deltaLH.toFixed(2)}LH — within ${threshold.pass}LH)`
        : `gap ${gapNormChannel.toFixed(2)} line-heights vs editor ${gapNormEditor.toFixed(2)} (Δ ${deltaLH.toFixed(2)}LH — ${rawSpacingVerdict === 'fail' ? (isBoxPair ? `exceeds ${threshold.fail}LH (box spacing non-gating → warn)` : `exceeds ${threshold.fail}LH`) : `over ${threshold.pass}LH`})`;
    const reason = `${blockType} ${label} ${spacingClause}; ${heightNote}${imgNote}`;

    records.push({
      blockId: blockIdOf(chBlk, channel),
      channel,
      deltaLH,
      heightDeltaLH,
      dyPtAbs,
      threshold,
      verdict,
      blockType,
      textSnippet: chBlk.textSnippet,
      reason,
      gateLevel,
    });

    // pdoc-alu: a BOX pair is TRANSPARENT to the spacing chain. The leak fix
    // already extended the wrapped TEXT block's bottom to the box bottom in
    // extraction, so the box exists only for diagnostics + advisory parity — it
    // must NOT become the predecessor, or the text block sorted just after it
    // (its own wrapped content) would measure a corrupt (negative) gap against
    // the box. Keep prev pointing at the last TEXT/IMAGE pair.
    if (!isBoxPair) {
      prevEditor = editor;
      prevChannel = chBlk;
    }
  }

  return records;
}

/** A verdict counts as a CI-blocking failure when it's a `fail`, `no-text`, or
 *  `degenerate` on a GATING channel. Two tiers gate (T4, bound decision #7 +
 *  #12 + the parity-trust-boundary doc, which lists DOCX as a "full geometry
 *  gate (looser reflow-sanity threshold)"):
 *    - `geometry`      — editor/HTML/PDF, strict 0.5/1.0 LH bands;
 *    - `reflow-sanity` — DOCX, the SAME verdict set but a looser 1.5 LH fail
 *                        edge (the looseness lives in DOCX_THRESHOLDS, not here)
 *                        because LibreOffice is the oracle, not Word.
 *  Only `structural` (EPUB / Markdown — reflowable, no fixed layout) is
 *  informational and never blocks. `degenerate` covers both a non-finite block
 *  (FIX 2) and a blank / all-orphan render (FIX 3) — a blank render must go
 *  RED, never silently pass. Plain `orphan` and `warn` surface but do not
 *  block. */
export function isGatingFailure(r: VerdictRecord): boolean {
  if (r.gateLevel !== 'geometry' && r.gateLevel !== 'reflow-sanity') return false;
  return (
    r.verdict === 'fail' ||
    r.verdict === 'no-text' ||
    r.verdict === 'degenerate'
  );
}

/**
 * End-to-end convenience: pair two geometries and emit verdicts. Callers that
 * already have the two `PdfGeometry` objects use this; the test exercises the
 * `pairBlocks` + `computeVerdicts` split directly to perturb mid-pipeline.
 */
export function matchLayout(
  editor: PdfGeometry,
  channelGeom: PdfGeometry,
  channel: Channel,
): VerdictRecord[] {
  const pairs = pairBlocks(editor.blocks, channelGeom.blocks);
  return computeVerdicts(pairs, channel, editor.meta, channelGeom.meta);
}
