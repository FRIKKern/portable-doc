// No package carries a depth number of its own. The format's two depth limits live in validate:
// MAX_DEPTH (blocks) and MAX_VALUE_DEPTH (JSON values). This row reads every package's source for
// a constant with a depth-shaped name (FOO_DEPTH, MAX_NEST, PARSE_LEVELS, maxDepth, ...) and holds
// each one to a rule: it is one of validate's two, or it is derived from them (its right side
// names one of them, imported from validate, and is no bare number), or it is listed below with
// its reason. Anything else is red by name. packages/editor is Barkpark's editor, copied by the
// sync (decision 0012); its limits are Barkpark's, so it is not read here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MAX_DEPTH } from '@portable-doc/validate';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const VALIDATE = 'packages/validate/index.js';
const FORMAT = ['MAX_DEPTH', 'MAX_VALUE_DEPTH'];

/** `file name` → why that constant is a number of its own. */
export const OWN = {
  'packages/text/from-markdown-inline.js MAX_MARK_NEST': 'marks inside marks: a limit of their own, counted against MAX_VALUE_DEPTH, two levels a mark',
  'packages/react/src/inline.tsx MAX_DEPTH': "a copy pinned equal to validate's MAX_DEPTH: the React package does not depend on validate",
  'packages/mcp/catalog.js MAX_NEST': "not the format's depth: how many levels of schema object properties the tool catalog spells out",
  'packages/mcp/limits.js ARGS_LEVEL': "not the format's depth: the one level the arguments object wraps a doc in",
};
/** Of OWN, the copies of validate's own number: each must equal it. */
const PINNED = { 'packages/react/src/inline.tsx MAX_DEPTH': MAX_DEPTH };

// SCREAMING names with DEPTH, NEST, NESTING, LEVEL or LEVELS as a word, and camelCase limits:
// max…Depth, limit…Nest and the like. A counter (`let depth = 0`) is not a limit, and is not read.
const DEPTH_NAME = /^(?:(?:[A-Z][A-Z0-9]*_)*(?:DEPTH|NEST|NESTING|LEVEL|LEVELS)(?:_[A-Z0-9]+)*|(?:max|limit)[A-Za-z0-9]*(?:Depth|Nest|Nesting|Level|Levels))$/;
const DECLARATION = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=(?!=)\s*([^;\n]+)/g;
const RE_EXPORT = /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
const FROM_VALIDATE = /import\s*\{([^}]*)\}\s*from\s*['"]@portable-doc\/validate['"]/g;
const names = (list) => list.split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean);

/**
 * The depth-shaped constants in `files` ({ path: source }) that break the rule, as
 * `path: NAME = right side (why)`, and the OWN entries no file declares.
 */
export function strayDepthNumbers(files, own = OWN, pinned = PINNED) {
  const stray = [];
  const seen = new Set();
  // A name for a string (a notice code such as NESTING_KEPT_AS_TEXT) is no number.
  const words = new Set();
  for (const src of Object.values(files)) for (const [, name, rhs] of src.matchAll(DECLARATION)) if (/^['"`]/.test(rhs.trim())) words.add(name);
  for (const [file, src] of Object.entries(files)) {
    const imported = new Set([...src.matchAll(FROM_VALIDATE)].flatMap((m) => names(m[1])));
    for (const [, name, rhs] of src.matchAll(DECLARATION)) {
      if (!DEPTH_NAME.test(name) || words.has(name)) continue;
      const key = `${file} ${name}`;
      const right = rhs.trim();
      const bare = /^[\d_.]+$/.test(right);
      if (file === VALIDATE && FORMAT.includes(name)) continue;
      if (Object.hasOwn(own, key)) {
        seen.add(key);
        if (Object.hasOwn(pinned, key) && Number(right.replace(/_/g, '')) !== pinned[key]) stray.push(`${file}: ${name} = ${right} (pinned to ${pinned[key]})`);
        continue;
      }
      const derived = !bare && FORMAT.some((f) => imported.has(f) && new RegExp(`\\b${f}\\b`).test(right));
      if (!derived) stray.push(`${file}: ${name} = ${right}`);
    }
    for (const [, list, from] of src.matchAll(RE_EXPORT)) {
      for (const name of names(list)) if (DEPTH_NAME.test(name) && !words.has(name) && from !== '@portable-doc/validate') stray.push(`${file}: re-exports ${name} from ${from}`);
    }
  }
  for (const key of Object.keys(own)) if (!seen.has(key)) stray.push(`${key}: listed, but no file declares it`);
  return stray;
}

/** Every package source file but the editor's, and no test: { 'packages/…': source }. */
function packageSources() {
  const files = {};
  for (const rel of fs.readdirSync(path.join(ROOT, 'packages'), { recursive: true })) {
    const file = `packages/${rel.split(path.sep).join('/')}`;
    if (file.startsWith('packages/editor/') || /\/(node_modules|dist|test)\//.test(file)) continue;
    if (!/\.(m?js|cjs|tsx?)$/.test(file) || /\.test\.|\.d\.ts$/.test(file)) continue;
    files[file] = fs.readFileSync(path.join(ROOT, file), 'utf8');
  }
  return files;
}

test('no package carries a depth number of its own: each depth-shaped constant is validate\'s, derived from it, or listed with its reason', () => {
  const files = packageSources();
  assert.ok(Object.keys(files).length > 50, `${Object.keys(files).length} source files read`);
  assert.deepEqual(strayDepthNumbers(files), []);
});

test('the row names a second depth number, a bare copy, a wrong pin and a re-export from elsewhere', () => {
  const files = {
    'packages/x/a.js': "import { MAX_DEPTH } from '@portable-doc/validate';\nexport const MAX_LIST_DEPTH = 100;\nconst PARSE_LEVELS = 2 * (MAX_DEPTH + 2);\nconst maxNestLevel = 50;",
    'packages/x/b.js': "const MAX_DEPTH = 100;\nconst LEVELS = MAX_DEPTH * 2;\nexport { MAX_DEPTH as DEPTH } from './a.js';\nexport const NESTING_NOTICE = 'nesting';\nexport { NESTING_NOTICE } from './c.js';",
    'packages/react/src/inline.tsx': 'export const MAX_DEPTH = 99',
  };
  const own = { 'packages/react/src/inline.tsx MAX_DEPTH': 'a pinned copy' };
  assert.deepEqual(strayDepthNumbers(files, own, { 'packages/react/src/inline.tsx MAX_DEPTH': MAX_DEPTH }), [
    'packages/x/a.js: MAX_LIST_DEPTH = 100',
    'packages/x/a.js: maxNestLevel = 50',
    'packages/x/b.js: MAX_DEPTH = 100',
    // b.js's own MAX_DEPTH is not validate's: what is derived from it is not derived from validate.
    'packages/x/b.js: LEVELS = MAX_DEPTH * 2',
    'packages/x/b.js: re-exports DEPTH from ./a.js',
    'packages/react/src/inline.tsx: MAX_DEPTH = 99 (pinned to 100)',
  ]);
});
