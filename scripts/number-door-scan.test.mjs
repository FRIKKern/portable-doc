// Every number that reaches React's HTML, or the text writers' output, goes through numberText
// (packages/text/number-text.js), the one door from a number to shown text. That door answers a
// number that is not finite with nothing; any other route could write "NaN" or "Infinity".
// The scan refuses every other route, with no allow-list:
//
// - packages/react/src, read with the TypeScript type checker. A route is any of:
//   - String() of a value not typed string, or String passed as a function;
//   - toString, toFixed, toPrecision, toLocaleString or toExponential called on a number;
//   - escapeHtml, escapeAttr, encodeURIComponent or encodeURI (under any import name) given a value
//     that may be a number;
//   - a template span, or an operand of + or += beside a string, that may hold a number;
//   - concat on a string given a value that may hold a number;
//   - join on an array or tuple that may hold a number.
//   "May be a number" counts number, bigint, any, unknown and every union holding one of them.
//   "May hold a number" adds a type parameter, `object`, `{}`, and an array or tuple (at any depth)
//   of a value that may be a number.
// - packages/text/*.js but the door, read by syntax only: any String() call or String passed as a
//   function, and any call of those five methods.
//
// What it cannot see:
// - In packages/text there are no types, so a template span or + of a number, and a join of an
//   array of numbers, go unseen there.
//   The grid test (non-finite-grid.test.mjs) checks the output only for the values it sets, and
//   it sets numbers, never digit strings. A number a writer makes itself, for example by parsing a
//   digit string, is not covered: a form scale bound given as a digit string too large for a
//   number writes "-Infinity" in text (the todo test in non-finite-grid.test.mjs).
// - A number the code has already cast to string (`n as unknown as string`), or one reached through
//   a method held in a variable, called with call or apply, or called by element access
//   (`n['toFixed'](1)`).
// - A number used as a computed key (`{ [n]: 1 }`) whose keys are then shown.
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
const ESCAPES = new Set(['escapeHtml', 'escapeAttr', 'encodeURIComponent', 'encodeURI']);
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
  const F_OBJ = F.TypeParameter | F.NonPrimitive;
  const emptyObject = (u) => !!(u.flags & F.Object) && !checker.isArrayType(u) && !checker.isTupleType(u) && checker.getPropertiesOfType(u).length === 0 && u.getCallSignatures().length === 0 && !checker.getIndexInfosOfType(u).length;
  const numArray = (t) => parts(t).some((u) => (checker.isArrayType(u) || checker.isTupleType(u)) && checker.getTypeArguments(u).some((e) => mayNum(e) || numArray(e)));
  const mayHold = (t) => mayNum(t) || numArray(t) || parts(t).some((u) => u.flags & F_OBJ || emptyObject(u));
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
        if (ESCAPES.has(name) && arg && mayNum(typeOf(arg))) at(node, `${name} of a number`);
        if (ts.isPropertyAccessExpression(callee)) {
          const recv = typeOf(callee.expression);
          if (METHODS.has(callee.name.text) && (mayNum(recv) || numArray(recv))) at(node, `${callee.name.text} on a number`);
          if (callee.name.text === 'join' && numArray(recv)) at(node, 'join of numbers');
          if (callee.name.text === 'concat' && isString(recv) && node.arguments.some((a) => mayHold(typeOf(a)))) at(node, 'concat of a number');
        }
        for (const a of node.arguments) if (ts.isIdentifier(a) && a.text === 'String') at(a, 'String passed as a function');
      } else if (ts.isTemplateSpan(node) && mayHold(typeOf(node.expression))) {
        at(node.expression, 'a template span that may hold a number');
      } else if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.PlusToken || node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken)) {
        const [l, r] = [typeOf(node.left), typeOf(node.right)];
        if ((isString(l) && mayHold(r)) || (mayHold(l) && isString(r))) at(node, 'a + operand that may hold a number');
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
    // One route per line; each line names the reason the scan must give for it.
    const rows = [
      ['`${b.count}`', 'a template span that may hold a number'],
      ['String(n)', 'String of a non-string'],
      ['n.toFixed(1)', 'toFixed on a number'],
      ['eh(n)', 'escapeHtml of a number'],
      ['encodeURIComponent(n)', 'encodeURIComponent of a number'],
      ['encodeURI(n)', 'encodeURI of a number'],
      ['xs.join()', 'join of numbers'],
      ['tup.join()', 'join of numbers'],
      ['[tup].join()', 'join of numbers'],
      ['ro.join()', 'join of numbers'],
      ['xs.map(String).join()', 'String passed as a function'],
      ['s + n', 'a + operand that may hold a number'],
      ['s + xs', 'a + operand that may hold a number'],
      ['s + tup', 'a + operand that may hold a number'],
      ['`${xs}`', 'a template span that may hold a number'],
      ['`${tup}`', 'a template span that may hold a number'],
      ['`${v}`', 'a template span that may hold a number'],
      ['`${o}`', 'a template span that may hold a number'],
      ['`${ob}`', 'a template span that may hold a number'],
      ["'a'.concat(n)", 'concat of a number'],
      ["'a'.concat(String(s))", null],
      ['String(s)', null],
      ['`${s}`', null],
    ];
    fs.writeFileSync(
      plant,
      [
        "import { escapeHtml as eh } from '../inline'",
        'export const f = <T,>(b: Record<string, unknown>, s: string, xs: number[], tup: [number, number], ro: readonly number[], v: T, o: {}, ob: object) => {',
        "  if (typeof b.count !== 'number') return []",
        '  const n = b.count',
        '  return [',
        ...rows.map(([code]) => `    ${code},`),
        '  ]',
        '}',
        '',
      ].join('\n'),
    );
    const found = reactRoutes([plant]).map((r) => { const [, line, why] = r.match(/^[^:]*:(\d+): ([^:]*):/); return `${rows[line - 6][0]} -> ${why}`; });
    assert.deepEqual(found.sort(), rows.filter(([, why]) => why).map(([code, why]) => `${code} -> ${why}`).sort());
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
