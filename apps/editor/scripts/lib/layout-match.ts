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

/** Per-block outcome, the agent-facing unit (bound #9). */
export type Verdict = 'pass' | 'warn' | 'fail' | 'orphan' | 'no-text';

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
  /** PRIMARY metric: |normalized inter-block gap delta|, in line-heights.
   *  null for orphans (no pair to measure against). */
  deltaLH: number | null;
  /** DIAGNOSTIC ONLY (non-gating): absolute inter-block gap delta in points.
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
  if (blocks.length === 0) return 12;
  const counts = new Map<number, number>();
  for (const b of blocks) {
    const k = Math.round(b.fontSize);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = blocks[0]!.fontSize;
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
  if (blocks.length === 0) return 12;
  const sorted = blocks.map((b) => b.fontSize).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Pair editor blocks against channel blocks.
 *
 * Container-first by document order: `extractPdfGeometry` already collapses
 * each list / table / callout to ONE block, so when the two streams have equal
 * length we pair straight by index — the cheap, common, correct path.
 *
 * When the counts differ we run an LCS-style sequence alignment over the
 * coarse `alignKey` of each block. The classic edit-distance DP gives us a
 * traceback where an inserted/deleted block becomes a single orphan rather
 * than shifting every subsequent pair (the cascade the prototype suffered).
 */
