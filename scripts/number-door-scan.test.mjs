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
//   - in a style value (inside an open style="…" or style='…' in the template, or after a CSS
//     `name:` in a fragment with no markup, the name a word or a span), a template span that
//     calls a number writer with an argument that may hold a number, with no argument at all,
//     with an argument whose property the writer reads (`o.w`) where that property may hold a
//     number, or whose body turns into text a number it captures, whatever it is given. Inside a
//     writer, the scan follows only these forms of what it hands a number writer: a literal, or a
//     ternary of followable branches; a name, its own when declared in the writer (a parameter or
//     a local) and captured when declared outside; a property path rooted at a parameter, read at
//     that path where the writer is called. It refuses every other form, as capturing, and names
//     it with file:line in each writer a style value reaches: a path rooted outside the writer or
//     at a local (`cfg.w`, `Math.PI`), element access, a call, `!`, a cast, `?.`, arithmetic. A
//     path a call site's argument type does not have is refused there. Writers are known by symbol:
//     numberText, stringOf, a const naming a writer, or a function in React's source whose body
//     calls one so. Inside styleOf's write callback a call is trusted only when each such argument
//     is the callback's own parameter, the finite number styleOf hands it; styleOf leaves a
//     property whose number is not finite out whole;
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
//   around (its text made before the template); a writer given only arguments with no number,
//   whose number is a local made from a captured one (`(s: string) => { const m = n; … }`); a
//   property named by a span and written with a space (`${k}: …`, read as a label). Each has a plant row that the scan must not name. packages/text writes no HTML
//   style, so the style rules read React only; a style written there would go unseen.
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
  // with no argument writes a number of its own, so it is never trusted. So does a writer whose
  // body turns into text a number it captures (declared outside it, not one of its parameters or
  // locals), or one in a form the scan cannot follow: it is named in a style value whatever it is
  // given.
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
  // The paths at which a writer reads each of its parameters: sym -> index -> key -> names.
  const reads = new Map();
  const readsAt = (sym, i) => [...(reads.get(sym)?.get(i)?.values() ?? [])];
  const addRead = (sym, i, names) => {
    if (!reads.has(sym)) reads.set(sym, new Map());
    const at = reads.get(sym);
    if (!at.has(i)) at.set(i, new Map());
    const key = names.join('.');
    if (at.get(i).has(key)) return false;
    at.get(i).set(key, names);
    return true;
  };
  // The types at a property path of a value's type, per member of a union: a declared property,
  // else the string index type; any and unknown stay themselves. null when no member resolves.
  const typeAtPath = (t, names, where) => {
    let types = [t];
    for (const name of names) {
      types = types.flatMap((u) => {
        if (u.flags & (F.Any | F.Unknown)) return [u];
        return parts(checker.getNonNullableType(u)).flatMap((m) => {
          const apparent = checker.getApparentType(m);
          const prop = checker.getPropertyOfType(apparent, name);
          const next = prop ? checker.getTypeOfSymbolAtLocation(prop, where) : checker.getIndexTypeOfType(apparent, ts.IndexKind.String);
          return next ? [next] : [];
        });
      });
      if (!types.length) return null;
    }
    return types;
  };
  // A call's argument at a path its writer reads: 'number' when that property may hold a number,
  // 'unknown' when the path does not resolve on the argument's type, else null.
  const pathArg = (n) => {
    let out = null;
    for (const [i, byKey] of reads.get(symOf(n.expression)) ?? []) {
      const a = n.arguments[i];
      if (!a) continue;
      for (const names of byKey.values()) {
        const ts_ = typeAtPath(typeOf(a), names, a);
        if (ts_ === null) return 'unknown';
        if (ts_.some(mayHold)) out = 'number';
      }
    }
    return out;
  };
  const writerCall = (n) =>
    ts.isCallExpression(n) &&
    isWriter(symOf(n.expression)) &&
    (n.arguments.length === 0 || captures.has(symOf(n.expression)) || pathArg(n) !== null || (n.arguments.some((a) => mayHold(typeOf(a))) && !trusted(n)));
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
  // What a writer fn hands a number writer, in the forms the scan follows: a literal (or a
  // ternary of followable branches); a name declared in fn, its parameters' and locals' own; a
  // name declared outside fn, captured; or a property path rooted at a parameter of fn, read at
  // that path (`x.w`) and checked where fn is called. Any other form is refused: a path rooted
  // outside fn or at a local, element access, a call, `!`, a cast, `?.`, arithmetic.
  const outside = (fn, d) => d.getSourceFile() !== fn.getSourceFile() || d.pos < fn.pos || d.end > fn.end;
  const LITERAL = new Set([ts.SyntaxKind.NumericLiteral, ts.SyntaxKind.BigIntLiteral, ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword]);
  const REFUSED = { kind: 'refused' };
  const follow = (fn, e) => {
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (LITERAL.has(e.kind) || (ts.isPrefixUnaryExpression(e) && ts.isNumericLiteral(e.operand) && (e.operator === ts.SyntaxKind.MinusToken || e.operator === ts.SyntaxKind.PlusToken))) return { kind: 'own', reads: [] };
    if (ts.isConditionalExpression(e)) {
      const both = [follow(fn, e.whenTrue), follow(fn, e.whenFalse)];
      if (both.some((r) => r.kind === 'refused')) return REFUSED;
      if (both.some((r) => r.kind === 'captured')) return { kind: 'captured' };
      return { kind: 'own', reads: both.flatMap((r) => r.reads) };
    }
    const names = [];
    let root = e;
    while (ts.isPropertyAccessExpression(root) && !(root.flags & ts.NodeFlags.OptionalChain) && ts.isIdentifier(root.name)) {
      names.unshift(root.name.text);
      root = root.expression;
    }
    if (!ts.isIdentifier(root) || root.flags & ts.NodeFlags.OptionalChain) return REFUSED;
    const decls = symOf(root)?.declarations ?? [];
    if (!decls.length) return REFUSED;
    const param = decls.find((d) => ts.isParameter(d) && d.parent === fn && ts.isIdentifier(d.name));
    const at = param ? fn.parameters.indexOf(param) : -1;
    if (!names.length) return decls.every((d) => outside(fn, d)) ? { kind: 'captured' } : { kind: 'own', reads: at >= 0 ? [[at, []]] : [] };
    if (at >= 0) return { kind: 'own', reads: [[at, names]] };
    // A path rooted at a parameter of a function inside fn (a callback's item) is its own.
    if (decls.every((d) => ts.isParameter(d) && !outside(fn, d))) return { kind: 'own', reads: [] };
    return REFUSED;
  };
  // Reads a writer body: true when it learns something new about sym (a capture or a read path).
  const readBody = (sym, fn, body) => {
    let grew = false;
    const look = (n) => {
      if (ts.isCallExpression(n) && isWriter(symOf(n.expression))) {
        const callee = symOf(n.expression);
        if (captures.has(callee) && !captures.has(sym)) grew = !!captures.add(sym);
        n.arguments.forEach((a, i) => {
          const paths = readsAt(callee, i);
          const whole = mayHold(typeOf(a));
          if (!whole && !paths.length) return;
          const r = follow(fn, a);
          if (r.kind !== 'own') {
            if (!captures.has(sym)) grew = !!captures.add(sym);
            return;
          }
          for (const [j, q] of r.reads) {
            if (whole && q.length && addRead(sym, j, q)) grew = true;
            for (const p of paths) if (addRead(sym, j, [...q, ...p])) grew = true;
          }
        });
      }
      ts.forEachChild(n, look);
    };
    look(body);
    return grew;
  };
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
      if (sym && readBody(sym, body.parent, body)) grew = true;
    }
    for (const [sym, init] of aliases) {
      if (sym && !writers.has(sym) && isWriter(symOf(init))) grew = !!writers.add(sym);
      if (sym && !captures.has(sym) && captures.has(symOf(init))) grew = !!captures.add(sym);
      for (const [i, byKey] of (sym && reads.get(symOf(init))) || []) for (const names of byKey.values()) if (addRead(sym, i, names)) grew = true;
    }
  }
  // The refusal is asked only where it decides a style: in the body of each writer a style value
  // calls, and of each writer those call, in turn.
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
  for (const sf of program.getSourceFiles().filter((f) => f.fileName.startsWith(path.join(react, 'src') + path.sep)))
    ts.forEachChild(sf, function look(n) {
      if (ts.isTemplateExpression(n)) {
        let text = n.head.text;
        for (const span of n.templateSpans) {
          if (styleContext(text)) has(span.expression, (c) => (ts.isCallExpression(c) && reach(symOf(c.expression)), false));
          text += '\u0000' + span.literal.text;
        }
      }
      ts.forEachChild(n, look);
    });
  const refused = new Set();
  for (const sym of reached) {
    const body = bodyOf.get(sym);
    if (body) ts.forEachChild(body.parent, function look(n) {
      if (ts.isCallExpression(n) && isWriter(symOf(n.expression)))
        n.arguments.forEach((a, i) => {
          if ((mayHold(typeOf(a)) || readsAt(symOf(n.expression), i).length) && follow(body.parent, a).kind === 'refused') refused.add(a);
        });
      ts.forEachChild(n, look);
    });
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
        const writer = symOf(callee);
        for (const a of node.arguments) if (refused.has(a)) at(a, 'a number writer argument the scan cannot follow');
        if (isWriter(writer) && pathArg(node) === 'unknown') at(node, 'a number writer argument the scan cannot follow');
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
      ['`<i style="color:${wp(s)}">`', null],
      ['`<i style="width:${wpc(s)}%">`', STYLE],
      ['`<i style="width:${pw(s)}px">`', STYLE],
      ['`<i style="width:${pe(s)}%">`', STYLE],
      ['`<i style="width:${pk(s, cfg)}%">`', STYLE],
      ['`<i style="color:${pkv(s, lab)}">`', null],
      ['`<i style="color:${pkv(s, ob)}">`', [STYLE, REFUSE]],
      // Listed limits (the header's "What it cannot see"): each is a number in a style that the
      // scan does not name. Concatenation; a join built outside the template; an object's method;
      // a class's method; a value passed around; a writer given only arguments with no number,
      // whose number is a local made from a captured one; a property named by a span and written
      // with a space.
      ['\'<i style="width:\' + numberText(n) + \'%">\'', null],
      ['`<i style="${css}">`', null],
      ['`<i style="width:${W.w(n)}%">`', null],
      ['`<i style="width:${k.w(n)}%">`', null],
      ['`<i style="width:${t}%">`', null],
      ['`<i style="width:${wl(s)}%">`', null],
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
      ['const wpc', REFUSE],
      ['const pw', REFUSE],
      ['const pe', REFUSE],
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
  const found = [...reactRoutes(), ...textFiles().flatMap((f) => textRoutes(f, fs.readFileSync(path.join(root, f), 'utf8')))];
  assert.deepEqual(found, []);
});
