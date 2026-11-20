import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { BUILT_ELSEWHERE, NOT_A_WRITER, WRITERS } from './lib/writers.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

// Every file a package.json `exports` value names, under any condition (import, require, node,
// default, nested ones). Code is a .js, .mjs or .cjs file; a stylesheet, JSON or types file is not.
const filesOf = (value) => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(filesOf) : []);
const isCode = (file) => /\.[cm]?js$/.test(file);

/** Every function each package exports, as `<package> <export>`, and the problems met on the way. */
async function exportedFunctions() {
  const found = new Set();
  const problems = [];
  const elsewhere = new Set();
  for (const dir of fs.readdirSync(path.join(root, 'packages')).sort()) {
    const at = path.join(root, 'packages', dir, 'package.json');
    if (!fs.existsSync(at)) continue;
    const { name, exports = {} } = JSON.parse(fs.readFileSync(at, 'utf8'));
    for (const [entry, value] of Object.entries(exports)) {
      const files = [...new Set(filesOf(value).filter(isCode))];
      if (!files.length) continue;
      const key = `${name} ${entry}`;
      let sources = files.map((file) => [file, path.join(root, 'packages', dir, file)]);
      if (key in BUILT_ELSEWHERE) {
        elsewhere.add(key);
        const { source } = BUILT_ELSEWHERE[key];
        sources = source ? [[source, path.join(root, source)]] : [];
      }
      for (const [file, at] of sources) {
        if (!fs.existsSync(at)) {
          problems.push(`${key}: ${file} is not here to read; name the entry in BUILT_ELSEWHERE with why`);
          continue;
        }
        try {
          for (const [k, v] of Object.entries(await import(pathToFileURL(at).href))) if (typeof v === 'function') found.add(`${name} ${k}`);
        } catch (error) {
          problems.push(`${key}: ${file} cannot be read: ${error.message.split('\n')[0]}`);
        }
      }
    }
  }
  for (const key of Object.keys(BUILT_ELSEWHERE)) if (!elsewhere.has(key)) problems.push(`${key}: in BUILT_ELSEWHERE, but no package exports it`);
  return { found, problems };
}

// An element method's key is `<package> <tag>.method`; an export's is `<package> <export>`.
const isMethodKey = (key) => / <[^>]+>\./.test(key);

test('every function a package exports is a writer in the registry, or named with why it is not one', async () => {
  const { found, problems } = await exportedFunctions();
  assert.deepEqual(problems, []);
  const writers = new Set(WRITERS.map((w) => `${w.package} ${w.export}`));
  assert.deepEqual([...found].filter((k) => !writers.has(k) && !(k in NOT_A_WRITER)), [], 'exported, but neither a writer in scripts/lib/writers.mjs nor in its NOT_A_WRITER');
  assert.deepEqual([...writers, ...Object.keys(NOT_A_WRITER).filter((k) => !isMethodKey(k))].filter((k) => !found.has(k)), [], 'named in scripts/lib/writers.mjs, but no package exports it');
  assert.deepEqual([...writers].filter((k) => k in NOT_A_WRITER), [], 'both a writer and not one');
});

test("source mode's checks in the editor answer a place or nothing, never a document", async () => {
  const { changedSentinel, firstLoss, sourceLoss } = await import('../packages/editor/src/markdown.js');
  const paragraph = [{ type: 'paragraph', text: 'Hello' }];
  const calloutWithBody = [{ type: 'callout', content: [{ type: 'text', value: 'Lead' }], slots: { body: [{ type: 'paragraph', text: 'Body' }] } }];
  assert.equal(changedSentinel('Hello', 'Hello'), -1);
  assert.equal(firstLoss(paragraph, paragraph), null);
  assert.deepEqual(firstLoss(paragraph, []), { index: 0, type: 'paragraph', path: '', part: 'content' });
  assert.equal(sourceLoss(paragraph), null);
  assert.deepEqual(sourceLoss(calloutWithBody), { index: 0, type: 'callout', path: 'slots.body', part: 'body' });
});

test('the registry holds these seven writers, each writing a string of its kind', () => {
  assert.deepEqual(WRITERS.map((w) => w.name), [
    'readable Markdown',
    'plain text',
    'round-trip Markdown',
    'HTML',
    'HTML with field and embed blocks',
    'editor export',
    'editor source',
  ]);
  const blocks = [{ type: 'paragraph', content: [{ type: 'text', value: 'one word' }] }];
  for (const w of WRITERS) {
    assert.ok(['markdown', 'text', 'html'].includes(w.writes), w.name);
    const { output } = w.write(blocks);
    assert.equal(typeof output, 'string', w.name);
    assert.match(output, /one word/, w.name);
  }
});

// A type that is a string: `string`, a string or template literal, a union holding one, a local
// alias of one, or a promise of one. A string[] is not.
function isString(node, aliases) {
  if (!node) return false;
  if (node.kind === ts.SyntaxKind.StringKeyword || ts.isTemplateLiteralTypeNode(node)) return true;
  if (ts.isLiteralTypeNode(node)) return ts.isStringLiteral(node.literal) || ts.isNoSubstitutionTemplateLiteral(node.literal);
  if (ts.isUnionTypeNode(node)) return node.types.some((t) => isString(t, aliases));
  if (ts.isParenthesizedTypeNode(node)) return isString(node.type, aliases);
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text;
    if (/^(Promise|PromiseLike|MaybePromise)$/.test(name)) return (node.typeArguments ?? []).some((t) => isString(t, aliases));
    if (aliases.has(name)) {
      const alias = aliases.get(name);
      aliases.delete(name); // an alias that names itself ends here
      const is = isString(alias, aliases);
      aliases.set(name, alias);
      return is;
    }
  }
  return false;
}

