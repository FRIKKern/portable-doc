/**
 * semantic-diff — the universal-PDF funnel parity verifier (Goal pdoc-r9p / T3).
 *
 * This is the CLEAN REPLACEMENT (bound decision #13) of the broken prototype.
 * The prototype harvested `getBoundingClientRect()` off CDN-loaded preview
 * surfaces (docx-preview / epub.js), which collapsed opaque renderers to a
 * single wrapper div and produced `preview: null` for most blocks. All of that
 * — `harvestBlocks`, the docx-preview/epub.js render path, the pixel-signature
 * fallback, the stale `.papir-check/semantic-diff/result-*.json` output — is
 * gone. There is no parallel run.
 *
 * The pipeline now reads geometry straight from the glyph stream:
 *
 *     fixture.json
 *        │
 *        ├─ renderEditorToPdf ──────┐
 *        └─ render<Channel>ToPdf ───┤   (both → PDF bytes, shared page geometry)
 *                                   ▼
 *                          extractPdfGeometry  ×2   (per-block geometry)
 *                                   ▼
 *                          pairBlocks + computeVerdicts   (layout-match.ts)
 *                                   ▼
 *        .papir-check/geometry/<fixture>-<channel>.json   (verdict records)
 *
 * Each run prints one concise summary line per fixture/channel and exits
 * NON-ZERO if any verdict is a gating failure (`fail` or `no-text` on a
 * geometry-tier channel). The metric is RELATIVE + line-height-normalized, so
 * the display-vs-print scale difference between the editor canvas (~18px) and
 * the HTML export (11pt) cancels — only a genuine vertical-rhythm mismatch
 * fails. This task runs the HTML channel; DOCX lands in T4 via the same
 * `toleranceForChannel` / `gateLevelForChannel` seams.
 *
 * Usage:
 *   pnpm -C apps/editor check:geometry [fixture-name ...]
 *   tsx scripts/semantic-diff.ts funnel-hard welcome
 * Defaults to every fixture under examples/ when no name is given.
 */
import { promises as fs, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve as resolvePath, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PortableDoc } from '@portable-doc/core';
import {
  renderEditorToPdf,
  renderHtmlChannelToPdf,
  renderPdfChannelToPdf,
  renderDocxChannelToPdf,
  renderEpubChannelToPdf,
  closeEditorServer,
} from './lib/render-to-pdf.ts';
import { extractPdfGeometry } from './lib/pdf-geometry.ts';
import {
  pairBlocks,
  computeVerdicts,
  isGatingFailure,
  gateLevelForChannel,
  type Channel,
  type VerdictRecord,
} from './lib/layout-match.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const editorRoot = resolvePath(__dirname, '..');
const repoRoot = resolvePath(__dirname, '..', '..', '..');
const examplesDir = join(repoRoot, 'examples');

// New namespaced output root (bound #13). The stale semantic-diff/ tree is
// removed by hand in this task; this script never writes there again.
const outRoot = join(editorRoot, '.papir-check', 'geometry');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const fixtures =
  args.length > 0
    ? args
    : readdirSync(examplesDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => basename(f, '.json'))
        .sort();

// All wired channels (T4). Per bound decision #7 the GATE level differs by
// channel (see `gateLevelForChannel` in layout-match.ts):
//   html / pdf / docx → geometry tier (a gating failure blocks CI; DOCX runs
//                        at the looser reflow-sanity tolerance, decision #12),
//   epub             → structural tier — geometry runs but is INFORMATIONAL
//                        (reflowable; never gates),
//   markdown         → structural-only with NO geometry render at all (there
//                        is no Markdown exporter and no fixed layout to
//                        measure), surfaced as a structural NOTE below.
// Markdown is intentionally absent from this list — it has no fixed-layout
// render leg; see MARKDOWN_STRUCTURAL_NOTE.
const CHANNELS: Channel[] = ['html', 'pdf', 'docx', 'epub'];

// Markdown carries no fixed layout and the editor ships no Markdown exporter,
// so there is nothing to render to PDF and nothing to geometry-gate. Per the
// bound channel-tier decision (#7) Markdown is structural-only; we surface it
// as a one-line NOTE in the summary rather than running (and gating) a
// geometry leg that would have to be faked.
const MARKDOWN_STRUCTURAL_NOTE =
  'markdown: structural-only (no fixed-layout render, no geometry gate) — reflowable text channel; no Markdown exporter to render';

type FixtureChannelResult = {
  fixture: string;
  channel: Channel;
  records: VerdictRecord[];
  counts: Record<string, number>;
  gatingFailures: number;
  /** Wall-clock ms for the channel render leg — surfaces soffice (DOCX) cost. */
  renderMs: number;
};

/** Render one channel's PDF bytes for a fixture. Every channel ultimately
 *  yields PDF bytes for `extractPdfGeometry`:
 *    html → toHtmlBlob → chromium page.pdf
 *    pdf  → toPdfBlob bytes DIRECTLY (already a PDF; no re-render)
 *    docx → toDocxBlob → soffice --convert-to pdf → bytes
 *    epub → toEpubBlob → unzip → chromium page.pdf of the chapter XHTML
 *  Markdown never reaches here (it has no render leg — see CHANNELS). */
async function renderChannel(channel: Channel, doc: PortableDoc): Promise<Uint8Array> {
  switch (channel) {
    case 'html':
      return renderHtmlChannelToPdf(doc);
    case 'pdf':
      return renderPdfChannelToPdf(doc);
    case 'docx':
      return renderDocxChannelToPdf(doc);
    case 'epub':
      return renderEpubChannelToPdf(doc);
    default:
      throw new Error(`channel '${channel}' has no render leg wired`);
  }
}

