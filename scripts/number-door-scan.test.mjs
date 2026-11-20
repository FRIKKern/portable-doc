// Every number that reaches React's HTML, or the text writers' output, goes through numberText
// (packages/text/number-text.js), the one door from a number to shown text. That door answers a
// number that is not finite with nothing; any other route could write "NaN" or "Infinity".
// The scan refuses every other route, with no allow-list:
//
// - packages/react/src, read with the TypeScript type checker. A route is any of:
//   - String() of a value not typed string, or String passed as a function;
//   - toString, toFixed, toPrecision, toLocaleString or toExponential called on a number;
//   - escapeHtml or escapeAttr (under any import name) given a value that may be a number;
//   - encodeURIComponent or encodeURI given a value that may hold a number;
//   - a template span, or an operand of + or += beside a string, that may hold a number;
//   - concat on a string given a value that may hold a number;
//   - join on an array or tuple that may hold a number;
//   - in a style value, a call of a number writer with an argument that may hold a number, with
//     no argument at all, or of a writer that captures, whatever it is given. A style value is
//     the text inside an open style="…" or style='…' in a template, the text after a CSS `name:`
//     in a fragment with no markup (the name a word or a span), and styleOf's write argument: an
//     inline callback, or a writer passed by reference, which is named when it captures. In a
//     write callback a call is trusted only when each such argument is the callback's own
//     parameter, the finite number styleOf hands it; styleOf leaves a property whose number is
//     not finite out whole. Writers are known by symbol: numberText, stringOf, a const naming a
//     writer, or a function in React's source whose body calls one so;
//   - inside a writer, a value it hands a number writer in any form but the 2 it follows
//     (FOLLOWED; a test pins the count, which may only shrink): a literal, and a plain
//     own-parameter name (declared with no default, not rest, not destructured). Every other form
//     is refused and makes the writer capture: a captured name, a local, a ternary, any property
//     path or element access, a call, an item or index a callback is handed, `!`, a cast, `?.`,
//     arithmetic, a destructured parameter, a default. A refusal is named with file:line in each
//     writer a style value reaches; elsewhere it only counts as capturing. A test checks that
//     the writers a style value reaches on the real source are not none, and that the functions
//     named in styleOf's write arguments match a plain search of the source;
//   - styleOf written straight into style="…" (not inside styleAttr), which writes style="" when
//     its number is not finite.
//   "May be a number" counts number, bigint, any, unknown and every union holding one of them.
//   "May hold a number" adds `object`, `{}`, an array or tuple (at any depth) of a value that may be
//   a number, and a type parameter whose constraint may hold one or that has no real constraint
//   (none, unknown or {}).
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
// - In a style: a value built without a template (string concatenation, or a join built outside
//   it); a number writer reached through an object's or a class's method, or as a value passed
//   around (its text made outside any writer, before the template); a property named by a span
//   and written with a space (`${k}: …`, read as a label). Each has a plant row that the scan
//   must not name. packages/text writes no HTML style, so the style rules read React only; a
//   style written there would go unseen.
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
const ESCAPES = new Set(['escapeHtml', 'escapeAttr']);
// An encoder writes an array through String, so a number array's NaN reaches it as "NaN".
const ENCODES = new Set(['encodeURIComponent', 'encodeURI']);
const DOOR = 'packages/text/number-text.js';
// The forms of a value handed to a number writer inside a writer that the scan follows. The test
// pins their count, which may only shrink.
const FOLLOWED = ['a literal', 'a plain own-parameter name'];
const FOLLOWED_MAX = 2;
/** Where the template text before a span leaves it: 'attr' inside an open style="…" or style='…',
 * 'decl' after a CSS declaration's `name:` in a fragment with no markup (`width:`, `--i:`, or a
 * name from a span directly before the number, `${p}:`; not `${k}: ` with a space, which is a
 * label), else null. A span stands in the text as \u0000. */