/**
 * The elements a declaration file names in `HTMLElementTagNameMap`, each as its tag and the names of
 * its methods that return a string: method signatures, and properties whose type is a function (a
 * property that may be null is a callback the host sets). Interfaces it extends in the file count.
 */
export function declaredElements(text) {
  const file = ts.createSourceFile('index.d.ts', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const interfaces = new Map();
  const aliases = new Map();
  const tags = [];
  const nameOf = (n) => (n && (ts.isIdentifier(n) || ts.isStringLiteral(n)) ? n.text : null);
  const visit = (node) => {
    if (ts.isInterfaceDeclaration(node)) {
      if (node.name.text === 'HTMLElementTagNameMap') {
        for (const m of node.members) if (ts.isPropertySignature(m) && m.type && ts.isTypeReferenceNode(m.type)) tags.push([nameOf(m.name), m.type.typeName.getText(file)]);
      } else interfaces.set(node.name.text, [...(interfaces.get(node.name.text) ?? []), node]);
    } else if (ts.isTypeAliasDeclaration(node)) aliases.set(node.name.text, node.type);
    ts.forEachChild(node, visit);
  };
  visit(file);
  const methods = (name, seen = new Set()) => {
    if (seen.has(name) || !interfaces.has(name)) return [];
    seen.add(name);
    return interfaces.get(name).flatMap((decl) => [
      ...decl.members.flatMap((m) => {
        let type = null;
        if (ts.isMethodSignature(m)) type = m.type;
        else if (ts.isPropertySignature(m) && m.type) {
          let t = m.type;
          while (ts.isParenthesizedTypeNode(t)) t = t.type;
          if (ts.isFunctionTypeNode(t)) type = t.type;
        }
        return type && isString(type, aliases) && nameOf(m.name) ? [nameOf(m.name)] : [];
      }),
      ...(decl.heritageClauses ?? []).flatMap((h) => h.types.flatMap((t) => methods(t.expression.getText(file), seen))),
    ]);
  };
  const problems = tags.filter(([, name]) => !interfaces.has(name)).map(([tag, name]) => `<${tag}> is ${name}, which the file does not declare`);
  const elements = tags.filter(([, name]) => interfaces.has(name)).map(([tag, name]) => [tag, [...new Set(methods(name))].sort()]);
  return { elements, problems };
}

// Every types file a package.json names: `types`, `typings`, and each `types` condition in `exports`.
const typesIn = (value) => (value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => (k === 'types' && typeof v === 'string' ? [v] : typesIn(v))) : []);

/** Every element method returning a string that a package declares, as `<package> <tag>.method`. */
function declaredMethods() {
  const found = new Set();
  const elements = new Set();
  const problems = [];
  for (const dir of fs.readdirSync(path.join(root, 'packages')).sort()) {
    const at = path.join(root, 'packages', dir, 'package.json');
    if (!fs.existsSync(at)) continue;
    const pkg = JSON.parse(fs.readFileSync(at, 'utf8'));
    for (const file of new Set([pkg.types, pkg.typings, ...typesIn(pkg.exports)].filter(Boolean).map((f) => path.posix.normalize(f)))) {
      const where = path.join(root, 'packages', dir, file);
      if (!fs.existsSync(where)) {
        problems.push(`${pkg.name}: ${file} is named as types, but is not here to read`);
        continue;
      }
      const got = declaredElements(fs.readFileSync(where, 'utf8'));
      problems.push(...got.problems.map((p) => `${pkg.name} ${file}: ${p}`));
      for (const [tag, names] of got.elements) {
        elements.add(`${pkg.name} <${tag}>`);
        for (const name of names) found.add(`${pkg.name} <${tag}>.${name}`);
      }
    }
  }
  return { found, elements, problems };
}

test('every method returning a string on an element a package declares is a writer\'s method, or named with why it is not one', () => {
  const { found, elements, problems } = declaredMethods();
  assert.deepEqual(problems, []);
  assert.deepEqual([...elements].sort(), ['@portable-doc/editor <bp-paper-canvas>', '@portable-doc/editor <bp-paper-editor>'], 'the elements the declarations name');
  const methods = WRITERS.filter((w) => w.method).map((w) => `${w.package} ${w.method}`);
  assert.deepEqual([...found].filter((k) => !methods.includes(k) && !(k in NOT_A_WRITER)), [], 'declared on an element and returns a string, but neither a writer\'s method in scripts/lib/writers.mjs nor in its NOT_A_WRITER');
  assert.deepEqual([...methods, ...Object.keys(NOT_A_WRITER).filter(isMethodKey)].filter((k) => !found.has(k)), [], 'named in scripts/lib/writers.mjs, but no element declares it returning a string');
});

test('the declaration reader sees each way a method can return a string', () => {
  const text = `
    type Markdown = string;
    interface Base { inherited(): \`x\${string}\`; }
    interface El extends Base {
      plain(): string;
      notOne(): boolean;
      list(): string[];
      later(x: number): Promise<string>;
      maybe(): string | null;
      aliased(): Markdown;
      asProperty: () => string;
      callback: ((query: string) => string) | null;
      readonly value: string;
    }
    declare global { interface HTMLElementTagNameMap { "x-el": El; "x-gone": Gone } }`;
  assert.deepEqual(declaredElements(text), {
    elements: [['x-el', ['aliased', 'asProperty', 'inherited', 'later', 'maybe', 'plain']]],
    problems: ['<x-gone> is Gone, which the file does not declare'],
  });
});
