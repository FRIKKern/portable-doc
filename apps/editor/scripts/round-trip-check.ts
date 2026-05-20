/**
 * round-trip-check — informational fidelity harness for C4 of pdoc-un3.
 *
 * For each fixture × each round-trip channel (docx, html, md), it:
 *   1. Loads the fixture AST from /examples
 *   2. Exports it through the channel (toDocxBlob / toHtmlBlob /
 *      serializeMarkdown + encodeEnvelopeComment + inject)
 *   3. Re-imports via the corresponding extractor (extractFromDocx /
 *      extractFromHtml / extractFromMd)
 *   4. Walks both ASTs in parallel and records every field-level discrepancy
 *      as `{ fixture, channel, path, expected, actual, severity }`
 *
 * Severity:
 *   - 'loss'          field present in source but absent / different post-trip
 *   - 'normalization' a known, intentional rewrite (none expected for the
 *                     envelope path — kept as a slot for future surface-based
 *                     round-trips that don't carry an envelope)
 *
 * The envelope-based round-trip is lossless by construction (the full AST
 * rides inside customXml / <script> / gzip+base64 comment). So a clean run
 * prints zero diffs. The visible-surface losses (callout→blockquote in MD,
 * etc.) are documented in the loss table below, NOT in the diffs — they only
 * matter when the envelope is stripped, which is out of scope for this check.
 *
 * Output:
 *   stdout: loss table
 *   file:   apps/editor/.papir-check/round-trip-check.json
 *
 * Exit 0 always — this is informational, like structural-check is gated.
 *
 * Usage:
 *   pnpm -C apps/editor check:roundtrip
 *   tsx scripts/round-trip-check.ts
 */
import { promises as fs, readFileSync } from 'node:fs';
import { join, resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PortableDoc } from '@portable-doc/core';
import { toDocxBlob } from '../src/export/toDocx.ts';
import { toHtmlBlob } from '../src/export/toHtml.ts';
import {
  encodeEnvelopeComment,
  injectEnvelopeIntoMarkdown,
  serializeMarkdown,
} from '../src/ExportMenu.tsx';
import { envelopeSchema, type Envelope } from '@portable-doc/core';
import { extractFromDocx } from '../src/import/fromDocx.ts';
import { extractFromMd } from '../src/import/fromMd.ts';