const styleContext = (text) => {
  const opens = [...text.matchAll(/style=(["'])/g)];
  const last = opens.at(-1);
  if (last && !text.includes(last[1], last.index + last[0].length)) return 'attr';
  return !text.includes('<') && /(?:^|;)\s*(?:(?:--)?[a-z][a-z-]*:[^;"']*|\u0000:)$/.test(text) ? 'decl' : null;
};

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
  const emptyObject = (u) => !!(u.flags & F.Object) && !checker.isArrayType(u) && !checker.isTupleType(u) && checker.getPropertiesOfType(u).length === 0 && u.getCallSignatures().length === 0 && !checker.getIndexInfosOfType(u).length;
  const numArray = (t) => parts(t).some((u) => (checker.isArrayType(u) || checker.isTupleType(u)) && checker.getTypeArguments(u).some((e) => mayNum(e) || numArray(e)));
  // A type parameter holds what its constraint holds; with no real constraint (none, unknown or {})
  // it may hold anything, a number too.
  const openParam = (u) => {
    const c = checker.getBaseConstraintOfType(u);
    return !c || !!(c.flags & F.Unknown) || emptyObject(c) || mayHold(c);
  };
  const mayHold = (t) => mayNum(t) || numArray(t) || parts(t).some((u) => (u.flags & F.TypeParameter ? openParam(u) : u.flags & F.NonPrimitive || emptyObject(u)));
  const calleeName = (callee) => {
    let sym = checker.getSymbolAtLocation(callee);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    return sym?.getName();
  };
  // Number writers are found by symbol, never by name. The door's are numberText and stringOf
  // (number-text.js). A function in React's source is one when its body calls a writer with an
  // argument that may hold a number, unless the call is trusted; a const that names a writer is one.
  // A call is trusted inside styleOf's write callback when each argument of it that may hold a
  // number is the callback's own parameter: the finite number styleOf hands it. A writer called
  // with no argument writes a number of its own, so it is never trusted. So does a writer that
  // captures: its body hands a number writer a value in a form the scan does not follow
  // (FOLLOWED); it is named in a style value whatever it is given.
  const symOf = (node) => {
    let sym = checker.getSymbolAtLocation(node);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    return sym;
  };
  const fromDoor = (sym, names) => !!sym && names.includes(sym.getName()) && (sym.declarations ?? []).some((d) => /number-text\.(?:d\.ts|js)$/.test(d.getSourceFile().fileName));
  const isCallOf = (n, name) => ts.isCallExpression(n) && fromDoor(symOf(n.expression), [name]);
  const writers = new Set();
  const captures = new Set();
  const isWriter = (sym) => fromDoor(sym, ['numberText', 'stringOf']) || writers.has(sym);
  const trusted = (call) => {
    let fn = call.parent;
    while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
    if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) || !isCallOf(fn.parent, 'styleOf') || fn.parent.arguments[2] !== fn) return false;
    const param = fn.parameters[0] && symOf(fn.parameters[0].name);
    return call.arguments.every((a) => !mayHold(typeOf(a)) || (!!param && ts.isIdentifier(a) && symOf(a) === param));
  };
  const writerCall = (n) =>
    ts.isCallExpression(n) &&
    isWriter(symOf(n.expression)) &&
    (n.arguments.length === 0 || captures.has(symOf(n.expression)) || (n.arguments.some((a) => mayHold(typeOf(a))) && !trusted(n)));
  // styleOf's write argument (an inline callback, or a writer passed by reference) writes a style
  // value too.
  const writeArg = (n) => (isCallOf(n, 'styleOf') ? n.arguments[2] : undefined);
  const has = (node, hit) => {
    let found = false;
    const look = (n) => {
      if (found) return;
      if (hit(n)) found = true;
      else ts.forEachChild(n, look);
    };
    look(node);
    return found;
  };
  // A styleOf call not inside a styleAttr call: written straight into style="…", it leaves
  // style="" when its number is not finite.
  const bareStyleOf = (n) => {
    if (!isCallOf(n, 'styleOf')) return false;
    for (let p = n.parent; p; p = p.parent) if (isCallOf(p, 'styleAttr')) return false;
    return true;
  };
  // What a writer fn hands a number writer is followed only in the FOLLOWED forms, tried in
  // turn; any other form is refused.
  const outside = (fn, d) => d.getSourceFile() !== fn.getSourceFile() || d.pos < fn.pos || d.end > fn.end;
  const LITERAL = new Set([ts.SyntaxKind.NumericLiteral, ts.SyntaxKind.BigIntLiteral, ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword]);
  const forms = {
    'a literal': (fn, e) =>
      LITERAL.has(e.kind) || (ts.isPrefixUnaryExpression(e) && ts.isNumericLiteral(e.operand) && (e.operator === ts.SyntaxKind.MinusToken || e.operator === ts.SyntaxKind.PlusToken)),
    // fn's own parameter, declared as a plain name with no default and not rest.
    'a plain own-parameter name': (fn, e) => {
      if (!ts.isIdentifier(e)) return false;
      const d = (symOf(e)?.declarations ?? []).find((x) => !outside(fn, x));
      return !!d && ts.isParameter(d) && d.parent === fn && ts.isIdentifier(d.name) && !d.initializer && !d.dotDotDotToken;
    },
  };
  assert.deepEqual(Object.keys(forms), FOLLOWED, 'each followed form is listed in FOLLOWED');
  const followed = (fn, e) => {
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    return FOLLOWED.some((form) => forms[form](fn, e));
  };
  // A writer captures when its body hands a number writer (in a call that is not trusted) a value
  // that may hold a number in a form it does not follow, or calls a writer that captures.
  const refusedArgs = (fn, n) =>
    ts.isCallExpression(n) && isWriter(symOf(n.expression)) && !trusted(n) ? n.arguments.filter((a) => mayHold(typeOf(a)) && !followed(fn, a)) : [];
  const capturing = (fn) => (n) => refusedArgs(fn, n).length > 0 || (ts.isCallExpression(n) && captures.has(symOf(n.expression)));
  const bodies = [];
  const aliases = [];
  for (const sf of program.getSourceFiles().filter((f) => f.fileName.startsWith(path.join(react, 'src') + path.sep))) {
    const collect = (n) => {
      if (ts.isFunctionDeclaration(n) && n.name && n.body) bodies.push([symOf(n.name), n.body]);
      else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        if (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) bodies.push([symOf(n.name), n.initializer.body]);
        else if (ts.isIdentifier(n.initializer)) aliases.push([symOf(n.name), n.initializer]);
      }
      ts.forEachChild(n, collect);
    };
    collect(sf);
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const [sym, body] of bodies) {
      if (sym && !writers.has(sym) && has(body, writerCall)) grew = !!writers.add(sym);
      if (sym && !captures.has(sym) && has(body, capturing(body.parent))) grew = !!captures.add(sym);
    }
    for (const [sym, init] of aliases) {
      if (sym && !writers.has(sym) && isWriter(symOf(init))) grew = !!writers.add(sym);
      if (sym && !captures.has(sym) && captures.has(symOf(init))) grew = !!captures.add(sym);
    }
  }
  // The refusal is named only where it decides a style: in the body of each writer a style value
  // calls (in a template's style value or in styleOf's write argument, or passed by reference as
  // write), and of each writer those call, in turn. Elsewhere it still counts as capturing.
  const bodyOf = new Map(bodies);
  const aliasOf = new Map(aliases.map(([sym, init]) => [sym, symOf(init)]));
  const reached = new Set();
  const reach = (sym) => {
    while (aliasOf.has(sym) && !reached.has(sym)) {
      reached.add(sym);
      sym = aliasOf.get(sym);
    }
    if (!sym || reached.has(sym) || !writers.has(sym)) return;
    reached.add(sym);
    const body = bodyOf.get(sym);
    if (body) ts.forEachChild(body.parent, function look(n) {
      if (ts.isCallExpression(n)) reach(symOf(n.expression));
      ts.forEachChild(n, look);
    });
  };
  const reachIn = (node) => has(node, (c) => (ts.isCallExpression(c) && reach(symOf(c.expression)), false));
  // The React functions named in styleOf's write arguments, by name: the test checks them against
  // a plain search of the source.
  const writeNames = new Set();
  const isReactFn = (sym) => bodyOf.has(sym) || aliasOf.has(sym);
  for (const sf of program.getSourceFiles().filter((f) => f.fileName.startsWith(path.join(react, 'src') + path.sep)))
    ts.forEachChild(sf, function look(n) {
      const w = writeArg(n);
      const named = (id) => isReactFn(symOf(id)) && writeNames.add(`${path.relative(root, sf.fileName)}:${sf.getLineAndCharacterOfPosition(id.getStart(sf)).line + 1} ${id.text}`);
      if (w && ts.isIdentifier(w)) {
        named(w);
        reach(symOf(w));
      } else if (w) {
        has(w, (c) => (ts.isCallExpression(c) && ts.isIdentifier(c.expression) && named(c.expression), false));
        reachIn(w);
      }
      if (ts.isTemplateExpression(n)) {
        let text = n.head.text;
        for (const span of n.templateSpans) {
          if (styleContext(text)) reachIn(span.expression);
          text += '\u0000' + span.literal.text;
        }
      }
      ts.forEachChild(n, look);
    });
  const refused = new Set();
  for (const sym of reached) {
    const body = bodyOf.get(sym);
    if (body) has(body.parent, (n) => (refusedArgs(body.parent, n).forEach((a) => refused.add(a)), false));
  }
  const found = [];
  for (const sf of program.getSourceFiles().filter((s) => files.includes(s.fileName))) {
    const rel = path.relative(root, sf.fileName);
    const seen = new Set();
    const at = (node, why) => {
      const where = `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: ${why}`;
      if (!seen.has(where)) found.push(`${where}: ${node.getText(sf).replace(/\s+/g, ' ').slice(0, 80)}`);
      seen.add(where);
    };
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const arg = node.arguments[0];
        if (ts.isIdentifier(callee) && callee.text === 'String' && !(arg && isString(typeOf(arg)))) at(node, 'String of a non-string');
        const name = calleeName(callee);
        if (ESCAPES.has(name) && arg && mayNum(typeOf(arg))) at(node, `${name} of a number`);
        if (ENCODES.has(name) && arg && mayHold(typeOf(arg))) at(node, `${name} of a number`);
        if (ts.isPropertyAccessExpression(callee)) {
          const recv = typeOf(callee.expression);
          if (METHODS.has(callee.name.text) && (mayNum(recv) || numArray(recv))) at(node, `${callee.name.text} on a number`);
          if (callee.name.text === 'join' && numArray(recv)) at(node, 'join of numbers');
          if (callee.name.text === 'concat' && isString(recv) && node.arguments.some((a) => mayHold(typeOf(a)))) at(node, 'concat of a number');
        }
        for (const a of node.arguments) if (ts.isIdentifier(a) && a.text === 'String') at(a, 'String passed as a function');
        for (const a of node.arguments) if (refused.has(a)) at(a, 'a number writer argument the scan cannot follow');
        const w = writeArg(node);
        if (w && ts.isIdentifier(w) && captures.has(symOf(w))) at(w, 'a number in a style value outside styleOf');
        else if (w) has(w, (c) => (writerCall(c) && at(c, 'a number in a style value outside styleOf'), false));
      } else if (ts.isTemplateExpression(node)) {
        let text = node.head.text;
        for (const span of node.templateSpans) {
          const where = styleContext(text);
          if (where && has(span.expression, writerCall)) at(span.expression, 'a number in a style value outside styleOf');
          if (where === 'attr' && has(span.expression, bareStyleOf)) at(span.expression, 'styleOf in a style attribute without styleAttr');
          text += '\u0000' + span.literal.text;
        }
      }
      if (ts.isTemplateSpan(node) && mayHold(typeOf(node.expression))) {
        at(node.expression, 'a template span that may hold a number');
      } else if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.PlusToken || node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken)) {
        const [l, r] = [typeOf(node.left), typeOf(node.right)];
        if ((isString(l) && mayHold(r)) || (mayHold(l) && isString(r))) at(node, 'a + operand that may hold a number');
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  found.reached = [...reached].filter((sym) => bodyOf.has(sym)).map((sym) => sym.getName()).sort();
  found.writeNames = [...writeNames].sort();
  return found;
}

