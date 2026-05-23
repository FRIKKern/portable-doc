/**
 * layout-match.test — THE trust check (Goal pdoc-r9p / T3, bound decision #10).
 *
 * This suite proves the two properties every prior parity tool lacked (per the
 * pdoc-un3 research note):
 *   - a PASS means parity            → known-good case: all `pass`.
 *   - a FAIL localizes the offender  → known-bad case: perturb exactly ONE
 *     block by +30pt (~1.8 line-heights) and assert THAT block is `fail` while
 *     every other block stays `pass`, and that the failing record names it.
 *
 * The metric (line-height-normalized inter-block gap delta) is exercised on
 * synthetic `PdfGeometry` so the correctness proof is deterministic and does
 * not depend on Chromium — and so the BAD case is a surgical one-block shift
 * rather than a whole re-render. A second describe block additionally proves
 * scale-invariance and the orphan / no-text rules directly.
 */
import { describe, it, expect } from 'vitest';
import {
  pairBlocks,
  computeVerdicts,
  matchLayout,
  isGatingFailure,
  type Channel,
} from './layout-match.ts';
import type { PdfBlock, PdfGeometry } from './pdf-geometry.ts';

const LINE_HEIGHT_EDITOR = 28; // ≈ 18px × 1.55, the editor canvas cadence.
const LINE_HEIGHT_HTML = 17; // ≈ 11pt × 1.55, the HTML export cadence.

/** Build a faithful editor-side geometry: 6 blocks with realistic gaps. */
function makeEditorGeometry(): PdfGeometry {
  // Each block sits one heading-or-paragraph gap below the previous; numbers
  // chosen so inter-block gaps land at a few line-heights — a normal rhythm.
  const ys = [72, 130, 210, 290, 380, 470];
  const snippets = [
    'Funnel hard fixture',
    'This document exists to stress',
    'Steps to reproduce',
    'Render the editor canvas of this',
    'Channel matrix',
    'A list with five items, a four-row',
  ];
  const sizes = [32, 18, 24, 18, 24, 18];
  const blocks: PdfBlock[] = ys.map((y, idx) => ({
    idx,
    x: 72,
    y,
    w: 400,
    h: idx === 0 ? 40 : 24,
    fontSize: sizes[idx]!,
    textSnippet: snippets[idx]!,
    pageIndex: 0,
    kind: 'text',
  }));
  return {
    blocks,
    meta: { pageCount: 1, measuredLineHeight: LINE_HEIGHT_EDITOR, groupingGapPt: 0.6 * LINE_HEIGHT_EDITOR },
  };
}

/**
 * Build the faithful HTML-side geometry: SAME rhythm as the editor but at the
 * HTML export's smaller scale. We scale every editor y AND the line height by
 * the same factor so the normalized inter-block gaps are identical → a faithful
 * render must produce all `pass` despite the raw-pt positions differing wildly
 * (this is exactly the T2 zoom-drift the metric must cancel).
 */
function makeFaithfulHtmlGeometry(editor: PdfGeometry): PdfGeometry {
  const scale = LINE_HEIGHT_HTML / LINE_HEIGHT_EDITOR;
  const blocks: PdfBlock[] = editor.blocks.map((b) => ({
    ...b,
    y: b.y * scale,
    h: b.h * scale,
    fontSize: b.fontSize * scale,
  }));
  return {
    blocks,
    meta: { pageCount: 1, measuredLineHeight: LINE_HEIGHT_HTML, groupingGapPt: 0.6 * LINE_HEIGHT_HTML },
  };
}

/** Deep-copy a geometry so a perturbation can't bleed into the good case. */
function cloneGeometry(g: PdfGeometry): PdfGeometry {
  return {
    blocks: g.blocks.map((b) => ({ ...b })),
    meta: { ...g.meta },
  };
}

const HTML: Channel = 'html';