export function pairBlocks(
  editorBlocks: PdfBlock[],
  channelBlocks: PdfBlock[],
): Pair[] {
  // Fast path: equal counts → straight document-order zip. This is the funnel's
  // common case once containers are grouped (T2 finding #1).
  if (editorBlocks.length === channelBlocks.length) {
    return editorBlocks.map((e, i) => ({
      editor: e,
      channel: channelBlocks[i] ?? null,
    }));
  }

  // Differing counts → align. Key each side against ITS OWN body size so the
  // heading/body/small classification is scale-invariant — a heading on the
  // editor side keys the same 'h' as the heading on the smaller-scaled channel
  // side even though their absolute point sizes differ (T2 finding #2).
  const bodyEditor = bodyFontSize(editorBlocks);
  const bodyChannel = bodyFontSize(channelBlocks);
  const ek = editorBlocks.map((b) => alignKey(b, bodyEditor));
  const ck = channelBlocks.map((b) => alignKey(b, bodyChannel));

  const m = editorBlocks.length;
  const n = channelBlocks.length;

  // dp[i][j] = min edit cost to align editor[0..i) with channel[0..j).
  // A key MATCH costs 0; an indel costs 1. A key-MISMATCH "substitution" costs
  // 2 — strictly more than an indel pair — so two unlike blocks are NEVER
  // paired when they could instead be explained as one insert + one delete.
  // This makes a genuine inserted/deleted block emit a localized `orphan`
  // rather than smearing into a same-cost mismatched-substitution chain that
  // shifts every downstream pair (the cascade bound decision #3 forbids).
  const MISMATCH_COST = 2;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const subCost = ek[i - 1] === ck[j - 1] ? 0 : MISMATCH_COST;
      dp[i]![j] = Math.min(
        dp[i - 1]![j - 1]! + subCost, // align i with j
        dp[i - 1]![j]! + 1, // editor i is an orphan (delete)
        dp[i]![j - 1]! + 1, // channel j is an orphan (insert)
      );
    }
  }

  // Traceback from (m, n) to (0, 0), emitting pairs / orphans in reverse, then
  // reverse the list so it reads in document order.
  const out: Pair[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    // Prefer a genuine MATCH on the diagonal (subCost 0) above all else — a
    // real pairing should never be broken into two orphans. A key-mismatch
    // substitution (cost 2) is only taken as a last resort, when it is the
    // sole optimal move, so a uniquely-keyed insert/delete is emitted as an
    // orphan instead of being smeared into a mismatched substitution chain.
    if (i > 0 && j > 0) {
      const subCost = ek[i - 1] === ck[j - 1] ? 0 : MISMATCH_COST;
      if (subCost === 0 && dp[i]![j] === dp[i - 1]![j - 1]!) {
        out.push({ editor: editorBlocks[i - 1]!, channel: channelBlocks[j - 1]! });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && dp[i]![j] === dp[i - 1]![j]! + 1) {
      out.push({ editor: editorBlocks[i - 1]!, channel: null });
      i--;
      continue;
    }
    if (j > 0 && dp[i]![j] === dp[i]![j - 1]! + 1) {
      out.push({ editor: null, channel: channelBlocks[j - 1]! });
      j--;
      continue;
    }
    // Only a mismatched substitution remains on the optimal path.
    out.push({ editor: editorBlocks[i - 1]!, channel: channelBlocks[j - 1]! });
    i--;
    j--;
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
  if (deltaLH < t.pass) return 'pass';
  if (deltaLH <= t.fail) return 'warn';
  return 'fail';
}

function blockTypeOf(b: PdfBlock, medianSize: number): string {
  return b.fontSize >= medianSize + 2 ? 'heading' : 'body';
}

function blockIdOf(b: PdfBlock, channel: Channel): string {
  return `${channel}-block-${b.idx}`;
}

/**
 * Compare a paired block list and emit one VerdictRecord per pair / orphan.
 *
 * The metric is the line-height-normalized inter-block gap delta described in
 * the module header. For the FIRST paired block there is no previous block to
 * measure a gap against, so we anchor it as a pass (its absolute position is
 * fixed by the page top; only RHYTHM between blocks is a defect we can localize).
 *
 * Rules baked in (bound #9):
 *   - orphan: a block present on only one side → `verdict:"orphan"`, deltaLH
 *     null. No cascade — the alignment already localized it.
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
      records.push({
        blockId: editor ? `editor-block-${present.idx}` : blockIdOf(present, channel),
        channel,
        deltaLH: null,
        dyPtAbs: null,
        threshold,
        verdict: 'orphan',
        blockType,
        textSnippet: present.textSnippet,
        reason: `${blockType} '${present.textSnippet || '∅'}' exists only on the ${side} side — no counterpart to pair against`,
        gateLevel,
      });
      if (editor) prevEditor = editor;
      else prevChannel = chBlk;
      continue;
    }

    const blockType = blockTypeOf(chBlk, medChannel);

    // ── no-text: channel dropped a block's text the editor had ───────────
    const editorHasText = editor.textSnippet.trim().length > 0;
    const channelHasText = chBlk.textSnippet.trim().length > 0;
    if (editorHasText && !channelHasText) {
      records.push({
        blockId: blockIdOf(chBlk, channel),
        channel,
        deltaLH: null,
        dyPtAbs: null,
        threshold,
        verdict: 'no-text',
        blockType,
        textSnippet: editor.textSnippet,
        reason: `${blockType} '${editor.textSnippet}' has text in the editor but the ${channel} channel rendered no extractable text — likely a dropped or rasterized block`,
        gateLevel,
      });
      prevEditor = editor;
      prevChannel = chBlk;
      continue;
    }

    // ── metric: line-height-normalized inter-block gap delta ─────────────
    if (!prevEditor || !prevChannel) {
      // First paired block — no previous gap to measure. Anchor as pass.
      records.push({
        blockId: blockIdOf(chBlk, channel),
        channel,
        deltaLH: 0,
        dyPtAbs: 0,
        threshold,
        verdict: 'pass',
        blockType,
        textSnippet: chBlk.textSnippet,
        reason: `${blockType} '${chBlk.textSnippet}' is the first paired block (anchor) — gap measured from here on`,
        gateLevel,
      });
      prevEditor = editor;
      prevChannel = chBlk;
      continue;
    }

    const gapEditorPt = editor.y - prevEditor.y;
    const gapChannelPt = chBlk.y - prevChannel.y;
    const gapNormEditor = gapEditorPt / lhEditor;
    const gapNormChannel = gapChannelPt / lhChannel;
    const deltaLH = Math.abs(gapNormChannel - gapNormEditor);
    const dyPtAbs = Math.abs(gapChannelPt - gapEditorPt);

    const verdict = classify(deltaLH, threshold);
    const reason =
      verdict === 'pass'
        ? `${blockType} '${chBlk.textSnippet}' gap ${gapNormChannel.toFixed(2)} line-heights vs editor ${gapNormEditor.toFixed(2)} (Δ ${deltaLH.toFixed(2)}LH — within ${threshold.pass}LH)`
        : `${blockType} '${chBlk.textSnippet}' gap ${gapNormChannel.toFixed(2)} line-heights vs editor ${gapNormEditor.toFixed(2)} (Δ ${deltaLH.toFixed(2)}LH — ${verdict === 'fail' ? `exceeds ${threshold.fail}LH` : `over ${threshold.pass}LH`})`;

    records.push({
      blockId: blockIdOf(chBlk, channel),
      channel,
      deltaLH,
      dyPtAbs,
      threshold,
      verdict,
      blockType,
      textSnippet: chBlk.textSnippet,
      reason,
      gateLevel,
    });

    prevEditor = editor;
    prevChannel = chBlk;
  }

  return records;
}

/** A verdict counts as a CI-blocking failure when it's a fail or no-text on a
 *  geometry-tier channel. `orphan` and `warn` surface but do not block. */
export function isGatingFailure(r: VerdictRecord): boolean {
  if (r.gateLevel !== 'geometry') return false;
  return r.verdict === 'fail' || r.verdict === 'no-text';
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
