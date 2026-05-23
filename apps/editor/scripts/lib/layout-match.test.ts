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
