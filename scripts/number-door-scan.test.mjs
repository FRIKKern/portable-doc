// Every number that reaches React's HTML, or the text writers' output, goes through numberText
// (packages/text/number-text.js), the one door from a number to shown text. That door answers a
// number that is not finite with nothing; any other route could write "NaN" or "Infinity".
// The scan refuses every other route, with no allow-list:
//
// - packages/react/src, read with the TypeScript type checker. A route is String() of a value
//   not typed string, or String passed as a function; toString, toFixed, toPrecision,
//   toLocaleString or toExponential called on a number; escapeHtml or escapeAttr (under any import
//   name) given a value that may be a number; a template span, or an operand of + or += beside a
//   string, typed number; join on an array of numbers. "May be a number" counts number, bigint,
//   any, unknown and every union holding one of them.
// - packages/text/*.js but the door, read by syntax only: any String() call or String passed as a
//   function, and any call of those five methods.
//
// What it cannot see:
// - In packages/text there are no types, so a template span or + of a number goes unseen there.
//   The grid test (non-finite-grid.test.mjs) catches the output instead.
// - A number the code has already cast to string (`n as unknown as string`), or one reached through
//   a method held in a variable or called with call or apply.
// - Other converters: JSON.stringify, Intl number formats, and an object whose own toString writes
//   a number.
// - packages/editor (written only by the sync from Barkpark's paper editor), React's dist (built
//   from the scanned src), and code that writes no document: cli, mcp, code, validate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const react = path.join(root, 'packages/react');
const ts = createRequire(path.join(react, 'package.json'))('typescript');
const METHODS = new Set(['toString', 'toFixed', 'toPrecision', 'toLocaleString', 'toExponential']);
const DOOR = 'packages/text/number-text.js';

/** Each route in React's source files (or the given ones), as "file:line: why: code". */
function reactRoutes(only) {
  const config = ts.getParsedCommandLineOfConfigFile(path.join(react, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  const files = only ?? config.fileNames.filter((f) => f.startsWith(path.join(react, 'src') + path.sep));
  const program = ts.createProgram(files, config.options);
  const checker = program.getTypeChecker();
  const F = ts.TypeFlags;
  const parts = (t) => (t.isUnion() ? t.types : [t]);
  const typeOf = (node) => checker.getTypeAtLocation(node);
  const mayNum = (t) => parts(t).some((u) => u.flags & (F.NumberLike | F.BigIntLike | F.Any | F.Unknown));
  const isString = (t) => parts(t).every((u) => u.flags & F.StringLike);
  const numArray = (t) => checker.isArrayType(t) && mayNum(checker.getTypeArguments(t)[0]);
  const calleeName = (callee) => {
    let sym = checker.getSymbolAtLocation(callee);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    return sym?.getName();
  };
  const found = [];
  for (const sf of program.getSourceFiles().filter((s) => files.includes(s.fileName))) {
    const rel = path.relative(root, sf.fileName);
    const at = (node, why) => found.push(`${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: ${why}: ${node.getText(sf).replace(/\s+/g, ' ').slice(0, 80)}`);
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const arg = node.arguments[0];
        if (ts.isIdentifier(callee) && callee.text === 'String' && !(arg && isString(typeOf(arg)))) at(node, 'String of a non-string');
        const name = calleeName(callee);
        if ((name === 'escapeHtml' || name === 'escapeAttr') && arg && mayNum(typeOf(arg))) at(node, `${name} of a number`);
        if (ts.isPropertyAccessExpression(callee)) {
          const recv = typeOf(callee.expression);
          if (METHODS.has(callee.name.text) && (mayNum(recv) || numArray(recv))) at(node, `${callee.name.text} on a number`);
          if (callee.name.text === 'join' && numArray(recv)) at(node, 'join of numbers');
        }
        for (const a of node.arguments) if (ts.isIdentifier(a) && a.text === 'String') at(a, 'String passed as a function');
      } else if (ts.isTemplateSpan(node) && mayNum(typeOf(node.expression))) {
        at(node.expression, 'a template span typed number');
      } else if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.PlusToken || node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken)) {
        const [l, r] = [typeOf(node.left), typeOf(node.right)];
        if ((isString(l) && mayNum(r)) || (mayNum(l) && isString(r))) at(node, 'a + operand typed number');
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

/** Each route in a text writer's source, by syntax, as "file:line: why: code". */
function textRoutes(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found = [];
  const at = (node, why) => found.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: ${why}: ${node.getText(sf).replace(/\s+/g, ' ').slice(0, 80)}`);
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'String') at(node, 'a String() call');
      if (ts.isPropertyAccessExpression(node.expression) && METHODS.has(node.expression.name.text)) at(node, `a ${node.expression.name.text} call`);
      for (const a of node.arguments) if (ts.isIdentifier(a) && a.text === 'String') at(a, 'String passed as a function');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const textFiles = () =>
  fs.readdirSync(path.join(root, 'packages/text')).filter((f) => f.endsWith('.js')).map((f) => `packages/text/${f}`).filter((f) => f !== DOOR).sort();

test('the scan finds each route it names, in React by type and in text by syntax', () => {
  const dir = fs.mkdtempSync(path.join(react, 'src', '.scan-'));
  try {
    const plant = path.join(dir, 'plant.ts');
    fs.writeFileSync(
      plant,
      [
        "import { escapeHtml as eh } from '../inline'",
        'export const f = (b: Record<string, unknown>, s: string, xs: number[]) => {',
        "  if (typeof b.count !== 'number') return s",
        '  const n = b.count',
        '  return `${b.count}` + String(n) + n.toFixed(1) + eh(n) + xs.join() + xs.map(String).join() + (s + n) + String(s)',
        '}',
        '',
      ].join('\n'),
    );
    const found = reactRoutes([plant]).map((r) => r.replace(/^[^:]*:\d+: /, '').replace(/: .*$/, ''));
    assert.deepEqual(found.sort(), [
      'String of a non-string',
      'String passed as a function',
      'a + operand typed number',
      'a template span typed number',
      'escapeHtml of a number',
      'join of numbers',
      'toFixed on a number',
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(textRoutes('t.js', 'a(String(n), xs.map(String), n.toFixed(1), n.toPrecision(2), `${n}`, s + n);\n').map((r) => r.split(': ')[1]), [
    'a String() call',
    'String passed as a function',
    'a toFixed call',
    'a toPrecision call',
  ]);
});

test('no number reaches React\'s HTML or the text writers\' output outside numberText', () => {
  const found = [...reactRoutes(), ...textFiles().flatMap((f) => textRoutes(f, fs.readFileSync(path.join(root, f), 'utf8')))];
  assert.deepEqual(found, []);
});
