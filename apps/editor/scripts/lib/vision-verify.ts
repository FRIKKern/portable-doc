/**
 * vision-verify — the TERTIARY, ADVISORY tier of the universal-PDF funnel
 * parity verifier (Goal pdoc-r9p / T7). The human-eye layer.
 *
 *   Tier 1  geometry        (pdf-geometry.ts + layout-match.ts)  HARD GATE
 *   Tier 2  structural      (structural-check.ts)                hard-ish
 *   Tier 3  visual-agent    (THIS MODULE)                        ADVISORY ONLY
 *
 * Tiers 1 and 2 are deterministic and can NAME a divergence by number — a gap
 * that drifted, a block that orphaned. What they cannot name is the class of
 * defect a human notices instantly but no scalar captures: a callout that lost
 * its tint, a heading that came back at body weight, an image squished out of
 * proportion, emphasis that didn't survive the round-trip. This tier renders
 * BOTH sides to PNG with NUMBERED per-block overlays (numbers == Tier-1 block
 * indices, so the model and the geometry verdict share ONE vocabulary), hands a
 * vision model a fixed rubric + the Tier-1 verdict as focus context, and
 * collects structured `Finding[]`.
 *
 * ADVISORY discipline (bound decisions, parent pdoc-r9p `design`):
 *   - This tier NEVER hard-gates CI. The CLI (`pnpm check:vision`) ALWAYS
 *     exits 0, findings or not. It informs a human reviewer; it never blocks.
 *   - Temperature 0 + a fixed rubric so two runs on the same render agree.
 *   - Per-block overlays numbered to the geometry block index.
 *   - Structured finding schema, validated on the way in.
 *
 * Pluggable judge / graceful degrade (environment constraint, T7):
 *   The live vision call is a pluggable adapter. When `ANTHROPIC_API_KEY` is
 *   set we lazy-import `@anthropic-ai/sdk` and call Claude at temperature 0.
 *   When it is NOT set (or the SDK is not installed) we DO NOT fail — we WRITE
 *   the whole judge bundle (overlay PNGs + prompt.json + geometry context +
 *   the schema) to `.papir-check/vision/<fixture>-<channel>/` and return an
 *   "unavailable — bundle emitted for external judge" status with `[]`
 *   findings. An external judge (e.g. a Claude Code vision subagent) then runs
 *   on the emitted artifacts.
 *
 * Heavy deps (`sharp`, `playwright`) and the optional `@anthropic-ai/sdk` are
 * all lazy-imported so the pure mechanics (overlay-SVG, bundle assembly,
 * finding parsing) — and the deterministic test — load without them.
 */
import { promises as fs } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PortableDoc } from '@portable-doc/core';
import type { PdfBlock, PdfGeometry } from './pdf-geometry.ts';
import type { Channel, VerdictRecord } from './layout-match.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/lib → apps/editor.
const editorAppRoot = resolvePath(__dirname, '..', '..');

// ─── public types ─────────────────────────────────────────────────────────────

/** One overlay box: a numbered rectangle drawn on a rendered PNG. The `n` is
 *  the geometry block index (Tier-1 `PdfBlock.idx`) so the number the model
 *  sees on the page is the same number the geometry verdict speaks. */
export type OverlayBox = {
  /** Geometry block index — the SHARED vocabulary across tiers. */
  n: number;
  /** Left edge in PNG pixels. */
  x: number;
  /** Top edge in PNG pixels. */
  y: number;
  /** Width in PNG pixels. */
  w: number;
  /** Height in PNG pixels. */
  h: number;
  /** First ~40 chars of the block's text — for the bundle manifest only. */
  textSnippet: string;
};

/** A single human-eye finding the model returns. The schema the model is told
 *  to emit (and that `parseFindings` validates) is exactly this, minus the
 *  derived fields the harness never asks the model for. */
export type Finding = {
  /** Which numbered block — `"<channel>-block-<n>"` or a bare integer string.
   *  Ties the prose finding back to the overlay number / geometry index. */
  blockRef: string;
  channel: Channel;
  /** One-line machine tag for the defect class. */
  issue: string;
  severity: 'low' | 'med' | 'high';
  /** The sentence a human reviewer would say looking at the two renders. */
  humanDescription: string;
};

/** The judge's outcome. ADVISORY: `status` is informational, never a gate. */
export type JudgeStatus = 'judged' | 'unavailable';

