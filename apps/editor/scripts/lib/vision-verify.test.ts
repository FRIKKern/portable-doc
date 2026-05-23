/**
 * vision-verify.test — deterministic mechanics of the ADVISORY visual-agent
 * tier (Goal pdoc-r9p / T7). NO model call, NO browser. We prove the harness
 * plumbing the live judge depends on:
 *
 *   1. Overlay PNGs are produced and carry NUMBERS that match the geometry
 *      block indices — the shared vocabulary across tiers.
 *   2. The assembled judge bundle embeds the fixed rubric, the Tier-1 geometry
 *      verdict context, AND the required output schema.
 *   3. A well-formed sample model RESPONSE parses into a valid `Finding[]`, and
 *      malformed responses are REJECTED (never silently → "no findings").
 *   4. The no-key path emits the full bundle (overlay PNGs + prompt.json +
 *      schema.json) and returns the "unavailable" status WITHOUT throwing.
 *
 * The pure units (`buildOverlaySvg`, `assembleBundle`, `parseFindings`) carry
 * the contract; `composeOverlayPng` + `emitBundle` are exercised against a
 * synthetic in-memory PNG so no Playwright/Vite boot is needed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs, existsSync } from 'node:fs';
import sharp from 'sharp';
import type { PdfGeometry } from './pdf-geometry.ts';
import type { VerdictRecord } from './layout-match.ts';
import {
  RUBRIC,
  OUTPUT_SCHEMA,
  buildOverlaySvg,
  composeOverlayPng,
  geometryToOverlayBoxes,
  DEFAULT_RASTER_MAP,
  assembleBundle,
  bundleManifest,
  parseFindings,
  judge,
  emitBundle,
  visionOutDir,
  type Finding,
} from './vision-verify.ts';

// A tiny synthetic geometry: three blocks with non-trivial indices so we can
// prove the OVERLAY number tracks the geometry idx (not a 0..n re-count).
const GEOM: PdfGeometry = {
  blocks: [
    { idx: 0, x: 72, y: 72, w: 400, h: 24, fontSize: 24, textSnippet: 'A heading', pageIndex: 0 },
    { idx: 1, x: 72, y: 110, w: 400, h: 60, fontSize: 11, textSnippet: 'A body paragraph', pageIndex: 0 },
    { idx: 2, x: 72, y: 190, w: 400, h: 80, fontSize: 11, textSnippet: 'Why this is hard', pageIndex: 0 },
  ],
  meta: { pageCount: 1, measuredLineHeight: 14, groupingGapPt: 8.4 },
};

const GEOMETRY_CONTEXT: VerdictRecord[] = [
  {
    blockId: 'html-block-2',
    channel: 'html',
    deltaLH: 0.73,
    dyPtAbs: 9.1,
    threshold: { pass: 0.5, fail: 1.0 },
    verdict: 'warn',
    blockType: 'body',
    textSnippet: 'Why this is hard',
    reason: "body 'Why this is hard' gap 2.10 line-heights vs editor 1.37 (Δ 0.73LH — over 0.5LH)",
    gateLevel: 'geometry',
  },
];

// Letter page at 96 DPI: 612pt × 4/3 = 816px wide, 792pt × 4/3 = 1056px per page.
const DIMS = { width: 816, height: 1200 };

describe('vision-verify overlay numbering (shared vocabulary with geometry)', () => {
  it('maps each geometry block to an overlay box that KEEPS its geometry idx', () => {
    const boxes = geometryToOverlayBoxes(GEOM, DIMS);
    expect(boxes.map((b) => b.n)).toEqual([0, 1, 2]);
    // Boxes stay inside the PNG raster.
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(DIMS.width + 1);
      expect(b.y + b.h).toBeLessThanOrEqual(DIMS.height + 1);
    }
    // Document order is preserved: block 0 sits above block 2.
    expect(boxes[0]!.y).toBeLessThan(boxes[2]!.y);
  });

  it('maps PDF points to screenshot pixels by the EXACT fixed scale (not stretch-to-fit)', () => {
    const boxes = geometryToOverlayBoxes(GEOM, DIMS);
    const s = DEFAULT_RASTER_MAP.pxPerPt; // 4/3
    // Block 0 is at x=72, y=72, w=400, h=24 in points, page 0 (no pagination
    // slack) → straight scale by pxPerPt. This is the load-bearing fix: the box
    // must TIGHTLY bound the block, so the geometry pt × scale lands exactly.
    expect(boxes[0]!.x).toBeCloseTo(72 * s, 6);
    expect(boxes[0]!.y).toBeCloseTo(72 * s, 6);
    expect(boxes[0]!.w).toBeCloseTo(400 * s, 6);
    expect(boxes[0]!.h).toBeCloseTo(24 * s, 6);
    // Block 1 at y=110 (page 0) → 110 × scale, no slack subtracted.
    expect(boxes[1]!.y).toBeCloseTo(110 * s, 6);
  });

  it('de-paginates document-y so a page-2 block lands on the continuous screenshot column', () => {
    const { marginPt, pageHeightPt, pxPerPt } = DEFAULT_RASTER_MAP;
    // A block on page 1 (the SECOND page): its stacked document-y carries one
    // page's worth of slack (pageHeightPt) plus its own 72pt top inset. The
    // continuous screenshot has NO page break, so the box must sit at the
    // de-paginated offset = (documentY − 1·2·marginPt) × pxPerPt.
    const docY = pageHeightPt + marginPt; // top of page 2 content, document-y pt.
    const twoPage: PdfGeometry = {
      blocks: [
        { idx: 0, x: 72, y: 72, w: 400, h: 24, fontSize: 24, textSnippet: 'p1', pageIndex: 0 },
        { idx: 1, x: 72, y: docY, w: 400, h: 24, fontSize: 11, textSnippet: 'p2', pageIndex: 1 },
      ],
      meta: { pageCount: 2, measuredLineHeight: 14, groupingGapPt: 8.4 },
    };
    const boxes = geometryToOverlayBoxes(twoPage, { width: 816, height: 4000 });
    const expectedY = (docY - 1 * 2 * marginPt) * pxPerPt;
    expect(boxes[1]!.y).toBeCloseTo(expectedY, 6);
    // And the page-2 block's continuous-y is just one usable content height
    // (792 − 144 = 648pt) below the page-1 top inset — proving the margins were
    // removed, not the raw stacked offset used.
    expect(boxes[1]!.y).toBeCloseTo((648 + 72) * pxPerPt, 6);
  });

  it('draws the geometry index as the badge number in the overlay SVG', () => {
    const boxes = geometryToOverlayBoxes(GEOM, DIMS);
    const svg = buildOverlaySvg(boxes, DIMS);
    // Every geometry index appears as a <text> badge in the SVG.
    expect(svg).toContain('>0</text>');
    expect(svg).toContain('>1</text>');
    expect(svg).toContain('>2</text>');
    // One outline rect + one badge rect + one text per box.
    expect((svg.match(/<text /g) ?? []).length).toBe(3);
  });

  it('composites a VALID PNG with overlays from a synthetic base PNG', async () => {
    const base = await sharp({
      create: { width: DIMS.width, height: DIMS.height, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const boxes = geometryToOverlayBoxes(GEOM, DIMS);
    const overlaid = await composeOverlayPng(base, boxes);
    const meta = await sharp(overlaid).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(DIMS.width);
    expect(meta.height).toBe(DIMS.height);
    // The overlaid PNG must differ from the blank base (overlays were drawn).
    expect(overlaid.equals(base)).toBe(false);
  });
});

describe('vision-verify bundle assembly (rubric + geometry context + schema)', () => {
  const bundle = assembleBundle({
    fixture: 'unit',
    channel: 'html',
    geometryContext: GEOMETRY_CONTEXT,
    editorBoxes: geometryToOverlayBoxes(GEOM, DIMS),
    channelBoxes: geometryToOverlayBoxes(GEOM, DIMS),
    editorPng: Buffer.from('not-a-real-png-editor'),
    channelPng: Buffer.from('not-a-real-png-channel'),
  });

  it('carries the FIXED rubric and the required output schema verbatim', () => {
    expect(bundle.rubric).toBe(RUBRIC);
    expect(bundle.schema).toBe(OUTPUT_SCHEMA);
    expect(bundle.rubric).toContain('match');
    expect(bundle.rubric).toContain('IGNORE');
    expect(bundle.schema).toContain('severity');
  });

  it('embeds the Tier-1 geometry verdict as focus context', () => {
    expect(bundle.geometryContext).toHaveLength(1);
    expect(bundle.geometryContext[0]!.blockId).toBe('html-block-2');
  });

  it('manifest serializes the contract + names the overlay images', () => {
    const m = bundleManifest(bundle) as Record<string, unknown>;
    const json = JSON.stringify(m);
    expect(json).toContain(RUBRIC.slice(0, 30));
    expect(json).toContain('Why this is hard'); // geometry context survived.
    expect(json).toContain('severity'); // schema survived.
    expect((m.images as Record<string, string>).editor).toBe('editor.overlay.png');
    expect((m.images as Record<string, string>).channel).toBe('channel.overlay.png');
  });
});

describe('vision-verify finding parsing (valid in, malformed rejected)', () => {
  it('parses a well-formed model response into Finding[]', () => {
    const raw = JSON.stringify([
      {
        blockRef: 'html-block-2',
        channel: 'html',
        issue: 'lost-callout-tint',
        severity: 'high',
        humanDescription: 'The callout at block 2 lost its tinted background in the HTML render.',
      },
    ]);
    const findings = parseFindings(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('high');
    expect(findings[0]!.blockRef).toBe('html-block-2');
  });

  it('accepts an empty array (perfect parity)', () => {
    expect(parseFindings('[]')).toEqual([]);
  });

  it('unwraps a ```json fenced response', () => {
    const fenced = '```json\n[{"blockRef":"3","channel":"html","issue":"x","severity":"low","humanDescription":"y"}]\n```';
    const findings = parseFindings(fenced);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.blockRef).toBe('3');
  });

  it('REJECTS non-JSON', () => {
    expect(() => parseFindings('I looked at the images and found no issues.')).toThrow(
      /not valid JSON/,
    );
  });

  it('REJECTS a non-array JSON value', () => {
    expect(() => parseFindings('{"blockRef":"1"}')).toThrow(/must be a JSON array/);
  });

  it('REJECTS a finding missing a required field', () => {
    const raw = JSON.stringify([{ blockRef: '1', channel: 'html', issue: 'x', severity: 'low' }]);
    expect(() => parseFindings(raw)).toThrow(/humanDescription/);
  });

  it('REJECTS an invalid severity', () => {
    const raw = JSON.stringify([
      { blockRef: '1', channel: 'html', issue: 'x', severity: 'critical', humanDescription: 'y' },
    ]);
    expect(() => parseFindings(raw)).toThrow(/severity/);
  });
});

describe('vision-verify no-key degrade (emit bundle, never throw)', () => {
  const FIXTURE = 'unit-nokey';
  const CHANNEL = 'html' as const;
  const dir = visionOutDir(FIXTURE, CHANNEL);
  let savedKey: string | undefined;

  beforeAll(() => {
    savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterAll(async () => {
    if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('emits the full bundle and returns the "unavailable" status', async () => {
    const editorPng = await sharp({
      create: { width: 40, height: 40, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const channelPng = await sharp({
      create: { width: 40, height: 40, channels: 3, background: '#eeeeee' },
    })
      .png()
      .toBuffer();
    const bundle = assembleBundle({
      fixture: FIXTURE,
      channel: CHANNEL,
      geometryContext: GEOMETRY_CONTEXT,
      editorBoxes: [{ n: 0, x: 0, y: 0, w: 40, h: 40, textSnippet: 'A' }],
      channelBoxes: [{ n: 0, x: 0, y: 0, w: 40, h: 40, textSnippet: 'A' }],
      editorPng,
      channelPng,
    });

    const result = await judge(bundle);
    expect(result.status).toBe('unavailable');
    expect(result.findings).toEqual([]);
    expect(result.note).toMatch(/external judge/);

    // The bundle artifacts must be on disk for the external judge.
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(`${dir}/editor.overlay.png`)).toBe(true);
    expect(existsSync(`${dir}/channel.overlay.png`)).toBe(true);
    expect(existsSync(`${dir}/prompt.json`)).toBe(true);
    expect(existsSync(`${dir}/schema.json`)).toBe(true);

    // prompt.json carries rubric + geometry context + schema.
    const prompt = JSON.parse(await fs.readFile(`${dir}/prompt.json`, 'utf8')) as {
      rubric: string;
      schema: string;
      geometryContext: VerdictRecord[];
    };
    expect(prompt.rubric).toBe(RUBRIC);
    expect(prompt.schema).toBe(OUTPUT_SCHEMA);
    expect(prompt.geometryContext[0]!.blockId).toBe('html-block-2');
  });

  it('emitBundle is idempotent and returns the target directory', async () => {
    const editorPng = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    const bundle = assembleBundle({
      fixture: FIXTURE,
      channel: CHANNEL,
      geometryContext: [],
      editorBoxes: [],
      channelBoxes: [],
      editorPng,
      channelPng: editorPng,
    });
    const out: string = await emitBundle(bundle);
    expect(out).toBe(dir);
    const findings: Finding[] = parseFindings('[]');
    expect(findings).toEqual([]);
  });
});
