// No package declares a depth number of its own. The format's two depth limits live in validate:
// MAX_DEPTH (blocks) and MAX_VALUE_DEPTH (JSON values). This row parses every package's shipped
// source with the TypeScript parser and reads each module-level declaration, every declarator of
// the statement, whose name is depth-shaped: one of its words (camelCase or snake_case) is depth,
// nest, nested, nesting, level, levels, deep, deeper or deepest, and whose value is no string or
// function. Each is validate's own, derived (built only from validate's names and other derived
// or listed names, with + - * and no literal, through the package's own imports and re-exports),
// or listed in OWN with its reason; a listed `formula` or `pinned` value is held exactly.
// It does not try to see literals in comparisons: the at-the-limit behaviour rows hold those
// (packages/text/import-depth.test.mjs, scripts/depth-limit-writers.test.mjs). Not read:
// packages/editor (Barkpark's editor, copied by the sync, decision 0012; its limits are
// Barkpark's), tests, test folders, the two text test helpers, dist/ and node_modules.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MAX_DEPTH } from '@portable-doc/validate';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ts = createRequire(path.join(ROOT, 'packages/react/package.json'))('typescript');
const VALIDATE = 'packages/validate/index.js';
const FORMAT = new Set(['MAX_DEPTH', 'MAX_VALUE_DEPTH']);

/** `file NAME` → why it is a number of its own; `formula`: its right side exactly; `pinned`: its value. */
export const OWN = {
  'packages/text/from-markdown-inline.js MAX_MARK_NEST': { why: 'marks inside marks: a limit of their own, counted against MAX_VALUE_DEPTH, two levels a mark' },
  'packages/text/from-markdown-inline.js PARSE_LEVELS': { why: "markdown-it's levels for MAX_DEPTH lists: two a list (the list and its item), and two to spare", formula: '2 * (MAX_DEPTH + 2)' },
  'packages/react/src/inline.tsx MAX_DEPTH': { why: "a copy pinned equal to validate's MAX_DEPTH: the React package does not depend on validate", pinned: MAX_DEPTH },
  'packages/mcp/catalog.js MAX_NEST': { why: "not the format's depth: how many levels of schema object properties the tool catalog spells out" },
  'packages/mcp/limits.js ARGS_LEVEL': { why: "not the format's depth: the one level the arguments object wraps a doc in" },
};

const WORDS = new Set(['depth', 'depths', 'nest', 'nests', 'nested', 'nesting', 'level', 'levels', 'deep', 'deeper', 'deepest']);
const shaped = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_$]+/).some((w) => WORDS.has(w.toLowerCase()));
const NOT_SHIPPED = [/\.test\.[cm]?[jt]sx?$/, /\.d\.[cm]?ts$/, /\/(?:test|tests|dist|node_modules)\//, /^packages\/text\/(?:block-forms|golden-reads)\.mjs$/];

/** Every package's shipped source, but the editor's: { 'packages/…': source }. */
export function packageSources(root = ROOT) {
  const files = {};
  for (const rel of fs.readdirSync(path.join(root, 'packages'), { recursive: true })) {
    const file = `packages/${rel.split(path.sep).join('/')}`;
    if (file.startsWith('packages/editor/') || !/\.(?:[cm]?js|tsx?)$/.test(file) || NOT_SHIPPED.some((re) => re.test(file))) continue;
    files[file] = fs.readFileSync(path.join(root, file), 'utf8');
  }
  return files;
}

const unwrap = (n) => (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) ? unwrap(n.expression) : n);
// Holds a string or a function (a message, a notice code, a helper), not a number.
const notNumber = (n) => {
  n = unwrap(n);
  return ts.isStringLiteralLike(n) || ts.isTemplateExpression(n) || ts.isFunctionLike(n) || ts.isClassExpression(n) || ts.isObjectLiteralExpression(n) || ts.isArrayLiteralExpression(n) || ts.isRegularExpressionLiteral(n) || ts.isNewExpression(n);
};

