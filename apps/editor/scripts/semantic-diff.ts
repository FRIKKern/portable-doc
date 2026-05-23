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
  closeEditorServer,
} from './lib/render-to-pdf.ts';
import { extractPdfGeometry } from './lib/pdf-geometry.ts';
import {
  pairBlocks,
  computeVerdicts,
  isGatingFailure,
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

// This task runs the HTML channel only; T4 adds 'docx' to this list.
const CHANNELS: Channel[] = ['html'];

type FixtureChannelResult = {
  fixture: string;
  channel: Channel;
  records: VerdictRecord[];
  counts: Record<string, number>;
  gatingFailures: number;
};

/** Render one channel's PDF bytes for a fixture. */
async function renderChannel(channel: Channel, doc: PortableDoc): Promise<Uint8Array> {
  switch (channel) {
    case 'html':
      return renderHtmlChannelToPdf(doc);
    default:
      throw new Error(`channel '${channel}' not wired in T3 (HTML only; DOCX is T4)`);
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
  const [editorPdf, channelPdf] = await Promise.all([
    renderEditorToPdf(doc),
    renderChannel(channel, doc),
  ]);
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
  return { fixture, channel, records, counts, gatingFailures };
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
  const flag = r.gatingFailures > 0 ? 'FAIL' : c.warn || c.orphan ? 'WARN' : 'PASS';
  process.stdout.write(
    `[${flag}] ${r.fixture}/${r.channel}: ` +
      `${r.records.length} blocks · ` +
      `pass ${c.pass} · warn ${c.warn} · fail ${c.fail} · orphan ${c.orphan} · no-text ${c['no-text']} · degenerate ${c.degenerate}\n`,
  );
  // Name the offending blocks so an agent sees them without opening the JSON.
  for (const v of r.records) {
    if (isGatingFailure(v)) process.stdout.write(`         ↳ ${v.verdict.toUpperCase()}: ${v.reason}\n`);
  }
}
process.stdout.write('─'.repeat(78) + '\n');
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