export type JudgeResult = {
  status: JudgeStatus;
  findings: Finding[];
  /** Human-readable note — e.g. why the judge was unavailable. */
  note: string;
};

/** Everything a vision judge needs for ONE fixture×channel comparison. The
 *  no-key path serializes this (minus the raw PNG buffers, which are written
 *  as files) to disk for an external judge. */
export type JudgeBundle = {
  fixture: string;
  channel: Channel;
  /** The fixed rubric — identical across every run (temperature-0 contract). */
  rubric: string;
  /** The required OUTPUT SCHEMA, described to the model in prose + a JSON
   *  shape it must conform to. */
  schema: string;
  /** Tier-1 geometry verdict records for this fixture×channel — focus context
   *  so the model looks where the deterministic tiers already flagged drift. */
  geometryContext: VerdictRecord[];
  /** Overlay box manifests, so a bundle reader knows what each number is. */
  editorBoxes: OverlayBox[];
  channelBoxes: OverlayBox[];
  /** PNG buffers with numbered overlays drawn on. Not serialized into
   *  prompt.json — written as sibling .png files by the no-key path. */
  editorPng: Buffer;
  channelPng: Buffer;
};

// ─── the fixed rubric + schema (the temperature-0 contract) ─────────────────────

/**
 * The fixed rubric. NEVER edit this per-run — its stability is what lets two
 * temperature-0 runs on the same render agree. It tells the model precisely
 * what to look for and, just as importantly, what to IGNORE (the sub-pixel /
 * zoom noise that Tier 1 already cancels via line-height normalization).
 */
export const RUBRIC = [
  'You are the human-eye tier of a document-parity verifier.',
  'You are given TWO renders of the SAME document: the EDITOR render (the source',
  'of truth the writer sees) and the CHANNEL render (one export channel). Both',
  'carry NUMBERED rectangles; a given number marks the SAME logical block on both',
  'images. Your job is to verify the CHANNEL render matches the EDITOR render 1:1.',
  '',
  'Report ONLY divergences a human reviewer would notice at a glance:',
  '  - a callout/admonition that lost its tint or border,',
  '  - a wrong font weight (a heading rendered at body weight, lost bold),',
  '  - broken visual hierarchy (a subheading that no longer reads as subordinate),',
  '  - a squished, stretched, or overflowing image,',
  '  - a table that reads wrong (collapsed columns, lost header emphasis, merged rows),',
  '  - emphasis (bold / italic / code) that did not survive.',
  '',
  'IGNORE entirely: anti-aliasing, sub-pixel positioning, overall zoom/scale',
  'differences, and absolute vertical position — the editor renders at screen',
  'scale and the channel at print scale, so a uniform size difference is EXPECTED',
  'and is NOT a defect. Only report things that change what the document MEANS or',
  'how a reader would perceive its structure.',
  '',
  'You are also given the deterministic geometry verdict for this comparison as',
  'CONTEXT — use it to focus your attention on blocks the geometry tier already',
  'flagged, but you may also report a defect the geometry tier could not name.',
].join('\n');

/**
 * The required output schema, described to the model. Kept as a string so it
 * travels in the bundle verbatim and the no-key path can hand an external
 * judge the exact contract.
 */
export const OUTPUT_SCHEMA = [
  'Respond with ONLY a JSON array (no prose, no markdown fence). Each element:',
  '{',
  '  "blockRef": string,        // the numbered block, e.g. "html-block-3" or "3"',
  '  "channel": string,         // the channel under test (echo it back)',
  '  "issue": string,           // short machine tag, e.g. "lost-callout-tint"',
  '  "severity": "low"|"med"|"high",',
  '  "humanDescription": string // one sentence a reviewer would say',
  '}',
  'If the two renders match 1:1 with no human-noticeable divergence, respond with',
  'an empty array: []',
].join('\n');

// ─── overlay drawing (pure) ─────────────────────────────────────────────────────

/** PNG raster dimensions, needed to clamp overlay boxes inside the image. */
export type PngDims = { width: number; height: number };