/** Each module-level depth-shaped declaration in `files` that breaks the rule, as `path:line: NAME = value`, and OWN entries no file declares. */
export function strayDepthNumbers(files, own = OWN) {
  const parsed = new Map();
  const sourceOf = (file) => {
    if (!parsed.has(file)) {
      const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
      parsed.set(file, ts.createSourceFile(file, files[file], ts.ScriptTarget.Latest, true, kind));
    }
    return parsed.get(file);
  };
  const declarations = (file) => sourceOf(file).statements.filter(ts.isVariableStatement).flatMap((s) => s.declarationList.declarations).filter((d) => ts.isIdentifier(d.name));
  const resolveFile = (from, spec) => {
    const base = path.posix.join(path.posix.dirname(from), spec);
    return [base, `${base}.js`, `${base}.mjs`, `${base}.ts`, `${base}.tsx`, `${base}/index.js`].find((f) => Object.hasOwn(files, f));
  };
  const kinds = new Map();
  // What module-level `name` of `file` stands for: 'validate', 'listed', 'derived' or null.
  function kindOf(file, name, seen = new Set()) {
    const key = `${file} ${name}`;
    if (kinds.has(key)) return kinds.get(key);
    if (seen.has(key)) return null;
    seen.add(key);
    let kind = null;
    const from = (spec, imported) => {
      if (spec === '@portable-doc/validate') return FORMAT.has(imported) ? 'validate' : null;
      const target = spec.startsWith('.') ? resolveFile(file, spec) : undefined;
      return target ? kindOf(target, imported, seen) : null;
    };
    const decl = declarations(file).find((d) => d.name.text === name);
    if (decl) {
      if (file === VALIDATE && FORMAT.has(name)) kind = 'validate';
      else if (Object.hasOwn(own, key)) kind = 'listed';
      else if (decl.initializer && derived(file, decl.initializer, seen)) kind = 'derived';
    } else {
      for (const s of sourceOf(file).statements) {
        const imports = ts.isImportDeclaration(s) ? s.importClause?.namedBindings?.elements ?? [] : [];
        for (const sp of imports) if (sp.name.text === name) kind = from(s.moduleSpecifier.text, sp.propertyName?.text ?? name);
        const exports = ts.isExportDeclaration(s) && s.moduleSpecifier && s.exportClause && ts.isNamedExports(s.exportClause) ? s.exportClause.elements : [];
        for (const sp of exports) if (sp.name.text === name) kind = from(s.moduleSpecifier.text, sp.propertyName?.text ?? name);
      }
    }
    kinds.set(key, kind);
    return kind;
  }
  function derived(file, n, seen) {
    n = unwrap(n);
    if (ts.isIdentifier(n)) return kindOf(file, n.text, seen) !== null;
    if (ts.isBinaryExpression(n)) return ['+', '-', '*'].includes(ts.tokenToString(n.operatorToken.kind)) && derived(file, n.left, seen) && derived(file, n.right, seen);
    return false;
  }
  // A re-exported string (a notice code) is no number.
  function notNumberExport(file, spec, name) {
    const target = spec.startsWith('.') ? resolveFile(file, spec) : undefined;
    const decl = target && declarations(target).find((d) => d.name.text === name);
    return Boolean(decl?.initializer && notNumber(decl.initializer));
  }

  const out = [];
  const met = new Set();
  for (const file of Object.keys(files)) {
    const sf = sourceOf(file);
    for (const d of declarations(file)) {
      const name = d.name.text;
      if (!shaped(name) || !d.initializer || notNumber(d.initializer)) continue;
      const key = `${file} ${name}`;
      const value = d.initializer.getText(sf).replace(/\s+/g, ' ');
      const at = `${file}:${sf.getLineAndCharacterOfPosition(d.getStart(sf)).line + 1}: ${name} = ${value}`;
      if (Object.hasOwn(own, key)) {
        met.add(key);
        const { pinned, formula } = own[key];
        const literal = unwrap(d.initializer);
        if (pinned !== undefined && !(ts.isNumericLiteral(literal) && Number(literal.text.replace(/_/g, '')) === pinned)) out.push(`${at} (pinned to ${pinned})`);
        if (formula !== undefined && value !== formula) out.push(`${at} (listed as ${formula})`);
      } else if (kindOf(file, name) === null) out.push(at);
    }
    // A depth-shaped name re-exported from another module is that module's: it must resolve too.
    for (const s of sf.statements) {
      if (!ts.isExportDeclaration(s) || !s.moduleSpecifier || !s.exportClause || !ts.isNamedExports(s.exportClause)) continue;
      for (const sp of s.exportClause.elements) {
        const name = sp.propertyName?.text ?? sp.name.text;
        if (shaped(sp.name.text) && kindOf(file, sp.name.text) === null && !notNumberExport(file, s.moduleSpecifier.text, name)) out.push(`${file}: re-exports ${sp.name.text} from ${s.moduleSpecifier.text}`);
      }
    }
  }
  for (const key of Object.keys(own)) if (!met.has(key)) out.push(`${key}: listed, but no file declares it`);
  return out;
}

