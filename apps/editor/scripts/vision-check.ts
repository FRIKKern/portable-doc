/**
 * vision-check — CLI for the ADVISORY visual-agent tier (Goal pdoc-r9p / T7).
 *
 *     pnpm -C apps/editor check:vision [fixture-name ...]
 *     tsx scripts/vision-check.ts with-images exhaustive
 *
 * For each fixture×channel it renders the editor + channel to PNG with NUMBERED
 * per-block overlays (numbers == Tier-1 geometry block indices), loads the
 * Tier-1 geometry verdict for the same fixture×channel as focus context, and
 * runs the pluggable vision judge:
 *   - ANTHROPIC_API_KEY set + SDK present → live Claude call at temperature 0;
 *   - otherwise → emit the full bundle (overlay PNGs + prompt.json + schema)
 *     to `.papir-check/vision/<fixture>-<channel>/` for an external judge.
 *
 * ADVISORY: this script ALWAYS exits 0. It NEVER gates CI. It informs a human
 * reviewer; deterministic gating belongs to the geometry (T3) and structural
 * tiers. Findings, when present, are written to findings.json and surfaced.
 *
 * Defaults to every fixture under examples/ when no name is given.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PortableDoc } from '@portable-doc/core';
import type { Channel, VerdictRecord } from './lib/layout-match.ts';
import { closeEditorServer } from './lib/render-to-pdf.ts';
import { runVisionVerify } from './lib/vision-verify.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const editorRoot = resolvePath(__dirname, '..');
const repoRoot = resolvePath(__dirname, '..', '..', '..');
const examplesDir = join(repoRoot, 'examples');
const geometryDir = join(editorRoot, '.papir-check', 'geometry');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const fixtures =
  args.length > 0
    ? args
    : readdirSync(examplesDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => basename(f, '.json'))
        .sort();

// This tier runs the HTML channel (matches T3's wired channel).
const CHANNELS: Channel[] = ['html'];

/** Load the Tier-1 geometry verdict records for a fixture×channel as focus
 *  context. Missing geometry output is non-fatal — the judge still runs, just
 *  without the focus hints. */
function loadGeometryContext(fixture: string, channel: Channel): VerdictRecord[] {
  const p = join(geometryDir, `${fixture}-${channel}.json`);
  if (!existsSync(p)) return [];
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as { records?: VerdictRecord[] };
    return parsed.records ?? [];
  } catch {
    return [];
  }
}

process.stdout.write('\nVisual-agent advisory tier (editor ↔ channel, ADVISORY — never gates)\n');
process.stdout.write('─'.repeat(78) + '\n');

for (const fixture of fixtures) {
  const fixturePath = join(examplesDir, `${fixture}.json`);
  if (!existsSync(fixturePath)) {
    process.stderr.write(`skip ${fixture} (no fixture at ${fixturePath})\n`);
    continue;
  }
  const doc = JSON.parse(readFileSync(fixturePath, 'utf8')) as PortableDoc;
  for (const channel of CHANNELS) {
    try {
      const geometryContext = loadGeometryContext(fixture, channel);
      const { result, outDir } = await runVisionVerify(fixture, channel, doc, geometryContext);
      const flag = result.status === 'judged' ? 'JUDGED' : 'EMITTED';
      process.stdout.write(
        `[${flag}] ${fixture}/${channel}: ${result.findings.length} finding(s) · ` +
          `geometry-context ${geometryContext.length} record(s) · ${result.note}\n`,
      );
      for (const f of result.findings) {
        process.stdout.write(
          `         ↳ ${f.severity.toUpperCase()} ${f.blockRef} [${f.issue}]: ${f.humanDescription}\n`,
        );
      }
      if (result.status !== 'judged') {
        process.stdout.write(`         ↳ bundle → ${outDir}\n`);
      }
    } catch (err) {
      // ADVISORY: a render/judge error is reported but does NOT fail the run.
      process.stderr.write(
        `WARN ${fixture}/${channel}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

process.stdout.write('─'.repeat(78) + '\n');
process.stdout.write('ADVISORY tier complete — this gate never blocks CI (exit 0).\n');

await closeEditorServer();
// ADVISORY: ALWAYS exit 0. Findings inform a human; they never gate.
process.exit(0);