describe('layout-match — the trust check (bound #10)', () => {
  it('KNOWN-GOOD: editor vs its own faithful (scaled) HTML render → all pass', () => {
    const editor = makeEditorGeometry();
    const html = makeFaithfulHtmlGeometry(editor);

    const records = matchLayout(editor, html, HTML);

    expect(records).toHaveLength(editor.blocks.length);
    for (const r of records) {
      expect(r.verdict).toBe('pass');
      // A genuine pass is also below the strict band (or the anchor at 0).
      expect(r.deltaLH).not.toBeNull();
      expect(r.deltaLH!).toBeLessThan(0.5);
    }
  });

  it('KNOWN-BAD: shifting exactly ONE block by +30pt fails that block and ONLY that block', () => {
    const editor = makeEditorGeometry();
    const html = cloneGeometry(makeFaithfulHtmlGeometry(editor));

    // The metric measures inter-block GAPS, so moving an interior block down
    // corrupts TWO gaps — the gap into it (grows) AND the gap into its
    // successor (shrinks). That is correct: a single-block shift is, in gap
    // space, a two-gap event, and the verifier rightly flags both. To prove
    // the bound-#10 property "one perturbed block → exactly one failing record,
    // every other passes" we perturb the LAST block, which owns only the single
    // gap leading into it — isolating a single failing verdict with no cascade.
    const PERTURBED = html.blocks.length - 1; // last block: 'A list with five…'
    const SHIFT_PT = 30; // +30pt / 17pt HTML line height ≈ 1.76 LH > 1.0 fail edge.
    html.blocks[PERTURBED]!.y += SHIFT_PT;

    const records = computeVerdicts(
      pairBlocks(editor.blocks, html.blocks),
      HTML,
      editor.meta,
      html.meta,
    );

    const fails = records.filter((r) => r.verdict === 'fail');
    expect(fails.map((r) => r.blockId)).toEqual([`html-block-${PERTURBED}`]);

    const failing = fails[0]!;
    expect(failing.textSnippet).toBe('A list with five items, a four-row');
    expect(failing.reason).toContain('A list with five items, a four-row');
    expect(failing.deltaLH).not.toBeNull();
    expect(failing.deltaLH!).toBeGreaterThan(1.0);

    // Every OTHER block stays pass — no cascade.
    for (const r of records) {
      if (r.blockId === `html-block-${PERTURBED}`) continue;
      expect(r.verdict).toBe('pass');
    }
  });
});

describe('layout-match — metric properties', () => {
  it('is SCALE-invariant: a uniform zoom (no rhythm change) normalizes to ~0', () => {
    const editor = makeEditorGeometry();
    // 4× larger positions AND 4× line height → identical normalized gaps.
    const zoomed: PdfGeometry = {
      blocks: editor.blocks.map((b) => ({ ...b, y: b.y * 4, h: b.h * 4 })),
      meta: { ...editor.meta, measuredLineHeight: editor.meta.measuredLineHeight * 4 },
    };
    const records = matchLayout(editor, zoomed, HTML);
    for (const r of records) {
      expect(r.deltaLH!).toBeLessThan(1e-9);
      expect(r.verdict).toBe('pass');
    }
    // …yet the absolute-pt diagnostic still records the raw zoom drift.
    const lastDiag = records[records.length - 1]!;
    expect(lastDiag.dyPtAbs!).toBeGreaterThan(0);
  });

  it('emits an ORPHAN (not a cascade) for an inserted channel block', () => {
    const editor = makeEditorGeometry();
    const html = makeFaithfulHtmlGeometry(editor);
    // Insert an extra block on the channel side between block 1 and 2. Give it
    // a font size well below the channel-side body median so its alignment
    // bucket ('small') matches no editor block — the sequence-alignment then
    // unambiguously treats it as an insert (orphan) rather than substituting it
    // for a real block.
    const extra: PdfBlock = {
      idx: 99,
      x: 72,
      y: html.blocks[1]!.y + 8,
      w: 400,
      h: 12,
      fontSize: 6 * (LINE_HEIGHT_HTML / LINE_HEIGHT_EDITOR),
      textSnippet: 'SPURIOUS inserted block',
      pageIndex: 0,
      kind: 'text',
    };
    const withExtra: PdfGeometry = {
      blocks: [
        html.blocks[0]!,
        html.blocks[1]!,
        extra,
        ...html.blocks.slice(2),
      ].map((b, i) => ({ ...b, idx: i })),
      meta: html.meta,
    };
    const records = matchLayout(editor, withExtra, HTML);
    const orphans = records.filter((r) => r.verdict === 'orphan');
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.textSnippet).toBe('SPURIOUS inserted block');
    // No fail cascade triggered by the insert.
    expect(records.filter((r) => r.verdict === 'fail')).toHaveLength(0);
  });

  it('flags NO-TEXT (a fail) when the channel drops a block the editor had', () => {
    const editor = makeEditorGeometry();
    const html = cloneGeometry(makeFaithfulHtmlGeometry(editor));
    // Strip the text from one channel block while the editor side keeps it.
    html.blocks[2]!.textSnippet = '';
    const records = matchLayout(editor, html, HTML);
    const noText = records.filter((r) => r.verdict === 'no-text');
    expect(noText).toHaveLength(1);
    // It reports the EDITOR's text so a human can see what went missing.
    expect(noText[0]!.textSnippet).toBe('Steps to reproduce');
  });
});

