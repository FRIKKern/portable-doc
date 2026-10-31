import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MIN_BLOCK_GOLDENS = 80;
export const PACK_DIRS = ['spec', 'goldens'];
export const BARKPARK_PACK = 'api/priv/portable_doc';

export function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort();
}

export function hashes(packRoot) {
  const out = {};
  for (const dir of PACK_DIRS) {
    for (const file of listFiles(path.join(packRoot, dir))) out[`${dir}/${file}`] = sha256(path.join(packRoot, dir, file));
  }
  return out;
}

export function stampId(packRoot) {
  const file = path.join(packRoot, 'goldens', 'stamp.json');
  return fs.existsSync(file) ? sha256(file).slice(0, 12) : 'none';
}

function readJson(root, file, errors) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  } catch (e) {
    errors.push(`${file}: ${e.code === 'ENOENT' ? 'missing' : `unreadable (${e.message})`}`);
    return null;
  }
}

export function checkPack(packRoot) {
  const errors = [];
  const goldens = path.join(packRoot, 'goldens');
  if (!fs.existsSync(path.join(packRoot, 'spec', 'blocks.schema.json'))) errors.push('spec/blocks.schema.json: missing');
  const blocks = listFiles(path.join(goldens, 'blocks')).length;
  if (blocks < MIN_BLOCK_GOLDENS) errors.push(`goldens/blocks: ${blocks} block goldens, need at least ${MIN_BLOCK_GOLDENS}`);
  const stamp = readJson(packRoot, 'goldens/stamp.json', errors);
  if (!stamp) return errors;
  const listed = stamp.files ?? {};
  for (const [file, hash] of Object.entries(listed)) {
    const full = path.join(goldens, file);
    if (!fs.existsSync(full)) errors.push(`goldens/${file}: in the stamp, missing on disk`);
    else if (sha256(full) !== hash) errors.push(`goldens/${file}: sha256 differs from the stamp`);
  }
  for (const file of listFiles(goldens)) {
    if (file !== 'stamp.json' && !(file in listed)) errors.push(`goldens/${file}: not in the stamp`);
  }
  return errors;
}

export function diff(from, to) {
  const added = Object.keys(to).filter((f) => !(f in from));
  const removed = Object.keys(from).filter((f) => !(f in to));
  const changed = Object.keys(to).filter((f) => f in from && from[f] !== to[f]);
  return { added, changed, removed };
}

export function checkSource(root) {
  const errors = [];
  const source = readJson(root, 'SOURCE.json', errors);
  if (!source) return errors;
  const d = diff(source.files ?? {}, hashes(root));
  for (const f of d.added) errors.push(`${f}: not written by the sync (absent from SOURCE.json)`);
  for (const f of d.changed) errors.push(`${f}: edited by hand (sha256 differs from SOURCE.json)`);
  for (const f of d.removed) errors.push(`${f}: in SOURCE.json, missing on disk`);
  return errors;
}