// fromHtml.ts uses DOMParser, which is unavailable in bare Node. The
// production extractor is exercised by fromHtml.test.ts (happy-dom env).
// Here we duplicate the read path with a regex — it pulls the JSON out of
// `<script type="application/portable-doc+json" id="papir-envelope">…</script>`
// and runs the same envelopeSchema validation.
const HTML_SCRIPT_RE =
  /<script[^>]*type=["']application\/portable-doc\+json["'][^>]*>([\s\S]*?)<\/script>/i;

async function extractFromHtml(text: string): Promise<Envelope | null> {
  const m = text.match(HTML_SCRIPT_RE);
  if (!m || !m[1]) return null;
  const trimmed = m[1].trim();
  if (trimmed.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const result = envelopeSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const editorRoot = resolvePath(__dirname, '..');
const repoRoot = resolvePath(__dirname, '..', '..', '..');

const FIXTURE_NAMES = [
  'welcome',
  'incident',
  'exhaustive',
  'nested-callouts',
  'with-images',
  'tables-and-code',
] as const;
type FixtureName = (typeof FIXTURE_NAMES)[number];

const CHANNELS = ['docx', 'html', 'md'] as const;
type Channel = (typeof CHANNELS)[number];

type Severity = 'loss' | 'normalization';

interface Diff {
  fixture: FixtureName;
  channel: Channel;
  path: string;
  expected: unknown;
  actual: unknown;
  severity: Severity;
}

// ---------------------------------------------------------------------------
// Channel round-trip helpers — export then re-extract; return the recovered
// AST or null on failure (envelope missing / schema reject).
// ---------------------------------------------------------------------------

async function roundTripDocx(doc: PortableDoc): Promise<unknown | null> {
  const blob = await toDocxBlob(doc);
  const env = await extractFromDocx(await blob.arrayBuffer());
  return env ? env.ast : null;
}

async function roundTripHtml(doc: PortableDoc): Promise<unknown | null> {
  const blob = await toHtmlBlob(doc);
  const env = await extractFromHtml(await blob.text());
  return env ? env.ast : null;
}

async function roundTripMd(doc: PortableDoc): Promise<unknown | null> {
  const md = serializeMarkdown(doc);
  const comment = await encodeEnvelopeComment(doc);
  const withEnvelope = injectEnvelopeIntoMarkdown(md, comment);
  const env = await extractFromMd(withEnvelope);
  return env ? env.ast : null;
}

// ---------------------------------------------------------------------------
// Diff walker — parallel descent over expected vs actual, collecting one
// row per leaf discrepancy. Keeps paths in a JSONPath-like shape:
//   blocks[3].variant.emphasis    blocks[2].content[0].value
// ---------------------------------------------------------------------------

function diffAst(
  expected: unknown,
  actual: unknown,
  fixture: FixtureName,
  channel: Channel,
  path = '$',
  out: Diff[] = [],
): Diff[] {
  if (expected === actual) return out;

  // Primitives or null/undefined leaf-level mismatch.
  if (
    expected === null ||
    actual === null ||
    typeof expected !== 'object' ||
    typeof actual !== 'object'
  ) {
    out.push({
      fixture,
      channel,
      path,
      expected,
      actual,
      severity: actual === undefined ? 'loss' : 'normalization',
    });
    return out;
  }

  // Arrays: walk by index. Surface length mismatch as one row, then descend
  // through the shared prefix.
  if (Array.isArray(expected) || Array.isArray(actual)) {
    const ea = Array.isArray(expected) ? expected : [];
    const aa = Array.isArray(actual) ? actual : [];
    if (ea.length !== aa.length) {
      out.push({
        fixture,
        channel,
        path: `${path}.length`,
        expected: ea.length,
        actual: aa.length,
        severity: aa.length < ea.length ? 'loss' : 'normalization',
      });
    }
    const n = Math.min(ea.length, aa.length);
    for (let i = 0; i < n; i++) {
      diffAst(ea[i], aa[i], fixture, channel, `${path}[${i}]`, out);
    }
    return out;
  }

  // Objects: union of keys; missing-on-actual ⇒ loss, extra-on-actual ⇒
  // normalization (added field).
  const eo = expected as Record<string, unknown>;
  const ao = actual as Record<string, unknown>;
  const keys = new Set([...Object.keys(eo), ...Object.keys(ao)]);
  for (const k of keys) {
    const sub = `${path}.${k}`;
    if (!(k in ao)) {
      out.push({
        fixture,
        channel,
        path: sub,
        expected: eo[k],
        actual: undefined,
        severity: 'loss',
      });
      continue;
    }
    if (!(k in eo)) {
      out.push({
        fixture,
        channel,
        path: sub,
        expected: undefined,
        actual: ao[k],
        severity: 'normalization',
      });
      continue;
    }
    diffAst(eo[k], ao[k], fixture, channel, sub, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Static loss table — the documented, channel-level summary. These are the
// surface-level losses for renderers that DON'T carry the envelope (i.e. if
// someone strips customXml + docProps in DOCX, or strips the <script> from
// HTML, or strips the comment from MD). With envelope present, all three are
// lossless.
// ---------------------------------------------------------------------------

const LOSS_TABLE: Record<
  Channel,
  { survives: string; normalizes: string; loses: string }
> = {
  docx: {
    survives: 'all AST fields (envelope path)',
    normalizes: '(none with envelope)',
    loses: '(none with envelope) | surface: table cell merges',
  },
  html: {
    survives: 'all AST fields (envelope path)',
    normalizes: '(none with envelope)',
    loses: '(none with envelope) | surface: image bytes for https:// sources',
  },
  md: {
    survives: 'all AST fields (envelope path)',
    normalizes: '(none with envelope)',
    loses:
      '(none with envelope) | surface: callout tone/emphasis, action priority/href, table merges, section.variant.density',
  },
};

// ---------------------------------------------------------------------------
// Main — run the matrix, print the loss table + diff summary, write JSON.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const outDir = join(editorRoot, '.papir-check');
  await fs.mkdir(outDir, { recursive: true });

  const fixtures: Array<{ name: FixtureName; doc: PortableDoc }> =
    FIXTURE_NAMES.map((name) => ({
      name,
      doc: JSON.parse(
        readFileSync(join(repoRoot, 'examples', `${name}.json`), 'utf8'),
      ) as PortableDoc,
    }));

  const allDiffs: Diff[] = [];
  const summary: Array<{
    fixture: FixtureName;
    channel: Channel;
    diffCount: number;
    extractorReturnedNull: boolean;
  }> = [];

  for (const f of fixtures) {
    for (const channel of CHANNELS) {
      process.stderr.write(`[${f.name}] ${channel}…\n`);
      let actual: unknown | null = null;
      try {
        if (channel === 'docx') actual = await roundTripDocx(f.doc);
        else if (channel === 'html') actual = await roundTripHtml(f.doc);
        else actual = await roundTripMd(f.doc);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        allDiffs.push({
          fixture: f.name,
          channel,
          path: '$',
          expected: '(round-trip crashed)',
          actual: msg.slice(0, 120),
          severity: 'loss',
        });
        summary.push({
          fixture: f.name,
          channel,
          diffCount: 1,
          extractorReturnedNull: false,
        });
        continue;
      }
      if (actual === null) {
        allDiffs.push({
          fixture: f.name,
          channel,
          path: '$',
          expected: '(envelope)',
          actual: null,
          severity: 'loss',
        });
        summary.push({
          fixture: f.name,
          channel,
          diffCount: 1,
          extractorReturnedNull: true,
        });
        continue;
      }
      const diffs = diffAst(f.doc, actual, f.name, channel);
      allDiffs.push(...diffs);
      summary.push({
        fixture: f.name,
        channel,
        diffCount: diffs.length,
        extractorReturnedNull: false,
      });
    }
  }

  printLossTable(summary);
  printPerFixtureRollup(summary);

  await fs.writeFile(
    join(outDir, 'round-trip-check.json'),
    JSON.stringify({ summary, diffs: allDiffs }, null, 2) + '\n',
  );

  process.exit(0);
}

function printLossTable(
  summary: Array<{
    fixture: FixtureName;
    channel: Channel;
    diffCount: number;
    extractorReturnedNull: boolean;
  }>,
): void {
  process.stdout.write('\nRound-trip loss table (envelope-based round-trip)\n');
  process.stdout.write('='.repeat(78) + '\n');
  process.stdout.write(
    pad('Channel', 8) +
      pad('Survives', 34) +
      pad('Normalizes', 14) +
      'Loses\n',
  );
  process.stdout.write('-'.repeat(78) + '\n');
  for (const ch of CHANNELS) {
    const row = LOSS_TABLE[ch];
    process.stdout.write(
      pad(ch, 8) +
        pad(row.survives.slice(0, 32), 34) +
        pad(row.normalizes.slice(0, 12), 14) +
        row.loses +
        '\n',
    );
  }
  // Per-channel diff totals (should be 0 across the board for the envelope
  // path; any non-zero number is a real regression).
  process.stdout.write('\nObserved diff counts per channel:\n');
  for (const ch of CHANNELS) {
    const total = summary
      .filter((s) => s.channel === ch)
      .reduce((a, b) => a + b.diffCount, 0);
    process.stdout.write(`  ${ch.padEnd(6)} ${total} diffs\n`);
  }
}

function printPerFixtureRollup(
  summary: Array<{
    fixture: FixtureName;
    channel: Channel;
    diffCount: number;
    extractorReturnedNull: boolean;
  }>,
): void {
  process.stdout.write('\nPer-fixture × channel:\n');
  process.stdout.write(
    pad('FIXTURE', 18) + pad('DOCX', 8) + pad('HTML', 8) + pad('MD', 8) + '\n',
  );
  for (const f of FIXTURE_NAMES) {
    const cell = (ch: Channel): string => {
      const row = summary.find((s) => s.fixture === f && s.channel === ch);
      if (!row) return '?';
      if (row.extractorReturnedNull) return 'NULL';
      return row.diffCount === 0 ? 'OK' : `${row.diffCount}D`;
    };
    process.stdout.write(
      pad(f, 18) +
        pad(cell('docx'), 8) +
        pad(cell('html'), 8) +
        pad(cell('md'), 8) +
        '\n',
    );
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n - 1) + ' ' : s + ' '.repeat(n - s.length);
}

await main();