/**
 * pdoc-sur fixes — proves the two denoising changes that make COMPLEX-fixture
 * verdicts trustworthy without loosening any threshold.
 */
describe('layout-match — pdoc-sur denoising (root causes #1 + #2)', () => {
  it('ROOT CAUSE #1: a tall container at a different height does NOT cascade a fake spacing fail onto the next block', () => {
    // Build editor blocks where block 2 is a TALL container (image / table /
    // code) and a normal body block follows it. The channel renders the SAME
    // document faithfully EXCEPT the container is much shorter — exactly the
    // situation that, under the old top-to-top gap, exploded the gap INTO the
    // following block and failed an innocent neighbour.
    const editor: PdfGeometry = {
      blocks: [
        { idx: 0, x: 72, y: 72, w: 400, h: 40, fontSize: 32, textSnippet: 'Doc heading', pageIndex: 0, kind: 'text' },
        { idx: 1, x: 72, y: 130, w: 400, h: 24, fontSize: 18, textSnippet: 'Intro paragraph above the figure', pageIndex: 0, kind: 'text' },
        // The TALL container: 200pt high on the editor side.
        { idx: 2, x: 72, y: 170, w: 400, h: 200, fontSize: 18, textSnippet: 'A large diagram figure container', pageIndex: 0, kind: 'text' },
        // Body block immediately after the container, one paragraph gap below it.
        { idx: 3, x: 72, y: 398, w: 400, h: 24, fontSize: 18, textSnippet: 'Body text right after the figure', pageIndex: 0, kind: 'text' },
      ],
      meta: {
        pageCount: 1,
        measuredLineHeight: LINE_HEIGHT_EDITOR,
        groupingGapPt: 0.6 * LINE_HEIGHT_EDITOR,
      },
    };
    const scale = LINE_HEIGHT_HTML / LINE_HEIGHT_EDITOR;
    // Faithful channel render: same WHITESPACE rhythm (each block sits the same
    // normalized gap below the previous block's BOTTOM), but the container
    // renders only 90pt tall instead of 200pt — a legitimate container-height
    // divergence. We lay the channel out from the gaps, not by scaling y, so
    // the shorter container does NOT corrupt the spacing below it.
    const lhE = LINE_HEIGHT_EDITOR;
    const editorGaps = [
      editor.blocks[1]!.y - (editor.blocks[0]!.y + editor.blocks[0]!.h),
      editor.blocks[2]!.y - (editor.blocks[1]!.y + editor.blocks[1]!.h),
      editor.blocks[3]!.y - (editor.blocks[2]!.y + editor.blocks[2]!.h),
    ];
    const chHeights = [40, 24, 90 /* shorter container */, 24].map((h) => h * scale);
    const chTexts = editor.blocks.map((b) => b.textSnippet);
    const chBlocks: PdfBlock[] = [];
    let yCursor = 72 * scale;
    for (let i = 0; i < 4; i++) {
      if (i > 0) {
        const prev = chBlocks[i - 1]!;
        const gapNorm = editorGaps[i - 1]! / lhE; // same normalized whitespace gap
        yCursor = prev.y + prev.h + gapNorm * LINE_HEIGHT_HTML;
      }
      chBlocks.push({
        idx: i,
        x: 72 * scale,
        y: yCursor,
        w: 400 * scale,
        h: chHeights[i]!,
        fontSize: editor.blocks[i]!.fontSize * scale,
        textSnippet: chTexts[i]!,
        pageIndex: 0,
        kind: 'text',
      });
    }
    const channel: PdfGeometry = {
      blocks: chBlocks,
      meta: {
        pageCount: 1,
        measuredLineHeight: LINE_HEIGHT_HTML,
        groupingGapPt: 0.6 * LINE_HEIGHT_HTML,
      },
    };

    const records = matchLayout(editor, channel, HTML);
    expect(records).toHaveLength(4);

    // The block AFTER the container keeps a clean WHITESPACE gap → no fake fail.
    const after = records.find((r) => r.textSnippet === 'Body text right after the figure')!;
    expect(after.deltaLH).not.toBeNull();
    expect(after.deltaLH!).toBeLessThan(0.5);
    expect(after.verdict).not.toBe('fail');

    // The container's height divergence is still REPORTED as its own signal
    // (localized to itself — 110pt over a 17pt LH ≈ 6.5 LH), but per pdoc-vxn
    // FIX 1 height is ADVISORY ONLY: it must NOT gate. The container's spacing
    // is clean, so its verdict is a pass, with the divergence noted in reason.
    const container = records.find((r) => r.textSnippet === 'A large diagram figure container')!;
    expect(container.heightDeltaLH).not.toBeNull();
    expect(container.heightDeltaLH!).toBeGreaterThan(2.0);
    expect(container.verdict).not.toBe('fail'); // advisory, never gates
    expect(container.reason).toContain('ADVISORY');
    // And nothing in this faithful (only-height-diverges) render is a gating fail.
    expect(records.some((r) => r.verdict === 'fail' || r.verdict === 'degenerate')).toBe(false);
  });

  it('ROOT CAUSE #2: block sets that segment slightly differently still PAIR by text instead of orphaning', () => {
    // Editor segments a passage into ONE block; the channel renderer splits the
    // SAME prose across TWO blocks (a common wrapping/segmentation difference).
    // Old geometry-only alignment dropped the surplus as an orphan; the text
    // match must now pair them with no orphan and no fail.
    const editor: PdfGeometry = {
      blocks: [
        { idx: 0, x: 72, y: 72, w: 400, h: 40, fontSize: 32, textSnippet: 'Release notes for the funnel tool', pageIndex: 0, kind: 'text' },
        { idx: 1, x: 72, y: 130, w: 400, h: 24, fontSize: 18, textSnippet: 'The verifier pairs editor and channel', pageIndex: 0, kind: 'text' },
        { idx: 2, x: 72, y: 175, w: 400, h: 24, fontSize: 18, textSnippet: 'Each block earns one verdict record', pageIndex: 0, kind: 'text' },
      ],
      meta: {
        pageCount: 1,
        measuredLineHeight: LINE_HEIGHT_EDITOR,
        groupingGapPt: 0.6 * LINE_HEIGHT_EDITOR,
      },
    };
    const scale = LINE_HEIGHT_HTML / LINE_HEIGHT_EDITOR;
    // Channel keeps the heading but splits editor block 1's prose into two — the
    // tokens of editor block 1 are shared across channel blocks 1a and 1b, while
    // editor block 2 maps cleanly to channel block 2. 4 channel blocks vs 3.
    const channel: PdfGeometry = {
      blocks: [
        { idx: 0, x: 72, y: 72 * scale, w: 400, h: 40 * scale, fontSize: 32 * scale, textSnippet: 'Release notes for the funnel tool', pageIndex: 0, kind: 'text' },
        { idx: 1, x: 72, y: 130 * scale, w: 400, h: 17, fontSize: 18 * scale, textSnippet: 'The verifier pairs editor and', pageIndex: 0, kind: 'text' },
        { idx: 2, x: 72, y: 152 * scale, w: 400, h: 17, fontSize: 18 * scale, textSnippet: 'channel blocks by content', pageIndex: 0, kind: 'text' },
        { idx: 3, x: 72, y: 175 * scale, w: 400, h: 24 * scale, fontSize: 18 * scale, textSnippet: 'Each block earns one verdict record', pageIndex: 0, kind: 'text' },
      ],
      meta: {
        pageCount: 1,
        measuredLineHeight: LINE_HEIGHT_HTML,
        groupingGapPt: 0.6 * LINE_HEIGHT_HTML,
      },
    };

    const records = matchLayout(editor, channel, HTML);
    // The heading and 'Each block…' pair cleanly by text; the split prose pairs
    // its strongest counterpart and the residual fragment is the ONLY thing the
    // alignment may leave over. With token overlap on both fragments the heavy
    // overlap pairs; at most ONE residual orphan — far below the old counts —
    // and crucially the cleanly-matching blocks are NOT orphaned.
    const orphans = records.filter((r) => r.verdict === 'orphan');
    expect(orphans.length).toBeLessThanOrEqual(1);
    // The heading and the trailing block must PAIR (not orphan).
    const heading = records.find((r) => r.textSnippet.startsWith('Release notes'));
    const trailing = records.find((r) => r.textSnippet.startsWith('Each block earns'));
    expect(heading).toBeDefined();
    expect(heading!.verdict).not.toBe('orphan');
    expect(trailing).toBeDefined();
    expect(trailing!.verdict).not.toBe('orphan');
  });
});