function tally(records: VerdictRecord[]): Record<string, number> {
  const c: Record<string, number> = {
    pass: 0,
    warn: 0,
    fail: 0,
    orphan: 0,
    'no-text': 0,
    degenerate: 0,
  };
  for (const r of records) c[r.verdict] = (c[r.verdict] ?? 0) + 1;
  return c;
}

async function runFixtureChannel(
  fixture: string,
  channel: Channel,
  doc: PortableDoc,
): Promise<FixtureChannelResult> {
  // Time the CHANNEL leg specifically so DOCX (soffice — slow + serial) cost
  // is visible in the summary. The editor leg runs in parallel; we attribute
  // the channel render's own wall-clock by timing it independently.
  const channelStart = Date.now();
  const [editorPdf, channelPdf] = await Promise.all([
    renderEditorToPdf(doc),
    renderChannel(channel, doc),
  ]);
  const renderMs = Date.now() - channelStart;
  const [editorGeom, channelGeom] = await Promise.all([
    extractPdfGeometry(editorPdf),
    extractPdfGeometry(channelPdf),
  ]);

  const pairs = pairBlocks(editorGeom.blocks, channelGeom.blocks);
  const records = computeVerdicts(pairs, channel, editorGeom.meta, channelGeom.meta);

  const out = {
    fixture,
    channel,
    generatedAt: new Date().toISOString(),
    editorMeta: editorGeom.meta,
    channelMeta: channelGeom.meta,
    editorBlockCount: editorGeom.blocks.length,
    channelBlockCount: channelGeom.blocks.length,
    records,
  };
  await fs.mkdir(outRoot, { recursive: true });
  await fs.writeFile(
    join(outRoot, `${fixture}-${channel}.json`),
    JSON.stringify(out, null, 2),
  );

  const counts = tally(records);
  const gatingFailures = records.filter(isGatingFailure).length;
  return { fixture, channel, records, counts, gatingFailures, renderMs };
}

// ─── orchestrate ────────────────────────────────────────────────────────────
const results: FixtureChannelResult[] = [];
let hardError = false;

for (const fixture of fixtures) {
  const fixturePath = join(examplesDir, `${fixture}.json`);
  if (!existsSync(fixturePath)) {
    process.stderr.write(`skip ${fixture} (no fixture at ${fixturePath})\n`);
    continue;
  }
  const doc = JSON.parse(readFileSync(fixturePath, 'utf8')) as PortableDoc;
  for (const channel of CHANNELS) {
    try {
      const r = await runFixtureChannel(fixture, channel, doc);
      results.push(r);
    } catch (err) {
      hardError = true;
      process.stderr.write(
        `ERROR ${fixture}/${channel}: ${err instanceof Error ? err.stack || err.message : String(err)}\n`,
      );
    }
  }
}

// ─── summary ──────────────────────────────────────────────────────────────────
process.stdout.write('\nLayout-match geometry verdicts (editor ↔ channel)\n');
process.stdout.write('─'.repeat(78) + '\n');
let totalGating = 0;
for (const r of results) {
  totalGating += r.gatingFailures;
  const c = r.counts;
  const tier = gateLevelForChannel(r.channel);
  // geometry (editor/HTML/PDF) AND reflow-sanity (DOCX) GATE — DOCX is a full
  // geometry gate at a looser threshold (bound #7/#12, parity-trust-boundary).
  // Only `structural` (EPUB / Markdown — reflowable) is informational; an EPUB
  // with warns/fails reads as INFO, never FAIL. Mirror isGatingFailure exactly.
  const gates = tier === 'geometry' || tier === 'reflow-sanity';
  const flag = gates
    ? r.gatingFailures > 0
      ? 'FAIL'
      : c.warn || c.orphan
        ? 'WARN'
        : 'PASS'
    : 'INFO';
  process.stdout.write(
    `[${flag}] ${r.fixture}/${r.channel} (${tier}, ${gates ? 'gating' : 'informational'}): ` +
      `${r.records.length} blocks · ` +
      `pass ${c.pass} · warn ${c.warn} · fail ${c.fail} · orphan ${c.orphan} · no-text ${c['no-text']} · degenerate ${c.degenerate} · ` +
      `render ${(r.renderMs / 1000).toFixed(1)}s\n`,
  );
  // Name the offending blocks so an agent sees them without opening the JSON.
  // On a non-gating (structural/informational) channel these are diagnostics,
  // not failures — label them so the EPUB tier reads honestly.
  for (const v of r.records) {
    if (isGatingFailure(v)) {
      process.stdout.write(`         ↳ ${v.verdict.toUpperCase()}: ${v.reason}\n`);
    } else if (!gates && (v.verdict === 'fail' || v.verdict === 'no-text' || v.verdict === 'degenerate')) {
      process.stdout.write(`         ↳ (info, non-gating) ${v.verdict.toUpperCase()}: ${v.reason}\n`);
    }
  }
}
process.stdout.write('─'.repeat(78) + '\n');
// Structural-only channels with no render leg (Markdown) get a documented note
// rather than a faked geometry run.
process.stdout.write(`note · ${MARKDOWN_STRUCTURAL_NOTE}\n`);
process.stdout.write(
  `${results.length} fixture/channel runs · ${totalGating} gating failure(s) · output → ${outRoot}\n`,
);

// The editor leg boots a shared Vite dev server (render-to-pdf.ts); close it
// so the run can exit promptly rather than waiting on the lingering socket.
await closeEditorServer();

if (hardError) {
  process.stderr.write('\nOne or more runs threw — see ERROR lines above.\n');
  process.exit(2);
}
process.exit(totalGating > 0 ? 1 : 0);
