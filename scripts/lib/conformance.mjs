import fs from 'node:fs';
import path from 'node:path';
import { listFiles, sha256 } from './pack.mjs';

export const STATUSES = ['pass', 'fail', 'missing', 'unchecked'];

export function packTypes(packRoot) {
  return listFiles(path.join(packRoot, 'goldens', 'blocks'))
    .filter((f) => f.endsWith('.golden.json'))
    .map((f) => f.slice(0, -'.golden.json'.length));
}

export function reportFiles(packRoot) {
  return listFiles(path.join(packRoot, 'conformance')).filter((f) => !f.includes('/') && f.endsWith('.json'));
}

function readReport(packRoot, file, errors) {
  const name = `conformance/${file}`;
  try {
    const value = JSON.parse(fs.readFileSync(path.join(packRoot, name), 'utf8'));
    if (value && typeof value === 'object' && Array.isArray(value.rows)) return value;
    errors.push(`${name}: not an object with a rows array`);
  } catch (e) {
    errors.push(`${name}: unreadable (${e.message})`);
  }
  return null;
}

export function readReports(packRoot) {
  const errors = [];
  const files = reportFiles(packRoot);
  if (!files.length) errors.push('conformance: no reports');
  const stampFile = path.join(packRoot, 'goldens', 'stamp.json');
  const stamp = fs.existsSync(stampFile) ? sha256(stampFile) : null;
  const types = packTypes(packRoot);
  const reports = [];
  for (const file of files) {
    const report = readReport(packRoot, file, errors);
    if (!report) continue;
    const name = `conformance/${file}`;
    const renderer = file.slice(0, -'.json'.length);
    if (report.renderer !== renderer) errors.push(`${name}: renderer is ${JSON.stringify(report.renderer)}, not "${renderer}"`);
    if (stamp && report.pack_stamp !== stamp) errors.push(`${name}: pack_stamp ${String(report.pack_stamp).slice(0, 12)} is not goldens/stamp.json ${stamp.slice(0, 12)}`);
    const seen = new Set();
    for (const row of report.rows) {
      if (!types.includes(row?.type)) errors.push(`${name}: row ${JSON.stringify(row?.type)} is not a pack type`);
      else if (seen.has(row.type)) errors.push(`${name}: ${row.type} has more than one row`);
      if (!STATUSES.includes(row?.status)) errors.push(`${name}: ${row?.type} has status ${JSON.stringify(row?.status)}`);
      seen.add(row?.type);
    }
    for (const type of types) if (!seen.has(type)) errors.push(`${name}: no row for pack type ${type}`);
    reports.push(report);
  }
  return { reports, types, errors };
}