/**
 * pdoc-vxn trust fixes — de-circularizes the self-test and proves the three
 * gating-correctness changes. The HARD RULE: denoise by being MORE correct,
 * never by hiding a real divergence. Height goes advisory because it is
 * UNVALIDATED (per-side line-heights legitimately diverge), the spacing gate
 * stays strict, and a blank/degenerate render goes RED.
 */
describe('layout-match — pdoc-vxn trust fixes (FIX 1/2/3/4)', () => {
  // The real editor/channel line-heights from .papir-check/geometry/welcome
  // (editor ~33pt, channel ~21pt — a ~1.57× display-vs-print scale split, NOT a
  // derivation bug). The OLD self-test held both sides at a matched 28/17 so the
  // height ratio cancelled by construction — the exact variable that breaks on
  // real PDFs was held fixed. These cases tune the two sides INDEPENDENTLY.
  const LH_EDITOR_REAL = 33;
  const LH_CHANNEL_REAL = 21;

  it('FIX 1 + FIX 4 (de-circularized known-good): INDEPENDENT per-side line-heights with a real height divergence → NO gating fail', () => {
    // Faithful render: same WHITESPACE rhythm on both sides (each block sits the
    // same NORMALIZED gap below the previous block's bottom), but the two sides
    // have independently-tuned line-heights AND block heights that do NOT scale
    // proportionally — mimicking welcome, where the editor body block reads
    // 6.71 line-heights taller than its channel counterpart purely from the
    // scale split. Under the OLD gating-height logic this faithful render
    // false-FAILED; with height demoted to advisory it must be all-pass.
    const snippets = [
      'Welcome to Atlas',
      'Your workspace is ready. Atlas keeps',
      "What's next",
      'Browse the documentation to learn how',
    ];
    // Editor side: heights chosen so block 1 is much "taller in LH" than the
    // channel will be (the welcome 6.71LH effect), spacing gaps are a clean
    // rhythm. Editor LH = 33.
    const editorHeights = [40, 230, 28, 60]; // block 1 is a tall multi-line body run
    const editorGapsLH = [0, 1.0, 1.6, 0.9]; // normalized whitespace gaps (block 0 is anchor)
    const editorBlocks: PdfBlock[] = [];
    let ey = 72;
    for (let i = 0; i < 4; i++) {
      if (i > 0) {
        const prev = editorBlocks[i - 1]!;
        ey = prev.y + prev.h + editorGapsLH[i]! * LH_EDITOR_REAL;
      }
      editorBlocks.push({
        idx: i,
        x: 72,
        y: ey,
        w: 400,
        h: editorHeights[i]!,
        fontSize: i === 0 ? 28 : i === 2 ? 22 : 14,
        textSnippet: snippets[i]!,
        pageIndex: 0,
        kind: 'text',
      });
    }
    const editor: PdfGeometry = {
      blocks: editorBlocks,
      meta: { pageCount: 1, measuredLineHeight: LH_EDITOR_REAL, groupingGapPt: 0.6 * LH_EDITOR_REAL },
    };
    // Channel side: SAME normalized gaps (faithful spacing), but heights are NOT
    // a proportional scale of the editor's — block 1 renders far shorter in LH,
    // so heightParityLH(block 1) is large (a would-be false fail under the old
    // gate). Channel LH = 21, independent of the editor's.
    const channelHeights = [26, 90, 18, 38]; // block 1: 90/21≈4.3 LH vs editor 230/33≈7.0 LH → ~2.7LH delta
    const channelGapsLH = [0, 1.0, 1.6, 0.9]; // identical normalized rhythm → spacing Δ ≈ 0
    const channelBlocks: PdfBlock[] = [];
    let cy = 60;
    for (let i = 0; i < 4; i++) {
      if (i > 0) {
        const prev = channelBlocks[i - 1]!;
        cy = prev.y + prev.h + channelGapsLH[i]! * LH_CHANNEL_REAL;
      }
      channelBlocks.push({
        idx: i,
        x: 60,
        y: cy,
        w: 320,
        h: channelHeights[i]!,
        fontSize: i === 0 ? 18 : i === 2 ? 14 : 9,
        textSnippet: snippets[i]!,
        pageIndex: 0,
        kind: 'text',
      });
    }
    const channel: PdfGeometry = {
      blocks: channelBlocks,
      meta: { pageCount: 1, measuredLineHeight: LH_CHANNEL_REAL, groupingGapPt: 0.6 * LH_CHANNEL_REAL },
    };

    const records = matchLayout(editor, channel, HTML);
    expect(records).toHaveLength(4);

    // The block whose height diverges most must NOT gate-fail — height advisory.
    const tall = records.find((r) => r.textSnippet.startsWith('Your workspace'))!;
    expect(tall.heightDeltaLH).not.toBeNull();
    expect(tall.heightDeltaLH!).toBeGreaterThan(2.0); // real divergence, still REPORTED
    expect(tall.verdict).not.toBe('fail');
    expect(tall.reason).toContain('ADVISORY');

    // NO block is a gating failure on this faithful render — the welcome
    // height false-fail is gone, and the spacing gate (the sound, scale-
    // invariant one) stays clean across the LH divergence.
    expect(records.some((r) => r.verdict === 'fail' || r.verdict === 'degenerate' || r.verdict === 'no-text')).toBe(false);
    for (const r of records) {
      if (r.deltaLH !== null) expect(r.deltaLH).toBeLessThan(0.5);
    }
  });

  it('FIX 1 (height stays advisory, spacing stays strict): the +30pt perturbation STILL fails exactly the perturbed block', () => {
    // Regression guard: demoting height must not weaken the spacing gate. Re-run
    // the bound-#10 discrimination case and confirm the perturbed block still
    // fails on SPACING alone.
    const editor = makeEditorGeometry();
    const html = cloneGeometry(makeFaithfulHtmlGeometry(editor));
    const PERTURBED = html.blocks.length - 1;
    html.blocks[PERTURBED]!.y += 30;
    const records = computeVerdicts(
      pairBlocks(editor.blocks, html.blocks),
      HTML,
      editor.meta,
      html.meta,
    );
    const fails = records.filter((r) => r.verdict === 'fail');
    expect(fails.map((r) => r.blockId)).toEqual([`html-block-${PERTURBED}`]);
    // It fails on SPACING (deltaLH past the fail edge), not on a height gate.
    expect(fails[0]!.deltaLH!).toBeGreaterThan(1.0);
  });

  it('FIX 3: a blank render — one side has 0 blocks while the other has many — is a GATING failure, not a silent green', () => {
    const editor = makeEditorGeometry(); // 6 real blocks
    const blankChannel: PdfGeometry = {
      blocks: [], // channel rendered nothing — a blank / failed render
      meta: { pageCount: 1, measuredLineHeight: LINE_HEIGHT_HTML, groupingGapPt: 0.6 * LINE_HEIGHT_HTML },
    };
    const records = matchLayout(editor, blankChannel, HTML);
    // Every editor block becomes a gating `degenerate` orphan → run goes RED.
    expect(records.length).toBe(editor.blocks.length);
    expect(records.every((r) => r.verdict === 'degenerate')).toBe(true);
    expect(records.some(isGatingFailure)).toBe(true);
    expect(records.filter(isGatingFailure).length).toBe(editor.blocks.length);
    expect(records[0]!.reason).toContain('ZERO blocks');
  });

  it('FIX 3: an all-orphan pairing (content on both sides but ZERO real pairs) is a GATING failure', () => {
    // The TAG_BONUS tie-break pairs same-bucket blocks even with no text overlap,
    // so a TOTAL all-orphan rarely survives the aligner with running text on both
    // sides — but the gating contract must still hold for the degenerate alignment
    // that DOES produce it (e.g. a render that segmented into wholly disjoint
    // buckets). We assert the gating logic directly on a hand-built all-orphan
    // pairing — exactly what such an alignment emits — so the contract is proven
    // without contriving an unreachable fixture for the aligner itself.
    const editorMeta = { pageCount: 1, measuredLineHeight: LINE_HEIGHT_EDITOR, groupingGapPt: 0.6 * LINE_HEIGHT_EDITOR };
    const channelMeta = { pageCount: 1, measuredLineHeight: LINE_HEIGHT_HTML, groupingGapPt: 0.6 * LINE_HEIGHT_HTML };
    const eBlk = (idx: number, snip: string): PdfBlock => ({ idx, x: 72, y: 72 + idx * 60, w: 400, h: 24, fontSize: 18, textSnippet: snip, pageIndex: 0, kind: 'text' });
    const cBlk = (idx: number, snip: string): PdfBlock => ({ idx, x: 60, y: 60 + idx * 40, w: 320, h: 12, fontSize: 9, textSnippet: snip, pageIndex: 0, kind: 'text' });
    // Interleaved orphans on both sides, ZERO real pairs (no pair has both set).
    const allOrphanPairs = [
      { editor: eBlk(0, 'alpha bravo'), channel: null },
      { editor: null, channel: cBlk(0, 'zulu yankee') },
      { editor: eBlk(1, 'delta echo'), channel: null },
      { editor: null, channel: cBlk(1, 'whiskey victor') },
    ];
    const records = computeVerdicts(allOrphanPairs, HTML, editorMeta, channelMeta);
    expect(records.length).toBe(4);
    // No real pair survived → every record is a gating `degenerate`.
    expect(records.every((r) => r.verdict === 'degenerate')).toBe(true);
    expect(records.some(isGatingFailure)).toBe(true);
    expect(records.some((r) => r.reason.includes('all-orphan'))).toBe(true);
  });

  it('FIX 2: a degenerate block (non-finite height) yields an explicit `degenerate` verdict, NEVER a silent fail', () => {
    const editor = makeEditorGeometry();
    const html = cloneGeometry(makeFaithfulHtmlGeometry(editor));
    // Inject a degenerate glyph transform on one channel block (∞ height).
    html.blocks[2]!.h = Infinity;
    const records = computeVerdicts(
      pairBlocks(editor.blocks, html.blocks),
      HTML,
      editor.meta,
      html.meta,
    );
    // The ∞-height block is degenerate; its bottom (y + ∞) also poisons the
    // WHITESPACE gap of the FOLLOWING block, which the classify guard likewise
    // catches as degenerate (defense in depth) — both surface EXPLICITLY rather
    // than as a silent numeric 'fail'. That cascade is honest: a non-finite
    // height genuinely makes the next gap unmeasurable.
    const degenerate = records.filter((r) => r.verdict === 'degenerate');
    expect(degenerate.length).toBeGreaterThanOrEqual(1);
    expect(degenerate.some((r) => r.reason.includes('non-finite'))).toBe(true);
    // Every degenerate verdict gates — not a silent numeric 'fail'.
    expect(degenerate.every(isGatingFailure)).toBe(true);
    // And NOTHING masqueraded as a spacing 'fail'.
    expect(records.some((r) => r.verdict === 'fail')).toBe(false);
  });

  it('FIX 2 (classify guard): classify(NaN) and classify(∞) return `degenerate`, never `fail`', () => {
    // Direct guard on the metric: a NaN delta must surface explicitly. We prove
    // it through computeVerdicts by feeding a NaN y that the block-level guard
    // catches as degenerate (defense in depth — extraction drops it first).
    const editor = makeEditorGeometry();
    const html = cloneGeometry(makeFaithfulHtmlGeometry(editor));
    html.blocks[3]!.y = NaN;
    const records = computeVerdicts(
      pairBlocks(editor.blocks, html.blocks),
      HTML,
      editor.meta,
      html.meta,
    );
    const bad = records.find((r) => r.verdict === 'degenerate');
    expect(bad).toBeDefined();
    expect(records.some((r) => r.verdict === 'fail')).toBe(false);
  });
});