const SEVERITY_VALUES: ReadonlySet<string> = new Set(['low', 'med', 'high']);

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build an SVG overlay layer: one numbered rectangle per box. PURE — no I/O,
 * no sharp. `composeOverlayPng` rasterizes + composites it; the test asserts
 * the SVG carries the right numbers without touching a browser or sharp.
 *
 * Each rect is clamped to the image so a box read slightly off-canvas (a
 * trailing glyph past the right margin) does not produce an invalid SVG.
 */
export function buildOverlaySvg(boxes: OverlayBox[], dims: PngDims): string {
  const { width, height } = dims;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  ];
  for (const b of boxes) {
    const x = Math.max(0, Math.min(b.x, width));
    const y = Math.max(0, Math.min(b.y, height));
    const w = Math.max(1, Math.min(b.w, width - x));
    const h = Math.max(1, Math.min(b.h, height - y));
    // The rectangle outlines the block; the badge carries the geometry index.
    parts.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" ` +
        `fill="none" stroke="#e0218a" stroke-width="2" />`,
    );
    // Number badge anchored to the block's top-left, nudged inward so it sits
    // on the block rather than off the page edge.
    const bx = Math.min(x + 2, width - 26);
    const by = Math.min(y + 2, height - 18);
    parts.push(
      `<rect x="${bx}" y="${by}" width="24" height="16" fill="#e0218a" />`,
    );
    parts.push(
      `<text x="${bx + 12}" y="${by + 12}" font-family="monospace" font-size="12" ` +
        `fill="#ffffff" text-anchor="middle">${escapeXml(String(b.n))}</text>`,
    );
  }
  parts.push('</svg>');
  return parts.join('');
}

/**
 * Composite the numbered-overlay SVG onto a PNG. Lazy-imports `sharp` so the
 * pure mechanics load without it. Returns the overlaid PNG bytes.
 */