/**
 * The React functions named in styleOf's write arguments, as "file:line name", found by a plain
 * search of the source text with no parser: the third argument of each `styleOf(` call, split at
 * its own commas, is a bare name or holds calls; each name a React source file declares as a
 * function (or a const naming one) counts.
 */
function writeNamesBySearch() {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) files.push(path.join(dir, e.name));
    }
  };
  walk(path.join(react, 'src'));
  const texts = files.map((f) => [path.relative(root, f), fs.readFileSync(f, 'utf8')]);
  const NAME = '[A-Za-z_$][\\w$]*';
  const declared = new Set(
    texts.flatMap(([, t]) =>
      [...t.matchAll(new RegExp(`function\\s+(${NAME})|const\\s+(${NAME})\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|${NAME})\\s*(?::[^=;]*)?=>|const\\s+(${NAME})\\s*=\\s*(${NAME})\\s*(?:;|\\n)`, 'g'))].map((m) => m[1] ?? m[2] ?? m[3]),
    ),
  );
  const out = [];
  for (const [rel, t] of texts) {
    const lineAt = (i) => t.slice(0, i).split('\n').length;
    for (const m of t.matchAll(/(?<![\w$.])styleOf\(/g)) {
      const args = [''];
      const argAt = [m.index + m[0].length];
      let depth = 1;
      let quote = null;
      for (let i = m.index + m[0].length; i < t.length && depth > 0; i++) {
        const c = t[i];
        if (quote) {
          if (c === '\\') i++;
          else if (c === quote) quote = null;
        } else if (c === "'" || c === '"') quote = c;
        else if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) depth--;
        else if (c === ',' && depth === 1) {
          args.push('');
          argAt.push(i + 1);
          continue;
        }
        if (depth > 0) args[args.length - 1] += c;
      }
      const write = args[2];
      if (write === undefined) continue;
      const lead = write.length - write.trimStart().length;
      if (new RegExp(`^\\s*${NAME}\\s*$`).test(write)) {
        if (declared.has(write.trim())) out.push(`${rel}:${lineAt(argAt[2] + lead)} ${write.trim()}`);
        continue;
      }
      for (const c of write.matchAll(new RegExp(`(?<![\\w$.])(${NAME})\\s*\\(`, 'g'))) if (declared.has(c[1])) out.push(`${rel}:${lineAt(argAt[2] + c.index)} ${c[1]}`);
    }
  }
  return [...new Set(out)].sort();
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
  assert.ok(FOLLOWED.length <= FOLLOWED_MAX, `the followed forms may only shrink: ${FOLLOWED.length} > ${FOLLOWED_MAX}`);
  const dir = fs.mkdtempSync(path.join(react, 'src', '.scan-'));
  try {
    const plant = path.join(dir, 'plant.ts');
    // One route per line; each line names the reason the scan must give for it.
    const STYLE = 'a number in a style value outside styleOf';
    const REFUSE = 'a number writer argument the scan cannot follow';
    const rows = [
      ['`${b.count}`', 'a template span that may hold a number'],
      ['String(n)', 'String of a non-string'],
      ['n.toFixed(1)', 'toFixed on a number'],
      ['eh(n)', 'escapeHtml of a number'],
      ['encodeURIComponent(n)', 'encodeURIComponent of a number'],
      ['encodeURI(n)', 'encodeURI of a number'],
      ['encodeURIComponent(xs)', 'encodeURIComponent of a number'],
      ['encodeURI(tup)', 'encodeURI of a number'],
      ['eh(xs)', null],
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
      ['`${nv}`', 'a template span that may hold a number'],
      ['`${sv}`', null],
      ["'x-' + kv", null],
      ['`${o}`', 'a template span that may hold a number'],
      ['`${ob}`', 'a template span that may hold a number'],
      ["'a'.concat(n)", 'concat of a number'],
      ["'a'.concat(String(s))", null],
      ['String(s)', null],
      ['`${s}`', null],
      ['`<i style="width:${numberText(n)}%">`', STYLE],
      ['`<i style="--i:${fmt(n)}">`', STYLE],
      ['`padding-left:${fmt(n)}px`', STYLE],
      ['`a;order:${numberText(n)}`', STYLE],
      ["`<i style='width:${numberText(n)}%'>`", STYLE],
      ['`${s}:${numberText(n)}px`', STYLE],
      ['`<i style="color:${eh(n)}">`', ['escapeHtml of a number', STYLE]],
      ['`<i style="${[\'width:\', numberText(n), \'%\'].join(\'\')}">`', STYLE],
      ['`<i style="width:${String(numberText(n))}%">`', STYLE],
      ['`<i${styleAttr([styleOf(\'width\', n, (x) => `${numberText(x)}%;height:${numberText(n)}px`)])}>`', STYLE],
      ['`<i style="${styleOf(\'width\', n)}">`', 'styleOf in a style attribute without styleAttr'],
      ['`<i${styleAttr([styleOf(\'width\', n, (x) => `${fmt(x)}%`)])}>`', null],
      ['`<i style="color:${s}">`', null],
      ['`<i style="color:${eh(s)}">`', null],
      ['`<i style="color:${ea(s)}">`', null],
      ['`${s}:${s}`', null],
      ['`<b>${numberText(n)}</b>`', null],
      ['`<i style="width:${wn()}%">`', STYLE],
      ['`<i${styleAttr([styleOf(\'width\', n, (x) => `${numberText(x)}%;height:${wn()}px`)])}>`', STYLE],
      ['`<i style="color:${nw()}">`', null],
      ['`<i style="width:${ws(s)}%">`', STYLE],
      ['`<i style="color:${wp(s)}">`', STYLE],
      ['`<i style="width:${wpc(s)}%">`', STYLE],
      ['`<i style="width:${pw(s)}px">`', STYLE],
      ['`<i style="width:${pe(s)}%">`', STYLE],
      ['`<i style="width:${pk(s, cfg)}%">`', STYLE],
      ['`<i style="color:${pkv(s, lab)}">`', STYLE],
      ['`<i style="color:${pkv(s, ob)}">`', STYLE],
      ['`<i style="width:${pr(s)}%">`', STYLE],
      ['`<i style="width:${f2(s)}%">`', STYLE],
      ['`<i style="width:${f3(s)}%">`', STYLE],
      ['`<i style="width:${f4(s, cfgs)}%">`', STYLE],
      ['`<i style="width:${f5(cfg)}%">`', STYLE],
      ['`<i style="width:${f6(s)}%">`', STYLE],
      ['`<i style="color:${f7(s, [s])}">`', STYLE],
      ['`<i style="width:${wl(s)}%">`', STYLE],
      ['`<i style="width:${g1(s)}%">`', STYLE],
      ['`<i style="width:${g2(s)}%">`', STYLE],
      ['`<i style="width:${g3(s)}%">`', STYLE],
      // styleOf's write argument writes a style value: an inline callback, and a writer by reference.
      ['`<i${styleAttr([styleOf(\'width\', n, () => `${numberText(hn)}%`)])}>`', STYLE],
      ['`<i${styleAttr([styleOf(\'width\', n, (x) => `${ws(s)}%`)])}>`', STYLE],
      ['`<i${styleAttr([styleOf(\'width\', n, (x) => fmt(hn))])}>`', STYLE],
      ['`<i${styleAttr([styleOf(\'width\', n, wr)])}>`', STYLE],
      ['`<i${styleAttr([styleOf(\'width\', n, fmt)])}>`', null],
      // Listed limits (the header's "What it cannot see"): each is a number in a style that the
      // scan does not name. Concatenation; a join built outside the template; an object's method;
      // a class's method; a value passed around; a property named by a span and written with a
      // space.
      ['\'<i style="width:\' + numberText(n) + \'%">\'', null],
      ['`<i style="${css}">`', null],
      ['`<i style="width:${W.w(n)}%">`', null],
      ['`<i style="width:${k.w(n)}%">`', null],
      ['`<i style="width:${t}%">`', null],
      ['`${s}: ${numberText(n)}px`', null],
    ];
    const head = [
      "import { escapeHtml as eh, escapeAttr as ea } from '../inline'",
      "import { numberText, stringOf, styleAttr, styleOf } from '../../../text/number-text.js'",
      'const fmt = (x: number) => numberText(x, 1)',
      'declare const hn: number',
      'const W = { w: (x: number) => numberText(x) }',
      'class K { w(x: number) { return numberText(x) } }',
      'const k = new K()',
      'const t = numberText(hn)',
      "const css = ['width:' + numberText(hn) + '%'].join(';')",
      'const wn = () => numberText(hn)',
      "const nw = () => 'red'",
      'const ws = (x: string) => x + numberText(hn)',
      'const wp = (x: string | number) => numberText(typeof x === "number" ? x : 0)',
      'const wl = (x: string) => { const m = hn; return x + numberText(m) }',
      'declare const cfg: { w: number; b: { c: number } }',
      'declare const lab: { w: string }',
      'const wpc = (x: string) => x + numberText(cfg.w)',
      'const pw = (x: string) => x + numberText(Math.PI)',
      "const pe = (x: string) => x + numberText(cfg['w'])",
      'const pk = (x: string, o: { w: number }) => x + numberText(o.w)',
      'const pkv = (x: string, o: { w: unknown }) => x + stringOf(o.w)',
      // Two writers with one refused form: pu, which no style value reaches, is silent; pr, called
      // once from a style value, is named there and refused on its own line.
      'const pu = (x: string) => x + numberText(cfg.b.c)',
      'const pr = (x: string) => x + numberText(cfg.b.c)',
      // Only a literal and a plain own-parameter name are followed: a captured name (wn, ws), a
      // ternary (wp), a local (wl), any path (wpc, pk, pkv), a call's item or index (f2-f4, f7,
      // g1-g3: a Map's or Set's forEach, an object's own map), a destructured parameter (f5) and a
      // default (f6) are refused.
      'declare const xs2: number[]',
      'declare const cfgs: { w: number }[]',
      "const f2 = (x: string) => x + xs2.map((v) => numberText(v)).join('')",
      "const f3 = (x: string) => x + cfgs.map((o) => numberText(o.w)).join('')",
      "const f4 = (x: string, os: { w: number }[]) => x + os.map((o) => numberText(o.w)).join('')",
      'const f5 = ({ w }: { w: number }) => numberText(w)',
      'const f6 = (x: string, k = cfg.w) => x + numberText(k)',
      "const f7 = (x: string, os: string[]) => x + os.map((o, i) => o + numberText(i)).join('')",
      'declare const mk: Map<number, string>',
      'declare const sk: Set<number>',
      'declare const om: { map: (f: (a: string, b: number) => string) => string }',
      'const g1 = (x: string) => { let o = x; mk.forEach((v, k) => { o += numberText(k) }); return o }',
      'const g2 = (x: string) => { let o = x; sk.forEach((a, b) => { o += numberText(b) }); return o }',
      'const g3 = (x: string) => x + om.map((a, b) => numberText(b))',
      'const wr = (x: number) => numberText(x) + numberText(hn)',
      "export const f = <T, S extends string, K extends 'a' | 'b', N extends number>(b: Record<string, unknown>, s: string, xs: number[], tup: [number, number], ro: readonly number[], v: T, o: {}, ob: object, sv: S, kv: K, nv: N) => {",
      "  if (typeof b.count !== 'number') return []",
      '  const n = b.count',
      '  return [',
    ];
    fs.writeFileSync(
      plant,
      [
        ...head,
        ...rows.map(([code]) => `    ${code},`),
        '  ]',
        '}',
        '',
      ].join('\n'),
    );
    // A refused form inside a writer is named on the writer's own line, in the head.
    const headRoutes = [
      ['const wn', REFUSE],
      ['const ws', REFUSE],
      ['const wp', REFUSE],
      ['const wl', REFUSE],
      ['const pk', REFUSE],
      ['const pkv', REFUSE],
      ['const f2', REFUSE],
      ['const f4', REFUSE],
      ['const f7', REFUSE],
      ['const g1', REFUSE],
      ['const g2', REFUSE],
      ['const g3', REFUSE],
      ['const wr', REFUSE],
      ['const wpc', REFUSE],
      ['const pw', REFUSE],
      ['const pe', REFUSE],
      ['const pr', REFUSE],
      ['const f3', REFUSE],
      ['const f5', REFUSE],
      ['const f6', REFUSE],
    ];
    const found = reactRoutes([plant]).map((r) => {
      const [, line, why] = r.match(/^[^:]*:(\d+): ([^:]*):/);
      return line <= head.length ? `${head[line - 1].split(' =')[0]} -> ${why}` : `${rows[line - head.length - 1][0]} -> ${why}`;
    });
    const expected = [...headRoutes, ...rows].flatMap(([code, why]) => [why ?? []].flat().map((w) => `${code} -> ${w}`));
    assert.deepEqual(found.sort(), expected.sort());
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
  const routes = reactRoutes();
  // The style rules read real writers: the React functions named in styleOf's write arguments
  // match a plain search of the source, none is missing from the writers a style value reaches,
  // and that set is not empty.
  assert.deepEqual(routes.writeNames, writeNamesBySearch(), "styleOf's write arguments, as the scan reads them and as a plain search finds them");
  assert.ok(routes.reached.length > 0, 'a style value reaches no real writer');
  assert.deepEqual(routes.writeNames.map((w) => w.split(' ')[1]).filter((n) => !routes.reached.includes(n)), [], 'each writer named in a write argument is reached');
  const found = [...routes, ...textFiles().flatMap((f) => textRoutes(f, fs.readFileSync(path.join(root, f), 'utf8')))];
  assert.deepEqual(found, []);
});