/**
 * pdoc-evn — images are first-class blocks. An image carries position + size
 * (from the PDF's image-XObject placement) but NO text, so it pairs image↔image
 * by kind + order. The core win: the block AFTER an image measures its
 * whitespace gap from the IMAGE's bottom, not from the previous text block, so
 * the image height no longer leaks into its successor's gap (the with-images /
 * exhaustive false-fails). A genuine image size divergence surfaces as the
 * image's OWN localized fail, NOT as a spacing fail on a downstream block.
 */
describe('layout-match — pdoc-evn image blocks', () => {
  // A doc: heading → body → IMAGE → body. The image is 120pt tall on the
  // editor side. We build BOTH sides with the same faithful whitespace rhythm.
  function makeImageGeometry(opts: {
    lh: number;
    x0: number;
    imageHeight: number;
    imageWidth: number;
  }): PdfGeometry {
    const { lh, x0, imageHeight, imageWidth } = opts;
    const gapsLH = [0, 1.0, 1.2, 1.0]; // normalized whitespace gaps (block 0 anchor)
    const specs: Array<{ h: number; fontSize: number; snippet: string; kind: 'text' | 'image' }> = [
      { h: 1.3 * lh, fontSize: 28, snippet: 'Image section heading', kind: 'text' },
      { h: 1.0 * lh, fontSize: 14, snippet: 'A paragraph above the image with words', kind: 'text' },
      { h: imageHeight, fontSize: 0, snippet: '', kind: 'image' },
      { h: 1.0 * lh, fontSize: 14, snippet: 'A paragraph right after the image', kind: 'text' },
    ];
    const blocks: PdfBlock[] = [];
    let y = 72;
    for (let i = 0; i < specs.length; i++) {
      if (i > 0) {
        const prev = blocks[i - 1]!;
        y = prev.y + prev.h + gapsLH[i]! * lh;
      }
      const s = specs[i]!;
      blocks.push({
        idx: i,
        x: x0,
        y,
        w: s.kind === 'image' ? imageWidth : 400,
        h: s.h,
        fontSize: s.fontSize,
        textSnippet: s.snippet,
        pageIndex: 0,
        kind: s.kind,
      });
    }
    return {
      blocks,
      meta: { pageCount: 1, measuredLineHeight: lh, groupingGapPt: 0.6 * lh },
    };
  }

  it('extracts an image as its OWN block that pairs image↔image, and the block AFTER the image keeps a clean gap (no leaked image height)', () => {
    // Editor: 120pt-tall image. Channel: faithful render — same normalized
    // rhythm, image scaled to the channel's line-height (90pt at the smaller
    // scale). The KEY assertion: under the old glyph-only extraction the image
    // had NO block, so 'A paragraph right after the image' measured its gap from
    // the PREVIOUS TEXT block and inherited the whole image height → a huge fake
    // gap. With the image now a real block, its successor's gap is measured from
    // the image bottom and reads as a clean ~1 line-height.
    const editor = makeImageGeometry({ lh: 28, x0: 72, imageHeight: 120, imageWidth: 200 });
    const scale = 17 / 28;
    const channel = makeImageGeometry({
      lh: 17,
      x0: 72 * scale,
      imageHeight: 120 * scale,
      imageWidth: 200 * scale,
    });

    const records = matchLayout(editor, channel, HTML);
    // The image is a paired block of its own.
    const imageRec = records.find((r) => r.blockType === 'image');
    expect(imageRec).toBeDefined();
    expect(imageRec!.verdict).not.toBe('orphan');
    expect(imageRec!.reason).toContain('image size parity');

    // The paragraph AFTER the image keeps a clean gap → no leaked image height.
    const after = records.find((r) => r.textSnippet.startsWith('A paragraph right after'))!;
    expect(after).toBeDefined();
    expect(after.deltaLH).not.toBeNull();
    expect(after.deltaLH!).toBeLessThan(0.5);
    expect(after.verdict).toBe('pass');

    // The whole faithful render has zero gating failures — image was the
    // dominant false-fail source before pdoc-evn.
    expect(records.some(isGatingFailure)).toBe(false);
  });

  it('SELF-TEST: a divergent image SIZE surfaces as the IMAGE block`s OWN fail, not a downstream spacing fail', () => {
    // Same faithful rhythm, but the channel renders the image at a wildly
    // divergent size (a real aspect/scale break). The image block must fail on
    // its own size parity; the block AFTER it still keeps a clean gap (the
    // divergence stays localized to the image, no cascade).
    const editor = makeImageGeometry({ lh: 28, x0: 72, imageHeight: 120, imageWidth: 200 });
    const scale = 17 / 28;
    // Image rendered far too small on the channel: width 40 vs 200, height 24 vs
    // 120 (scaled). The faithful gap below it is preserved so spacing stays clean.
    const channel = makeImageGeometry({
      lh: 17,
      x0: 72 * scale,
      imageHeight: 24,
      imageWidth: 40,
    });

    const records = matchLayout(editor, channel, HTML);
    const imageRec = records.find((r) => r.blockType === 'image')!;
    expect(imageRec).toBeDefined();
    expect(imageRec.verdict).toBe('fail');
    expect(imageRec.reason).toContain('image size parity');
    expect(isGatingFailure(imageRec)).toBe(true);

    // The divergence is localized: the paragraph after the image does NOT fail.
    const after = records.find((r) => r.textSnippet.startsWith('A paragraph right after'))!;
    expect(after.verdict).not.toBe('fail');

    // Exactly ONE gating failure — the image — no cascade onto neighbours.
    expect(records.filter(isGatingFailure)).toHaveLength(1);
  });
});
