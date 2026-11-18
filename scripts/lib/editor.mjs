// packages/editor is a copy of Barkpark's paper editor, written only by the sync (decision 0012).
// SOURCE.json records it in an `editor` section: Barkpark's path and a sha256 per file, under the
// same commit as the pack, because one sync run copies both from one Barkpark checkout.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { diff, listFiles, readObject, sha256 } from './pack.mjs';

export const EDITOR_DIR = 'packages/editor';
export const BARKPARK_EDITOR = 'api/assets/paper-editor';

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function hashAll(dir, files) {
  return Object.fromEntries(files.map((f) => [f, sha256(path.join(dir, f))]));
}

// The files Barkpark tracks under its editor path, minus any it ignores, so build output,
// node_modules and local leftovers never travel. Empty when the path is not there.
export function trackedEditorFiles(barkpark) {
  if (!fs.existsSync(path.join(barkpark, BARKPARK_EDITOR))) return [];
  const list = (...args) => execFileSync('git', ['-C', barkpark, 'ls-files', '-z', '--full-name', ...args, '--', BARKPARK_EDITOR], { encoding: 'utf8' })
    .split('\0').filter(Boolean).map((f) => f.slice(BARKPARK_EDITOR.length + 1));
  const ignored = new Set(list('--cached', '--ignored', '--exclude-standard'));
  return list('--cached').filter((f) => !ignored.has(f)).sort();
}

export function barkparkEditorHashes(barkpark) {
  return hashAll(path.join(barkpark, BARKPARK_EDITOR), trackedEditorFiles(barkpark));
}

export function editorHashes(root) {
  const dir = path.join(root, EDITOR_DIR);
  return hashAll(dir, listFiles(dir));
}

// Why Barkpark's editor cannot be copied; empty when it can.
export function editorErrors(barkpark) {
  const files = trackedEditorFiles(barkpark);
  if (!files.length) return [`${BARKPARK_EDITOR}: no tracked files`];
  if (!files.includes('package.json')) return [`${BARKPARK_EDITOR}/package.json: missing`];
  return [];
}

export function copyEditor(barkpark, root) {
  const from = path.join(barkpark, BARKPARK_EDITOR);
  const to = path.join(root, EDITOR_DIR);
  fs.rmSync(to, { recursive: true, force: true });
  for (const file of trackedEditorFiles(barkpark)) {
    fs.mkdirSync(path.dirname(path.join(to, file)), { recursive: true });
    fs.copyFileSync(path.join(from, file), path.join(to, file));
  }
  return { path: BARKPARK_EDITOR, files: editorHashes(root) };
}

export function checkEditor(root) {
  const source = readObject(root, 'SOURCE.json', []);
  if (!source) return []; // checkSource names the problem
  const editor = source.editor;
  if (!isObject(editor) || !isObject(editor.files)) return ['SOURCE.json: no editor section with a files object'];
  const errors = [];
  if (editor.path !== BARKPARK_EDITOR) errors.push(`SOURCE.json: editor.path is ${JSON.stringify(editor.path)}, not "${BARKPARK_EDITOR}"`);
  if (!Object.keys(editor.files).length) errors.push(`SOURCE.json: editor.files is empty; the sync copies ${EDITOR_DIR} from Barkpark`);
  const d = diff(editor.files, editorHashes(root));
  for (const f of d.added) errors.push(`${EDITOR_DIR}/${f}: not written by the sync (absent from SOURCE.json)`);
  for (const f of d.changed) errors.push(`${EDITOR_DIR}/${f}: edited by hand (sha256 differs from SOURCE.json)`);
  for (const f of d.removed) errors.push(`${EDITOR_DIR}/${f}: in SOURCE.json, missing on disk`);
  return errors;
}

// Every file in the pack and the editor, keyed by its path in this repo, for the PR body.
export const prefixed = (files) => Object.fromEntries(Object.entries(files).map(([f, h]) => [`${EDITOR_DIR}/${f}`, h]));