export async function composeOverlayPng(
  pngBuffer: Buffer,
  boxes: OverlayBox[],
): Promise<Buffer> {
  const sharpMod = await import('sharp');
  const sharp = (sharpMod as { default: typeof import('sharp') }).default ?? sharpMod;
  const base = sharp(pngBuffer);
  const meta = await base.metadata();
  const dims: PngDims = {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };
  const svg = buildOverlaySvg(boxes, dims);
  return base
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

// ─── geometry → overlay boxes ───────────────────────────────────────────────────

/**
 * The fixed pt→px map that ties geometry coordinates to the captured PNG
 * (pdoc-7fq fix). The PNG is captured at a viewport width pinned to the PDF
 * page width and at `deviceScaleFactor: 1`, so a single uniform scale converts
 * PDF user-space points to screenshot CSS pixels. `render-to-png.ts` derives
 * these from `PDF_PAGE` and exports them as `RASTER`; the defaults here are the
 * US-Letter / 1-inch-margin values so the pure unit test can construct a map
 * without importing the render module.
 */
export type RasterMap = {
  /** CSS px per PDF point (96 DPI screenshot / 72 DPI PDF). */
  pxPerPt: number;
  /** Page top/bottom margin in points — the per-page slack the screenshot does
   *  NOT reinsert at page breaks, so it is removed during de-pagination. */
  marginPt: number;
  /** PDF page height in points (Letter = 792). */
  pageHeightPt: number;
  /** The screenshot's measured CONTENT ORIGIN in pixels (top-left of the first
   *  laid out content element). The overlay map is anchored here so a surface's
   *  own body padding — which differs from the PDF's 1-inch margin — does not
   *  bias the boxes. Defaults to the nominal margin corner when unmeasured. */
  contentOrigin?: { x: number; y: number };
};

export const DEFAULT_RASTER_MAP: RasterMap = {
  pxPerPt: 96 / 72,
  marginPt: 72,
  pageHeightPt: 792,
};

/** De-paginate a stacked-page document-y to a continuous-flow document-y:
 *  every page break re-inserted one bottom-margin + one top-margin
 *  (`2·marginPt`) the continuous screenshot never had, so strip them. */
function depaginate(documentY: number, pageIndex: number, marginPt: number): number {
  return documentY - pageIndex * 2 * marginPt;
}

/**
 * Map per-block PDF geometry to overlay boxes in the captured PNG's pixel
 * space, preserving the geometry block index as the overlay number.
 *
 * The geometry blocks live on a STACKED-PAGE document-y axis: page p's content
 * occupies document-y `[p·H, (p+1)·H]` (top-left origin, PDF points), and each
 * page carries top+bottom margins (`marginPt` each). A `page.pdf()` PAGINATES
 * the flow; the full-page screenshot captures that SAME flow as ONE continuous
 * column with NO page breaks and NO repeated margins.
 *
 * The map is built RELATIVE to the first block, anchored to the screenshot's
 * MEASURED content origin (`raster.contentOrigin`):
 *   - de-paginate each block's document-y (strip the page-break margin slack),
 *   - express it as an offset from the FIRST block's de-paginated top-left,
 *   - scale that offset by `pxPerPt`, and add the measured content origin.
 *
 * This is EXACT, not a stretch-to-fit: block widths/heights scale by the fixed
 * pt→px ratio (so the rectangles bound the blocks tightly), and the per-surface
 * body-padding bias (the editor canvas vs. the portable reader use different
 * leading, so neither sits exactly at the PDF's 1-inch margin) is removed by
 * anchoring block 0 to its measured pixel position. When `contentOrigin` is
 * absent, we fall back to the nominal margin corner (`marginPt · pxPerPt`),
 * which is what the pure unit test exercises. Boxes are clamped to the raster by
 * `buildOverlaySvg` downstream; the geometry INDEX (the number) is exact.
 */
export function geometryToOverlayBoxes(
  geom: PdfGeometry,
  dims: PngDims,
  raster: RasterMap = DEFAULT_RASTER_MAP,
): OverlayBox[] {
  const blocks = geom.blocks;
  if (blocks.length === 0 || dims.width === 0 || dims.height === 0) return [];

  const { pxPerPt, marginPt } = raster;
  const first = blocks[0]!;
  // Geometry-space anchor = the first block's top-left (de-paginated y).
  const anchorPtX = first.x;
  const anchorPtY = depaginate(first.y, first.pageIndex, marginPt);
  // Pixel-space anchor = the measured content origin, or the nominal margin
  // corner when unmeasured (pure-unit fallback).
  const originPx = raster.contentOrigin ?? { x: marginPt * pxPerPt, y: marginPt * pxPerPt };

  return blocks.map((b: PdfBlock) => {
    const depagY = depaginate(b.y, b.pageIndex, marginPt);
    return {
      n: b.idx,
      x: originPx.x + (b.x - anchorPtX) * pxPerPt,
      y: originPx.y + (depagY - anchorPtY) * pxPerPt,
      w: b.w * pxPerPt,
      h: b.h * pxPerPt,
      textSnippet: b.textSnippet,
    };
  });
}

// ─── bundle assembly (pure) ─────────────────────────────────────────────────────

/**
 * Assemble the judge bundle for one fixture×channel. PURE — the caller renders
 * the PNGs and extracts geometry; this just composes the prompt contract +
 * focus context + box manifests. The rubric + schema are the fixed constants;
 * the geometry verdict records are the per-comparison focus.
 */
export function assembleBundle(input: {
  fixture: string;
  channel: Channel;
  geometryContext: VerdictRecord[];
  editorBoxes: OverlayBox[];
  channelBoxes: OverlayBox[];
  editorPng: Buffer;
  channelPng: Buffer;
}): JudgeBundle {
  return {
    fixture: input.fixture,
    channel: input.channel,
    rubric: RUBRIC,
    schema: OUTPUT_SCHEMA,
    geometryContext: input.geometryContext,
    editorBoxes: input.editorBoxes,
    channelBoxes: input.channelBoxes,
    editorPng: input.editorPng,
    channelPng: input.channelPng,
  };
}

/** The serializable view of a bundle — what lands in prompt.json (no raw PNG
 *  bytes; those are written as sibling files). */
export function bundleManifest(bundle: JudgeBundle): Record<string, unknown> {
  return {
    fixture: bundle.fixture,
    channel: bundle.channel,
    rubric: bundle.rubric,
    schema: bundle.schema,
    geometryContext: bundle.geometryContext,
    editorBoxes: bundle.editorBoxes,
    channelBoxes: bundle.channelBoxes,
    images: {
      editor: 'editor.overlay.png',
      channel: 'channel.overlay.png',
    },
    instructions:
      'Open editor.overlay.png and channel.overlay.png. Apply the rubric. ' +
      'Emit findings.json conforming to the schema. This tier is ADVISORY.',
  };
}

// ─── finding parsing (pure) ─────────────────────────────────────────────────────

/**
 * Parse + VALIDATE a raw model response into `Finding[]`. Throws on anything
 * malformed so a garbled response never silently becomes "no findings". Accepts
 * a JSON array, optionally wrapped in a ```json fence (models occasionally
 * fence despite the schema instruction). Each element must carry the four
 * required fields with the right types and a valid severity.
 */
export function parseFindings(raw: string): Finding[] {
  const trimmed = stripFence(raw).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `vision judge response is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error('vision judge response must be a JSON array of findings');
  }
  return parsed.map((el, i) => validateFinding(el, i));
}

function stripFence(s: string): string {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fence ? (fence[1] ?? '') : s;
}

function validateFinding(el: unknown, i: number): Finding {
  if (typeof el !== 'object' || el === null) {
    throw new Error(`finding[${i}] is not an object`);
  }
  const o = el as Record<string, unknown>;
  for (const field of ['blockRef', 'channel', 'issue', 'humanDescription'] as const) {
    if (typeof o[field] !== 'string' || (o[field] as string).length === 0) {
      throw new Error(`finding[${i}].${field} must be a non-empty string`);
    }
  }
  if (typeof o.severity !== 'string' || !SEVERITY_VALUES.has(o.severity)) {
    throw new Error(
      `finding[${i}].severity must be one of low|med|high (got ${JSON.stringify(o.severity)})`,
    );
  }
  return {
    blockRef: o.blockRef as string,
    channel: o.channel as Channel,
    issue: o.issue as string,
    severity: o.severity as Finding['severity'],
    humanDescription: o.humanDescription as string,
  };
}

// ─── judge adapter (live SDK / graceful degrade) ────────────────────────────────

/** Where bundles + findings land. `.papir-check/` is gitignored. */
export function visionOutDir(fixture: string, channel: Channel): string {
  return join(editorAppRoot, '.papir-check', 'vision', `${fixture}-${channel}`);
}

/**
 * Write the full judge bundle to disk for an EXTERNAL judge: the two overlay
 * PNGs, prompt.json (rubric + schema + geometry context + box manifests), and
 * a standalone schema.json. Returns the directory written.
 */
export async function emitBundle(bundle: JudgeBundle): Promise<string> {
  const dir = visionOutDir(bundle.fixture, bundle.channel);
  await fs.mkdir(dir, { recursive: true });
  await Promise.all([
    fs.writeFile(join(dir, 'editor.overlay.png'), bundle.editorPng),
    fs.writeFile(join(dir, 'channel.overlay.png'), bundle.channelPng),
    fs.writeFile(join(dir, 'prompt.json'), JSON.stringify(bundleManifest(bundle), null, 2)),
    fs.writeFile(join(dir, 'schema.json'), JSON.stringify({ schema: bundle.schema }, null, 2)),
  ]);
  return dir;
}

/**
 * The judge adapter. If `ANTHROPIC_API_KEY` is set AND `@anthropic-ai/sdk` is
 * installed, call Claude at temperature 0 with the two overlay images and parse
 * the JSON response into `Finding[]`. Otherwise EMIT the bundle for an external
 * judge and return `{ status: 'unavailable', findings: [] }`. Either path is
 * non-throwing for the no-key case — the only throws are a malformed LIVE
 * response (so a garbled judgment is loud, not silent).
 */
export async function judge(bundle: JudgeBundle): Promise<JudgeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const dir = await emitBundle(bundle);
    return {
      status: 'unavailable',
      findings: [],
      note: `judge unavailable (no ANTHROPIC_API_KEY) — bundle emitted for external judge at ${dir}`,
    };
  }

  type AnthropicCtor = new (opts: { apiKey: string }) => {
    messages: {
      create: (req: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }>;
    };
  };
  let Anthropic: AnthropicCtor;
  try {
    // Lazy + OPTIONAL: never a hard dependency, and never present in the build
    // graph. The specifier is assembled at runtime so Vite/Rollup's static
    // import-analysis can't try to resolve a package that isn't installed; if
    // it IS installed and a key is set, this loads it on demand. If it's
    // missing we degrade to the emit path exactly as the no-key case does.
    const sdkSpecifier = ['@anthropic-ai', 'sdk'].join('/');
    const mod = (await import(/* @vite-ignore */ sdkSpecifier)) as { default: AnthropicCtor };
    Anthropic = mod.default;
  } catch {
    const dir = await emitBundle(bundle);
    return {
      status: 'unavailable',
      findings: [],
      note: `@anthropic-ai/sdk not installed — bundle emitted for external judge at ${dir}`,
    };
  }

  const client = new Anthropic({ apiKey });
  const userText = [
    bundle.rubric,
    '',
    `Channel under test: ${bundle.channel}`,
    `Fixture: ${bundle.fixture}`,
    '',
    'Tier-1 geometry verdict (focus context):',
    JSON.stringify(bundle.geometryContext, null, 2),
    '',
    bundle.schema,
  ].join('\n');

  const MODEL = 'claude-opus-4-7';
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'EDITOR render (source of truth):' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: bundle.editorPng.toString('base64'),
            },
          },
          { type: 'text', text: `CHANNEL render (${bundle.channel}):` },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: bundle.channelPng.toString('base64'),
            },
          },
          { type: 'text', text: userText },
        ],
      },
    ],
  });

  const text = message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
  const findings = parseFindings(text);
  // Persist the bundle the judgment was made on AND the findings.
  const dir = await emitBundle(bundle);
  await fs.writeFile(join(dir, 'findings.json'), JSON.stringify(findings, null, 2));
  return {
    status: 'judged',
    findings,
    note: `judged by ${MODEL} at temperature 0 — ${findings.length} finding(s)`,
  };
}

// ─── per-fixture×channel render + verify (orchestration) ────────────────────────

export type VisionRenderResult = {
  fixture: string;
  channel: Channel;
  result: JudgeResult;
  outDir: string;
};

/**
 * Render the editor + channel of a fixture to PNG with numbered overlays whose
 * numbers ARE the Tier-1 geometry block indices, assemble the bundle, run the
 * judge, and persist any findings. Lazy-imports the heavy render path so the
 * pure mechanics + the test load without Playwright/Vite.
 *
 * Reuses the SAME live-editor / channel render path as the geometry tier: we
 * render each side to PDF (for geometry, the shared vocabulary) AND screenshot
 * each side to PNG (for the human-eye overlay). The geometry extraction gives
 * the block indices; the screenshot gives the pixels the overlay is drawn on.
 */
export async function runVisionVerify(
  fixture: string,
  channel: Channel,
  doc: PortableDoc,
  geometryContext: VerdictRecord[],
): Promise<VisionRenderResult> {
  const [{ renderEditorToPng, renderHtmlChannelToPng, RASTER }, { extractPdfGeometry }] =
    await Promise.all([
      import('./render-to-png.ts'),
      import('./pdf-geometry.ts'),
    ]);

  // The pt→px map derived from the shared PDF_PAGE geometry — both legs are
  // captured under it (same width, deviceScaleFactor 1). The contentOrigin is
  // per-side (each surface's body padding differs), so each leg gets its own.
  const baseRaster = {
    pxPerPt: RASTER.pxPerPt,
    marginPt: RASTER.marginPt,
    pageHeightPt: RASTER.pageHeightPt,
  };

  const [editorRender, channelRender] = await Promise.all([
    renderEditorToPng(doc),
    channel === 'html'
      ? renderHtmlChannelToPng(doc)
      : Promise.reject(new Error(`vision tier wired for 'html' only (got '${channel}')`)),
  ]);

  const [editorGeom, channelGeom] = await Promise.all([
    extractPdfGeometry(editorRender.pdf),
    extractPdfGeometry(channelRender.pdf),
  ]);

  const editorBoxes = geometryToOverlayBoxes(editorGeom, editorRender.dims, {
    ...baseRaster,
    contentOrigin: editorRender.contentOrigin,
  });
  const channelBoxes = geometryToOverlayBoxes(channelGeom, channelRender.dims, {
    ...baseRaster,
    contentOrigin: channelRender.contentOrigin,
  });

  const [editorPng, channelPng] = await Promise.all([
    composeOverlayPng(editorRender.png, editorBoxes),
    composeOverlayPng(channelRender.png, channelBoxes),
  ]);

  const bundle = assembleBundle({
    fixture,
    channel,
    geometryContext,
    editorBoxes,
    channelBoxes,
    editorPng,
    channelPng,
  });

  const result = await judge(bundle);
  const outDir = visionOutDir(fixture, channel);
  return { fixture, channel, result, outDir };
}
