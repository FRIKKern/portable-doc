/**
 * render-to-pdf.test — the end-to-end "universal-PDF funnel" SMOKE (T2).
 *
 * This is a PROOF, not the final metric (the thresholded verdict is T3). On a
 * deliberately HARD fixture — a five-item ordered list, a four-row table, and a
 * titled callout, per the bound decision (pdoc-r9p design #11) — we:
 *
 *   1. Render the EDITOR canvas of the fixture to PDF (`renderEditorToPdf`).
 *   2. Render the HTML EXPORT of the fixture to PDF (`renderHtmlChannelToPdf`).
 *   3. Run `extractPdfGeometry` (T1) on BOTH PDFs.
 *   4. Pair blocks by document order and assert the funnel works end-to-end.
 *
 * The keystone risk this de-risks for T3: NON-1:1 block pairing. The T1
 * geometry engine groups by run-to-run gap (bound rule #2), so a tight
 * structure — a list whose items sit at 4pt leading, a table's stacked rows —
 * forms ONE CONTAINER block, not one block per item. That is the
 * "container-first for lists/tables/callouts" behaviour bound decision #3
 * anticipates. What we PROVE here is that the proof survives that: the list /
 * table / callout each form a container block that is PRESENT and pairs 1:1 by
 * document order on BOTH legs — the segmentation does NOT cascade through the
 * structured middle of the doc. (The naive "five item-blocks" reading is wrong
 * for T1; we verified the actual segmentation and assert against it.)
 *
 * Tolerances here are deliberately LOOSE — T3 sets the real pass/warn/fail
 * bands. The two legs use different body sizes (editor 18px, reader CSS 11pt),
 * so ABSOLUTE-y drifts as you descend the page; that accumulation is the
 * non-gating absolute-drift diagnostic of design #5. We pair from the top
 * (where structure is stable) and REPORT the max dy so the band is visible.
 *
 * If chromium can't launch, the funnel can't be exercised — the suite fails
 * loudly rather than faking a pass.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import type { PortableDoc } from '@portable-doc/core';
import {
  extractPdfGeometry,
  type PdfGeometry,
} from './pdf-geometry.ts';
import {
  renderEditorToPdf,
  renderHtmlChannelToPdf,
  closeEditorServer,
} from './render-to-pdf.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolvePath(__dirname, '..', '..', '..', '..');
const fixturePath = resolvePath(repoRoot, 'examples', 'funnel-hard.json');

let doc: PortableDoc;
let editor: PdfGeometry;
let html: PdfGeometry;

beforeAll(async () => {
  doc = JSON.parse(await fs.readFile(fixturePath, 'utf8')) as PortableDoc;
  const [editorPdf, htmlPdf] = await Promise.all([
    renderEditorToPdf(doc),
    renderHtmlChannelToPdf(doc),
  ]);
  [editor, html] = await Promise.all([
    extractPdfGeometry(editorPdf),
    extractPdfGeometry(htmlPdf),
  ]);
}, 120_000);

// renderEditorToPdf boots a shared Vite dev server for the live editor app;
// tear it down so vitest's worker can exit cleanly (pdoc-4pz).
afterAll(async () => {
  await closeEditorServer();
});

describe('render-to-pdf funnel (editor + HTML → PDF → geometry)', () => {
  it('renders both legs into a comparable number of blocks', () => {
    // The fixture is: H1, intro p, H2, 5-item list, H2, 4-row table, titled
    // callout, closing p — 8 logical regions. T1 groups each tight structure
    // into one container block, so each leg lands near 8 blocks. Neither leg
    // should collapse to a handful (the old wrapper-collapse failure mode) nor
    // explode into dozens.
    expect(editor.blocks.length).toBeGreaterThanOrEqual(8);
    expect(html.blocks.length).toBeGreaterThanOrEqual(8);
    expect(editor.blocks.length).toBeLessThanOrEqual(14);
    expect(html.blocks.length).toBeLessThanOrEqual(14);
    // Comparable: the structural block count must track within a small spread.
    // The two legs use different stylesheets so exact equality isn't expected.
    const delta = Math.abs(editor.blocks.length - html.blocks.length);
    expect(delta).toBeLessThanOrEqual(3);
  });

  it('keeps list + table + callout PRESENT as container blocks on BOTH sides', () => {
    const has = (g: PdfGeometry, needle: string) =>
      g.blocks.some((b) => b.textSnippet.includes(needle));
    // List container — its block snippet starts with the first item "1. Render
    // the editor…". This proves the list survives the funnel (it groups into a
    // container, per bound #3 — NOT collapsed away to nothing, NOT exploded).
    expect(has(editor, 'Render the editor')).toBe(true);
    expect(has(html, 'Render the editor')).toBe(true);
    // Table container — header + body cells flow into one block beginning
    // "Channel Gate level Tier…".
    expect(has(editor, 'Channel') && has(editor, 'Tier')).toBe(true);
    expect(has(html, 'Channel') && has(html, 'Tier')).toBe(true);
    // Callout container — its title "Why this is hard" leads the block.
    expect(has(editor, 'Why this is hard')).toBe(true);
    expect(has(html, 'Why this is hard')).toBe(true);
  });

  it('proves the keystone: list/table/callout do NOT cascade out of pairing', () => {
    // Find the document-order index of the three container blocks on each side
    // by their leading snippet. The keystone of bound decision #3 is that a
    // container does not cause downstream blocks to slip out of alignment. We
    // prove it by checking the three containers appear in the SAME relative
    // order on both legs AND that the heading immediately before each container
    // also pairs — i.e. the structure is locked, not drifting.
    // Proof operates on TEXT blocks only — advisory box/image blocks (pdoc-evn/
    // pdoc-alu) interleave differently per leg and would shift document-order
    // indices without reflecting a content mis-pair.
    const textOf = (g: PdfGeometry) => g.blocks.filter((b) => b.kind === 'text');
    const idxOf = (g: PdfGeometry, needle: string) =>
      textOf(g).findIndex((b) => b.textSnippet.includes(needle));

    const listE = idxOf(editor, 'Render the editor');
    const listH = idxOf(html, 'Render the editor');
    const tableE = idxOf(editor, 'Channel Gate level');
    const tableH = idxOf(html, 'Channel Gate level');
    const callE = idxOf(editor, 'Why this is hard');
    const callH = idxOf(html, 'Why this is hard');

    // All three present on both sides.
    for (const i of [listE, listH, tableE, tableH, callE, callH]) {
      expect(i).toBeGreaterThanOrEqual(0);
    }
    // Same relative order: list before table before callout, on BOTH legs —
    // no cascade reshuffles the structured middle.
    expect(listE).toBeLessThan(tableE);
    expect(tableE).toBeLessThan(callE);
    expect(listH).toBeLessThan(tableH);
    expect(tableH).toBeLessThan(callH);
    // And the containers sit at the SAME document-order index on both legs —
    // the strongest no-cascade signal for index-based pairing (T3 upgrades to
    // sequence-alignment, but at this fixture's scale order is already stable).
    expect(listE).toBe(listH);
    expect(tableE).toBe(tableH);
    expect(callE).toBe(callH);
  });

  it('pairs blocks by document order with close continuous-y (proof tolerance)', () => {
    // Text blocks only — advisory box/image blocks interleave per leg.
    const eText = editor.blocks.filter((b) => b.kind === 'text');
    const hText = html.blocks.filter((b) => b.kind === 'text');
    const n = Math.min(eText.length, hText.length);
    expect(n).toBeGreaterThanOrEqual(8);

    // Pair by document order over the COMMON prefix. continuous-y is on the
    // same scale because both legs render with the shared PDF_PAGE geometry.
    let maxDy = 0;
    let maxDyIdx = -1;
    const dys: number[] = [];
    for (let i = 0; i < n; i++) {
      const dy = Math.abs(eText[i]!.y - hText[i]!.y);
      dys.push(dy);
      if (dy > maxDy) {
        maxDy = dy;
        maxDyIdx = i;
      }
    }

    const lineHeight = Math.max(
      editor.meta.measuredLineHeight,
      html.meta.measuredLineHeight,
    );
    // Loose proof band. The two legs differ in body font-size (editor 18px,
    // reader CSS 11pt) so absolute-y drifts as you descend — by the closing
    // paragraph the accumulated drift is several line-heights. That is exactly
    // the NON-gating absolute-drift diagnostic of design #5; T3's PRIMARY
    // metric is the RELATIVE inter-block delta, not this absolute number. For
    // the proof we bound absolute drift to a generous multiple of the line
    // height so a structural mis-pairing (which would balloon dy by a whole
    // block ~hundreds of pt) still trips, while the expected style-driven
    // accumulation passes.
    // Generous absolute band. The editor(18px)-vs-export(11pt) style gap makes
    // absolute-y drift accumulate to ~190pt by the closing block — the
    // NON-gating diagnostic of design #5. A structural mis-pair would balloon dy
    // by hundreds of pt and still trip this. The RELATIVE gate (layout-match) is
    // the real check and is tested there.
    const tol = 12 * lineHeight; // ~252pt at the corrected ~21pt line-height.

    // REPORT so the funnel's behaviour is visible in CI output.
    const editorSnippet = eText[maxDyIdx]?.textSnippet ?? '';
    const htmlSnippet = hText[maxDyIdx]?.textSnippet ?? '';
    // eslint-disable-next-line no-console
    console.log(
      `[funnel] paired ${n} blocks | editor=${editor.blocks.length} html=${html.blocks.length} | ` +
        `lineHeight≈${lineHeight.toFixed(1)}pt tol=${tol.toFixed(1)}pt | ` +
        `MAX dy=${maxDy.toFixed(2)}pt @block#${maxDyIdx} ` +
        `(editor:"${editorSnippet}" / html:"${htmlSnippet}") | ` +
        `mean dy=${(dys.reduce((a, b) => a + b, 0) / n).toFixed(2)}pt`,
    );

    expect(maxDy).toBeLessThanOrEqual(tol);
  });
});
