// Every styleOf call in React's source writes its number by a format named in STYLE_FORMATS, with
// texts before and after it from STYLE_BEFORE and STYLE_AFTER (packages/text/number-text.js).
// The calls are counted three ways, and the three counts must be one number, not 0:
// - the calls a plain search of the source finds (the text `styleOf(`);
// - the calls whose format is listed: no format (digits), or a value whose type is one listed name;
// - the calls whose before and after are listed: none, or a value whose type is a union of listed
//   texts only, as a literal, a const or a ternary of them gives.
// A function, a name or text off the lists, a template whose holes are not fixed strings, or a third
// argument that is not an object literal is not listed. The type checker refuses the same calls; the
// plant test shows both.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { STYLE_AFTER, STYLE_BEFORE, STYLE_FORMATS } from '../packages/text/number-text.js';
import { reactSources } from './lib/react-sources.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const react = path.join(root, 'packages/react');
const ts = createRequire(path.join(react, 'package.json'))('typescript');
const LISTS = { format: Object.keys(STYLE_FORMATS), before: [...STYLE_BEFORE], after: [...STYLE_AFTER] };

/** The plain search: each `styleOf(` in the files' text. */
const plainCount = (files) => files.reduce((n, f) => n + (fs.readFileSync(f, 'utf8').match(/\bstyleOf\(/g) ?? []).length, 0);

/** Each styleOf call the type checker sees, with whether its format and its texts are listed, and the checker's errors by line. */
function check(files) {
  const config = ts.getParsedCommandLineOfConfigFile(path.join(react, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  const program = ts.createProgram([...new Set([...config.fileNames, ...files])], config.options);
  const checker = program.getTypeChecker();
  const listed = (type, list) => (type.isUnion() ? type.types : [type]).every((u) => u.isStringLiteral() && list.includes(u.value));
  const calls = [];
  const errors = [];
  for (const sf of program.getSourceFiles().filter((s) => files.includes(s.fileName))) {
    const line = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    for (const d of program.getSemanticDiagnostics(sf)) errors.push(`${path.relative(root, sf.fileName)}:${sf.getLineAndCharacterOfPosition(d.start).line + 1}`);
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'styleOf') {
        const how = node.arguments[2];
        const value = (name) => {
          if (!how) return true;
          if (!ts.isObjectLiteralExpression(how)) return false;
          const prop = how.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === name);
          if (!prop) return true;
          if (ts.isShorthandPropertyAssignment(prop)) return listed(checker.getTypeOfSymbolAtLocation(checker.getShorthandAssignmentValueSymbol(prop), prop), LISTS[name]);
          return ts.isPropertyAssignment(prop) && listed(checker.getTypeAtLocation(prop.initializer), LISTS[name]);
        };
        const known = !how || (ts.isObjectLiteralExpression(how) && how.properties.every((p) => p.name && ts.isIdentifier(p.name) && p.name.text in LISTS));
        calls.push({ at: `${path.relative(root, sf.fileName)}:${line(node)}`, format: known && value('format'), texts: known && value('before') && value('after') });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { calls, errors };
}

test('every styleOf call in React writes a listed format with listed texts: three counts, one number', () => {
  const { files, refused } = reactSources();
  assert.deepEqual(refused, [], 'dot-named or git-ignored folders or source files under React\'s source');
  const found = plainCount(files);
  const { calls } = check(files);
  assert.ok(found > 0, 'the plain search finds no styleOf call');
  assert.equal(calls.length, found, 'calls the type checker sees, and the plain search');
  assert.deepEqual(calls.filter((c) => !c.format).map((c) => c.at), [], 'a format not on the list');
  assert.deepEqual(calls.filter((c) => !c.texts).map((c) => c.at), [], 'a text not on the lists');
  assert.deepEqual([found, calls.filter((c) => c.format).length, calls.filter((c) => c.texts).length], [found, found, found]);
});

test('a call off the lists is refused by the type checker and not counted as listed', () => {
  // The plant lives outside the tree, so no walk of the source can see it; it imports the door by absolute path.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-style-'));
  try {
    const plant = path.join(dir, 'plant.ts');
    // One call per line: [code, refused by the type checker, format listed, texts listed].
    const rows = [
      ["styleOf('width', n, { format: 'hundredths' })", true, false, true],
      ["styleOf('width', n, { before: 'auto ' })", true, true, false],
      ["styleOf('width', n, { after: `${s}%` })", true, true, false],
      ["styleOf('width', n, { after: `${n}px` })", true, true, false],
      ["styleOf('width', n, (x: number) => `${x}%`)", true, false, false],
      ["styleOf('width', n, { after: s })", true, true, false],
      ["styleOf('width', n, { format: f })", true, false, true],
      ["styleOf('width', n, { before: b ? 'repeat(' : 'auto repeat(', after: '%' })", false, true, true],
      ["styleOf('width', n, { before: `${b ? 'auto ' : ''}repeat(` })", false, true, true],
      ["styleOf('width', n, { format: 'tenths', after: lit })", false, true, true],
      ["styleOf('width', n)", false, true, true],
    ];
    const head = [
      `import { styleOf } from ${JSON.stringify(path.join(root, 'packages/text/number-text.js'))}`,
      "export const f = (n: number, s: string, b: boolean, f: string) => {",
      "  const lit = b ? ',12px)' : 'px'",
      '  return [',
    ];
    fs.writeFileSync(plant, [...head, ...rows.map(([code]) => `    ${code},`), '  ]', '}', ''].join('\n'));
    const { calls, errors } = check([plant]);
    const rel = path.relative(root, plant);
    const lineOf = (i) => `${rel}:${head.length + 1 + i}`;
    assert.equal(plainCount([plant]), rows.length);
    assert.deepEqual(
      rows.map(([code, refused, format, texts], i) => [code, errors.includes(lineOf(i)), calls.find((c) => c.at === lineOf(i))?.format, calls.find((c) => c.at === lineOf(i))?.texts]),
      rows,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
