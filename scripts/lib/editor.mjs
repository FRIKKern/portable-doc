// packages/editor is a copy of Barkpark's paper editor, written only by the sync (decision 0012).
// SOURCE.json records it in an `editor` section: Barkpark's path and a sha256 per file, under the
// same commit as the pack, because one sync run copies both from one Barkpark checkout.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { diff, readObject, sha256 } from './pack.mjs';

export const EDITOR_DIR = 'packages/editor';
export const BARKPARK_EDITOR = 'api/assets/paper-editor';

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// One rule for which files make up the editor, in Barkpark and here: the files git would track
// there, judged by the repo's own .gitignore files only, never a global excludes file or
// .git/info/exclude, so a local run lists what CI lists. Build output, node_modules and .DS_Store
// never count. Only regular files are copied or accepted; a symlink is named as an error.
const OWN_IGNORES = '--exclude-per-directory=.gitignore';

function gitFiles(repo, dir, extra = []) {
  const list = (...args) => execFileSync('git', ['-C', repo, 'ls-files', '-z', '--full-name', ...args, '--', dir], { encoding: 'utf8' })
    .split('\0').filter(Boolean).map((f) => f.slice(dir.length + 1));
  const ignored = new Set(list('--cached', '--ignored', OWN_IGNORES));
  return [...new Set(list('--cached', ...extra))].filter((f) => !ignored.has(f)).sort();
}

const isGitTop = (dir) => {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).stdout?.trim();
  return Boolean(top) && top === fs.realpathSync(dir);
};

// Outside a git work tree (a copy in a temp dir) every file and symlink on disk counts.
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() || e.isSymbolicLink())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort();
}

/** { files: { path: sha256 }, symlinks: [path] } of listed files; a listed file gone from disk is left out. */
function scan(dir, list) {
  const files = {};
  const symlinks = [];
  for (const f of list) {
    const stat = fs.lstatSync(path.join(dir, f), { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) symlinks.push(f);
    else if (stat?.isFile()) files[f] = sha256(path.join(dir, f));
  }
  return { files, symlinks };
}

/** The files Barkpark tracks under its editor path, minus what its .gitignore files match. Empty when the path is not there. */
export function trackedEditorFiles(barkpark) {
  return fs.existsSync(path.join(barkpark, BARKPARK_EDITOR)) ? gitFiles(barkpark, BARKPARK_EDITOR) : [];
}

const barkparkEditor = (barkpark) => scan(path.join(barkpark, BARKPARK_EDITOR), trackedEditorFiles(barkpark));
export const barkparkEditorHashes = (barkpark) => barkparkEditor(barkpark).files;

/** The editor copy here, by the same rule: tracked or untracked, not ignored. */
function localEditor(root) {
  const dir = path.join(root, EDITOR_DIR);
  if (!fs.existsSync(dir)) return { files: {}, symlinks: [] };
  return scan(dir, isGitTop(root) ? gitFiles(root, EDITOR_DIR, ['--others', OWN_IGNORES]) : walk(dir));
}

export const editorHashes = (root) => localEditor(root).files;

// Why Barkpark's editor cannot be copied; empty when it can.
export function editorErrors(barkpark) {
  const files = trackedEditorFiles(barkpark);
  if (!files.length) return [`${BARKPARK_EDITOR}: no tracked files`];
  if (!files.includes('package.json')) return [`${BARKPARK_EDITOR}/package.json: missing`];
  return barkparkEditor(barkpark).symlinks.map((f) => `${BARKPARK_EDITOR}/${f}: a symlink; the sync copies regular files only`);
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
  const local = localEditor(root);
  for (const f of local.symlinks) errors.push(`${EDITOR_DIR}/${f}: a symlink; the sync writes regular files only`);
  const d = diff(editor.files, local.files);
  for (const f of d.added) errors.push(`${EDITOR_DIR}/${f}: not written by the sync (absent from SOURCE.json)`);
  for (const f of d.changed) errors.push(`${EDITOR_DIR}/${f}: edited by hand (sha256 differs from SOURCE.json)`);
  for (const f of d.removed) errors.push(`${EDITOR_DIR}/${f}: in SOURCE.json, missing on disk`);
  return errors;
}

// Every file in the pack and the editor, keyed by its path in this repo, for the PR body.
export const prefixed = (files) => Object.fromEntries(Object.entries(files).map(([f, h]) => [`${EDITOR_DIR}/${f}`, h]));
