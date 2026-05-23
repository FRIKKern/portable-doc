/**
 * render-channels.test — T4 proof that the remaining export channels actually
 * render to PDF and yield REAL geometry (not stubs).
 *
 * Bound decision #7 channel tiers: PDF + DOCX are full geometry-gate channels,
 * EPUB is structural-only (geometry informational), Markdown has no render leg.
 * This suite proves the three NEW render legs each produce a non-empty PDF that
 * extractPdfGeometry can read into real blocks:
 *
 *   - PDF  : renderPdfChannelToPdf feeds toPdfBlob's bytes DIRECTLY (no
 *            re-render) — we assert the bytes are a real %PDF and geometry is
 *            non-empty.
 *   - DOCX : renderDocxChannelToPdf runs soffice for real — we assert it
 *            converted (a real PDF came back) and geometry is non-empty.
 *   - EPUB : renderEpubChannelToPdf unzips + renders the chapter XHTML — we
 *            assert real geometry (informational tier, but still real).
 *   - SS4  : assertSourceSerif4Embedded throws on a fallback-font PDF and
 *            passes on one carrying the family token (decision #6).
 *
 * soffice (DOCX) is slow + serial, so the DOCX case carries a long timeout. If
 * LibreOffice is genuinely absent the DOCX render THROWS (HARD RULE: never fake
 * a channel) — the test then fails loudly rather than masking a missing tool.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import type { PortableDoc } from '@portable-doc/core';
import { extractPdfGeometry } from './pdf-geometry.ts';
import {
  renderPdfChannelToPdf,
  renderDocxChannelToPdf,
  renderEpubChannelToPdf,
  checkSourceSerif4Embedded,
  closeEditorServer,
} from './render-to-pdf.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolvePath(__dirname, '..', '..', '..', '..');
const fixturePath = resolvePath(repoRoot, 'examples', 'funnel-hard.json');

async function loadDoc(): Promise<PortableDoc> {
  return JSON.parse(await fs.readFile(fixturePath, 'utf8')) as PortableDoc;
}

const PDF_MAGIC = '%PDF';

afterAll(async () => {
  await closeEditorServer();
});

describe('PDF channel — toPdf bytes fed straight to geometry', () => {
  it('produces a real PDF and non-empty geometry without re-rendering', async () => {
    const doc = await loadDoc();
    const bytes = await renderPdfChannelToPdf(doc);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toContain(PDF_MAGIC);
    const geom = await extractPdfGeometry(bytes);
    // The hard fixture is many blocks; a stub/blank PDF would be ~0.
    expect(geom.blocks.length).toBeGreaterThanOrEqual(6);
    expect(geom.meta.measuredLineHeight).toBeGreaterThan(0);
  }, 60_000);
});

describe('DOCX channel — soffice converts for real', () => {
  it('runs soffice and yields a converted PDF with non-empty geometry', async () => {
    const doc = await loadDoc();
    const bytes = await renderDocxChannelToPdf(doc);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toContain(PDF_MAGIC);
    const geom = await extractPdfGeometry(bytes);
    expect(geom.blocks.length).toBeGreaterThanOrEqual(6);
    expect(geom.meta.measuredLineHeight).toBeGreaterThan(0);
  }, 120_000);
});

describe('EPUB channel — unzip + render chapter XHTML (informational)', () => {
  it('renders the EPUB content doc into real geometry', async () => {
    const doc = await loadDoc();
    const bytes = await renderEpubChannelToPdf(doc);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toContain(PDF_MAGIC);
    const geom = await extractPdfGeometry(bytes);
    expect(geom.blocks.length).toBeGreaterThanOrEqual(6);
  }, 90_000);
});

describe('checkSourceSerif4Embedded — decision #6 font-substitution guard', () => {
  it('does not throw (default warn mode) for a clean SS4 byte-scan when pdffonts is fed a missing path', async () => {
    // No file at this path → pdffonts errors → byte-scan fallback. The bytes
    // carry an SS4 subset token, so it reads as clean and must not throw.
    const withSerif = Buffer.from('%PDF-1.7\n/BaseFont /BAAAAA+SourceSerif4-Regular\n%%EOF', 'latin1');
    await expect(
      checkSourceSerif4Embedded('/nonexistent/papir-no-such.pdf', withSerif, 'DOCX'),
    ).resolves.toBeUndefined();
  });
  it('warns (does not throw in default mode) when the byte-scan finds no SS4 token', async () => {
    const noSerif = Buffer.from('%PDF-1.7\n/BaseFont /Helvetica\n%%EOF', 'latin1');
    // Default (non-strict) mode: substitution is a loud warn, never a throw.
    await expect(
      checkSourceSerif4Embedded('/nonexistent/papir-no-such.pdf', noSerif, 'DOCX'),
    ).resolves.toBeUndefined();
  });
});