test('no package declares a depth number of its own: each depth-shaped constant is validate\'s, derived from it, or listed with its reason', () => {
  const files = packageSources();
  for (const pkg of ['cli', 'code', 'mcp', 'react', 'text', 'validate']) assert.ok(Object.keys(files).some((f) => f.startsWith(`packages/${pkg}/`)), pkg);
  assert.ok(!Object.keys(files).some((f) => f.startsWith('packages/editor/')));
  assert.deepEqual(strayDepthNumbers(files), []);
});

test('the row names a second depth number by name: any declarator, a derivation from a number, a copy, a wrong pin or formula, a re-export', () => {
  const v = "import { MAX_DEPTH } from '@portable-doc/validate';\n";
  const one = (src, own = {}) => strayDepthNumbers({ 'packages/x/a.js': src }, own).map((s) => s.replace(/^packages\/x\/a\.js:\d+: /, ''));
  assert.deepEqual(one(`${v}const LIST_LEVELS = MAX_DEPTH + MAX_DEPTH;\nconst TOO_DEEP = 'Nested too deep';\nconst nestedOf = (b) => b;`), []);
  const red = {
    'a SCREAMING name': ['export const DEEPEST = 60;', 'DEEPEST = 60'],
    'the second declarator': ['const a = 1, MAX_LIST_DEPTH = 60;', 'MAX_LIST_DEPTH = 60'],
    'a name set from a number': ['const BASE = 60;\nexport const MAX_LIST_DEPTH = BASE;', 'MAX_LIST_DEPTH = BASE'],
    'Math.min with a number': [`${v}export const MAX_LIST_DEPTH = Math.min(MAX_DEPTH, 60);`, 'MAX_LIST_DEPTH = Math.min(MAX_DEPTH, 60)'],
    'validate less a number': [`${v}export const MAX_LIST_DEPTH = MAX_DEPTH - 40;`, 'MAX_LIST_DEPTH = MAX_DEPTH - 40'],
    'Number of a string': ["const MAX_LIST_DEPTH = Number('60');", "MAX_LIST_DEPTH = Number('60')"],
    'a camelCase limit': ['let maxNestLevel = 50;', 'maxNestLevel = 50'],
    "a copy of validate's own name": ['const MAX_DEPTH = 100;', 'MAX_DEPTH = 100'],
  };
  for (const [what, [src, found]] of Object.entries(red)) assert.deepEqual(one(src), [found], what);
  // A pin and a formula hold their listed value; an entry no file declares is red.
  const own = { 'packages/x/a.js MAX_DEPTH': { why: 'a copy', pinned: 100 }, 'packages/x/a.js PARSE_LEVELS': { why: 'a formula', formula: '2 * (MAX_DEPTH + 2)' }, 'packages/x/a.js GONE_DEPTH': { why: 'gone' } };
  assert.deepEqual(one('export const MAX_DEPTH = 1_00;\nconst PARSE_LEVELS = 2 * (MAX_DEPTH + 3);', own), [
    'PARSE_LEVELS = 2 * (MAX_DEPTH + 3) (listed as 2 * (MAX_DEPTH + 2))',
    'packages/x/a.js GONE_DEPTH: listed, but no file declares it',
  ]);
  assert.deepEqual(one('export const MAX_DEPTH = 99;', { 'packages/x/a.js MAX_DEPTH': { why: 'a copy', pinned: 100 } }), ['MAX_DEPTH = 99 (pinned to 100)']);
  // Across files: a re-export of validate's name is validate's; a re-export of a local number is not.
  const files = {
    'packages/x/util.js': "export { MAX_DEPTH } from '@portable-doc/validate';\nexport const NEST_LEVELS = 60;\nexport const NESTING_NOTICE = 'nesting';",
    'packages/x/b.js': "import { MAX_DEPTH } from './util.js';\nexport const DEPTH_TWICE = 2 * MAX_DEPTH;\nexport const DEPTH_PLUS = MAX_DEPTH + MAX_DEPTH;\nexport { NEST_LEVELS, NESTING_NOTICE } from './util.js';",
  };
  assert.deepEqual(strayDepthNumbers(files, {}), ['packages/x/util.js:2: NEST_LEVELS = 60', 'packages/x/b.js:2: DEPTH_TWICE = 2 * MAX_DEPTH', 'packages/x/b.js: re-exports NEST_LEVELS from ./util.js']);
});
