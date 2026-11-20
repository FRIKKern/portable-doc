// Every number that reaches React's HTML, or the text writers' output, goes through numberText
// (packages/text/number-text.js), the one door from a number to shown text. That door answers a
// number that is not finite with nothing; any other route could write "NaN" or "Infinity". A value
// goes into a style only through the door's style functions: styleAttr writes the attribute from a
// written-out list, styleOf a number by a listed format, styleColor a colour by a listed shape.
// The scan refuses every other route: for numbers with no allow-list, for styles by one.
//
// - packages/react/src, read with the TypeScript type checker. A route is any of:
//   - String() of a value not typed string, or String passed as a function;
//   - toString, toFixed, toPrecision, toLocaleString or toExponential called on a number;
//   - escapeHtml or escapeAttr (under any import name) given a value that may be a number;
//   - encodeURIComponent or encodeURI given a value that may hold a number;
//   - a template span, or an operand of + or += beside a string, that may hold a number;
//   - concat on a string given a value that may hold a number;
//   - join on an array or tuple that may hold a number;
//   - a hole in a style that is not fixed text. A template, a string, or a + chain of them is read
//     as one text, holes and all. A style is the value of an attribute named style (any case,
//     spaces around =, quoted or not), the text of a <style> element, or, in a fragment with no
//     markup, a CSS declaration's value after `name:` (a word, -webkit- and -- names too, or a
//     hole directly before the colon). Fixed text is a value whose type is a string literal or a
//     union of them, or a ternary, ||, ??, template or + chain of fixed texts. A hole between a
//     tag's attributes (`<i${styleAttr([…])}>`) writes attributes, not a style, and is not one. A
//     word and a colon before a hole in a fragment with no markup is read as a declaration, so a
//     label like `commit:${id}` is named too: a false red, on the safe side;
//   - a styleAttr call whose list is not written out (a value, or a spread in it), and an item in
//     the list that is neither a styleOf or styleColor call nor fixed text;
//   - a styleOf or styleColor call whose property name is not fixed text;
//   - a style left open at the end of its text (`'<i style="'`), which some other text finishes;
//   - an attribute named by a hole whose type may name style: only fixed text, or a template type
//     whose fixed head cannot begin "style" (`data-${string}`), passes;
//   - a JSX style attribute or <style> element, where React writes a number as it likes;
//   - any use of styleOf, styleAttr or styleColor but a direct call or its import.
//   "May be a number" counts number, bigint, any, unknown and every union holding one of them.
//   "May hold a number" adds `object`, `{}`, an array or tuple (at any depth) of a value that may be
//   a number, and a type parameter whose constraint may hold one or that has no real constraint
//   (none, unknown or {}).
// - packages/text/*.js but the door, read by syntax only: any String() call or String passed as a
//   function, and any call of those five methods.
// A test on the real source holds that none is found, after checking that the scan read exactly the
// door's call sites and the lines opening a style that a plain search of the text finds (a code
// line assigning a name `style`, `const style = …`, is found by the search and opens none: a false
// red, on the safe side). Another holds that a style colour's check has one copy, STYLE_COLORS in
// the door.
//
// What it cannot see:
// - In packages/text there are no types, so a template span or + of a number, and a join of an
//   array of numbers, go unseen there.
//   The grid test (non-finite-grid.test.mjs) checks the output only for the values it sets: numbers,
//   and digit strings only for a form scale's bounds. A number a writer makes itself elsewhere, for
//   example by parsing a digit string, is not covered.
// - A number the code has already cast to string (`n as unknown as string`), or one reached through
//   a method held in a variable, called with call or apply, or called by element access
//   (`n['toFixed'](1)`).
// - A number used as a computed key (`{ [n]: 1 }`) whose keys are then shown.
// - In a style: a property named by a hole and written with a space (`${k}: ${v}`, read as a
//   label; a template or + chain that puts its text in a style is refused there); a style opener
//   split across pieces joined without + or a template (`['<i ', 'style', '="…'].join('')`). Each
//   has a plant row that the scan must not name. packages/text writes no HTML style, so the style
//   rules read React only; a style written there would go unseen.
// - Other converters: JSON.stringify, Intl number formats, and an object whose own toString writes
//   a number.
// - packages/editor (written only by the sync from Barkpark's paper editor), React's dist (built
//   from the scanned src), and code that writes no document: cli, mcp, code, validate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { STYLE_COLORS } from '../packages/text/number-text.js';
import { REACT_SRC, reactSources } from './lib/react-sources.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const react = path.join(root, 'packages/react');
const ts = createRequire(path.join(react, 'package.json'))('typescript');
const METHODS = new Set(['toString', 'toFixed', 'toPrecision', 'toLocaleString', 'toExponential']);
const ESCAPES = new Set(['escapeHtml', 'escapeAttr']);
// An encoder writes an array through String, so a number array's NaN reaches it as "NaN".
const ENCODES = new Set(['encodeURIComponent', 'encodeURI']);
const DOOR = 'packages/text/number-text.js';
const STYLE_DOOR = ['styleOf', 'styleAttr', 'styleColor'];
const WHY = {
  hole: 'a hole in a style that is not fixed text',
  list: 'a styleAttr list that is not written out',
  item: 'a styleAttr item that is not styleOf, styleColor or fixed text',
  prop: 'a style property name that is not fixed text',
  open: 'a style left open at the end of its text',
  name: 'an attribute named by a hole that may name style',
  jsx: 'a JSX style',
  use: 'a use of styleOf, styleAttr or styleColor the scan cannot follow',
};
// A CSS declaration's value runs on after `name:` in a fragment with no markup: the name a word
// (-webkit- and -- names too) or a hole directly before the colon; not `${k}: ` with a space, which
// is a label. A hole stands in the text as \u0000.
const DECL = /(?:^|[;{\u0000])\s*(?:-{0,2}[a-z][a-z0-9-]*\s*:[^;"'{}]*|\u0000:)$/i;

/**
 * Read one text, as pieces of text and holes, the way HTML would: for each hole, whether it sits in
 * a style, names an attribute, or neither; and whether the text ends with a style left open, and
 * where it opens one. The text may start inside a tag (` style="…"`). safeName(i) tells whether hole i,
 * naming an attribute, cannot name style.
 * @returns {{ holes: { at: number, where: 'style' | 'name' | null }[], open: boolean, opens: [number, number][] }}
 */
function readStyle(pieces, safeName) {
  const holes = [];
  const opens = [];
  let mode = 'tag';
  let tag = '';
  let name = '';
  let gap = false;
  let quote = '';
  let styled = false;
  let seen = '';
  const markup = pieces.some((p) => p.text?.includes('<'));
  const endTag = () => (mode = tag === 'style' ? 'element' : 'text');
  pieces.forEach((p, i) => {
    if (p.text === undefined) {
      let where = null;
      if ((mode === 'value' && styled) || mode === 'element') where = 'style';
      else if (mode === 'tag' && /^\s*=/.test(pieces[i + 1]?.text ?? '')) {
        where = 'name';
        name = safeName(i) ? '' : '\u0000';
        gap = false;
      } else if (!markup && DECL.test(seen)) where = 'style';
      holes.push({ at: i, where });
      seen += '\u0000';
      return;
    }
    const t = p.text;
    for (let j = 0; j < t.length; j++) {
      const c = t[j];
      const opening = mode === 'text' || mode === 'tag' ? /^<([a-z][a-z0-9-]*)/i.exec(t.slice(j)) : null;
      if (mode === 'element') {
        if (t.slice(j, j + 7).toLowerCase() === '</style') mode = 'text';
      } else if (mode === 'value') {
        if (quote ? c === quote : /\s/.test(c)) {
          mode = 'tag';
          name = '';
        }
        else if (!quote && c === '>') endTag();
      } else if (opening) {
        mode = 'tag';
        tag = opening[1].toLowerCase();
        name = '';
        gap = false;
        if (tag === 'style') opens.push([i, j]);
        j += opening[0].length - 1;
      } else if (mode === 'text') continue;
      else if (c === '>') endTag();
      else if (c === '=') {
        const v = /^\s*(["']?)/.exec(t.slice(j + 1));
        quote = v[1];
        styled = name.toLowerCase() === 'style' || name === '\u0000';
        if (styled) opens.push([i, j]);
        mode = 'value';
        j += v[0].length;
      } else if (/\s/.test(c)) gap = true;
      else if (/[/"'<]/.test(c)) name = '';
      else {
        name = gap ? c : name + c;
        gap = false;
      }
    }
    seen += t;
  });
  return { holes, open: (mode === 'value' && styled) || mode === 'element', opens };
}

/** Each route in React's source files (or only the given ones, which may sit outside them), as "file:line: why: code". */
function reactRoutes(only) {
  const config = ts.getParsedCommandLineOfConfigFile(path.join(react, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  const files = only ?? reactSources().files;
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
  const symOf = (node) => {
    let sym = checker.getSymbolAtLocation(node);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    return sym;
  };
  const fromDoor = (sym, names) => !!sym && names.includes(sym.getName()) && (sym.declarations ?? []).some((d) => /number-text\.(?:d\.ts|js)$/.test(d.getSourceFile().fileName));
  const isCallOf = (n, ...names) => ts.isCallExpression(n) && fromDoor(symOf(n.expression), names);
  const unwrap = (e) => {
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
    return e;
  };
  const isPlus = (n) => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken;
  const isText = (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);
  /** A text as pieces: { text } for its fixed parts and { hole } for each value written into it. */
  const piecesOf = (n) => {
    if (isPlus(n)) return [...piecesOf(unwrap(n.left)), ...piecesOf(unwrap(n.right))];
    if (isText(n)) return [{ text: n.text, node: n }];
    if (ts.isTemplateExpression(n)) return [{ text: n.head.text, node: n }, ...n.templateSpans.flatMap((s) => [{ hole: s.expression }, { text: s.literal.text, node: s.literal }])];
    return [{ hole: n }];
  };
  // A root is a text no bigger text holds: a template or a string, or a + chain with one in it.
  const isRoot = (n) => (isText(n) || ts.isTemplateExpression(n) || (isPlus(n) && piecesOf(n).some((p) => p.text !== undefined))) && !isPlus(unwrapUp(n)) && !(ts.isLiteralTypeNode(n.parent) || ts.isImportDeclaration(n.parent) || ts.isExportDeclaration(n.parent) || ts.isExternalModuleReference(n.parent));
  const unwrapUp = (n) => {
    let p = n.parent;
    while (p && ts.isParenthesizedExpression(p)) p = p.parent;
    return p;
  };
  const fixedType = (t) => parts(t).every((u) => u.isStringLiteral());
  const fixed = (e) => {
    e = unwrap(e);
    if (ts.isConditionalExpression(e)) return fixed(e.whenTrue) && fixed(e.whenFalse);
    if (ts.isBinaryExpression(e) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(e.operatorToken.kind)) return fixed(e.left) && fixed(e.right);
    if (ts.isTemplateExpression(e) || isPlus(e)) return piecesOf(e).every((p) => p.text !== undefined || fixed(p.hole));
    return fixedType(typeOf(e));
  };
  const item = (e) => {
    e = unwrap(e);
    if (ts.isConditionalExpression(e)) return item(e.whenTrue) && item(e.whenFalse);
    if (ts.isBinaryExpression(e) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(e.operatorToken.kind)) return item(e.left) && item(e.right);
    return isCallOf(e, 'styleOf', 'styleColor') || fixed(e);
  };
  // An attribute name from a hole passes when its type cannot spell style.
  const safeName = (t) =>
    parts(t).every((u) => {
      if (u.isStringLiteral()) return u.value.toLowerCase() !== 'style';
      const head = u.flags & F.TemplateLiteral ? u.texts[0].toLowerCase() : '';
      return head !== '' && !head.startsWith('style') && !'style'.startsWith(head);
    });
  const found = [];
  // What the scan read, so a test can show it saw the door's calls and the styles it opens.
  const doorCalls = [];
  const opens = [];
  for (const sf of program.getSourceFiles().filter((s) => files.includes(s.fileName))) {
    const rel = path.relative(root, sf.fileName);
    const lineOf = (node, offset = 0) => `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf) + offset).line + 1}`;
    const seen = new Set();
    const at = (node, why) => {
      const where = `${lineOf(node)}: ${why}`;
      if (!seen.has(where)) found.push(`${where}: ${node.getText(sf).replace(/\s+/g, ' ').slice(0, 80)}`);
      seen.add(where);
    };
    // A styleAttr item is read as an item, not again as a text.
    const items = new Set();
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
        if (isCallOf(node, ...STYLE_DOOR)) doorCalls.push(lineOf(node));
        if (isCallOf(node, 'styleOf', 'styleColor') && !(arg && fixed(arg))) at(node, WHY.prop);
        if (isCallOf(node, 'styleAttr')) {
          const list = arg && unwrap(arg);
          if (!list || !ts.isArrayLiteralExpression(list)) at(node, WHY.list);
          else
            for (const e of list.elements) {
              items.add(unwrap(e));
              if (ts.isSpreadElement(e)) at(e, WHY.list);
              else if (!item(e)) at(e, WHY.item);
            }
        }
      } else if (ts.isIdentifier(node) && fromDoor(symOf(node), STYLE_DOOR) && !ts.isImportSpecifier(node.parent)) {
        // The door's style functions are read only where called by name: an alias or a value is refused.
        const use = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node ? node.parent : node;
        if (!(ts.isCallExpression(use.parent) && use.parent.expression === use)) at(node, WHY.use);
      } else if ((ts.isJsxAttribute(node) && node.name.getText(sf).toLowerCase() === 'style') || ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sf).toLowerCase() === 'style')) {
        opens.push(lineOf(node));
        at(node, WHY.jsx);
      }
      if (isRoot(node) && !items.has(node)) {
        const pieces = piecesOf(node);
        const read = readStyle(pieces, (i) => safeName(typeOf(pieces[i].hole)));
        for (const [i, j] of read.opens) opens.push(`${rel}:${sf.getLineAndCharacterOfPosition(pieces[i].node.getStart(sf)).line + 1 + (pieces[i].text.slice(0, j).match(/\n/g) ?? []).length}`);
        for (const { at: i, where } of read.holes) {
          const hole = pieces[i].hole;
          if (where === 'style' && !fixed(hole)) at(hole, WHY.hole);
          if (where === 'name' && !safeName(typeOf(hole))) at(hole, WHY.name);
        }
        if (read.open) at(node, WHY.open);
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
  found.doorCalls = doorCalls;
  found.opens = [...new Set(opens)].sort();
  return found;
}

/**
 * A plain search of React's source text, no parser: each call of the door's style functions
 * (`styleOf(`, `styleAttr(`, `styleColor(`), and each line that opens a style (`style=`, any case,
 * or `<style`), comment lines left out, as file:line.
 */
function plainSearch(srcRoot = REACT_SRC) {
  const { files } = reactSources(srcRoot);
  const doorCalls = [];
  const opens = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const at = `${path.relative(root, f)}:${i + 1}`;
      for (const _ of line.matchAll(/\b(?:styleOf|styleAttr|styleColor)\(/g)) doorCalls.push(at);
      if (!/^\s*(?:\/\/|\/?\*)/.test(line) && /(?<![\w$])style\s*=|<style[\s>/]/i.test(line)) opens.push(at);
    });
  }
  return { doorCalls, opens };
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
  // The plants live outside the tree, so no walk of the source can see them; they import React's source by absolute path.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-scan-'));
  try {
    const plant = path.join(dir, 'plant.ts');
    const jsx = path.join(dir, 'plant.tsx');
    const { hole, list, item, prop, open, name, use } = WHY;
    // One route per line; each line names the reason the scan must give for it.
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
      ['`<b>${numberText(n)}</b>`', null],
      // A hole in a style holds fixed text only: a number writer's text, a string, a function
      // returning one, an object's or a class's method, a value passed around, styleOf written
      // straight in, each is named.
      ['`<i style="width:${numberText(n)}%">`', hole],
      ['`<i style="--i:${fmt(n)}">`', hole],
      ['`padding-left:${fmt(n)}px`', hole],
      ['`a;order:${numberText(n)}`', hole],
      ["`<i style='width:${numberText(n)}%'>`", hole],
      ['`${s}:${numberText(n)}px`', hole],
      ['`${s}:${s}`', hole],
      ['`<i style="color:${eh(n)}">`', ['escapeHtml of a number', hole]],
      ['`<i style="color:${eh(s)}">`', hole],
      ['`<i style="color:${s}">`', hole],
      ['`<i style="color:${nw()}">`', hole],
      ['`<i style="${[\'width:\', numberText(n), \'%\'].join(\'\')}">`', hole],
      ['`<i style="${styleOf(\'width\', n)}">`', hole],
      ['`<i style="width:${W.w(n)}%">`', hole],
      ['`<i style="width:${k.w(n)}%">`', hole],
      ['`<i style="width:${t}%">`', hole],
      ['`<i style="${css}">`', hole],
      // However it is spelled: concatenation, spaces, case, no quotes, a <style> element, a
      // vendor name, a style opened in another text, left open, or named by a hole.
      ['\'<i style="width:\' + numberText(n) + \'%">\'', hole],
      ['`<i style = "width:${numberText(n)}%">`', hole],
      ['`<i STYLE="width:${numberText(n)}%">`', hole],
      ['`<i style=width:${numberText(n)}%>`', hole],
      ['`<style>.x{width:${numberText(n)}px}</style>`', hole],
      ['`-webkit-transform:scale(${numberText(n)})`', hole],
      ['`${opener}width:${numberText(n)}%">`', hole],
      ['`<i style="width:${numberText(n)}`', [hole, open]],
      ['\'<i style="width:\'.concat(numberText(n), \'%">\')', open],
      ['`<i ${attr}="width:${numberText(n)}%">`', [name, hole]],
      // Fixed texts pass: a literal, a const, a function whose returns are literals, a ternary,
      // and a hole between attributes; an attribute named by a data- template type.
      ['`<i style="color:${\'red\'}">`', null],
      ['`<i style="font-family:var(--m, ${MONO})">`', null],
      ['`<i style="color:${nk()}">`', null],
      ['`<i style="color:${s ? \'red\' : \'blue\'};${`order:${\'1\'}`}">`', null],
      ['`<i ${dn}="${s}" class="${s}"${styleAttr([styleOf(\'width\', n, { after: \'%\' })])}>`', null],
      // styleAttr's list is written out, each item styleOf, styleColor or fixed text, and each
      // property name fixed text.
      ['`<i${styleAttr([styleColor(\'background\', s, { shape: \'hex\' }) || \'background:transparent\', `--g:${MONO}`])}>`', null],
      ['`<i${styleAttr([s])}>`', item],
      ['`<i${styleAttr([fmt(n), `--g:${s}`])}>`', item],
      ['`<i${styleAttr(list)}>`', list],
      ['`<i${styleAttr([...list])}>`', list],
      ['`<i${styleAttr([styleOf(s, n)])}>`', prop],
      // Listed limits (the header's "What it cannot see"): each is a number in a style that the
      // scan does not name. A property named by a hole and written with a space; an opener split
      // across pieces joined without + or a template.
      ['`${s}: ${numberText(n)}px`', null],
      ['[\'<i \', \'style\', \'="width:\', numberText(n), \'%">\'].join(\'\')', null],
    ];
    const head = [
      `import { escapeHtml as eh } from ${JSON.stringify(path.join(REACT_SRC, 'inline'))}`,
      `import { numberText, styleAttr, styleColor, styleOf } from ${JSON.stringify(path.join(root, DOOR))}`,
      'const fmt = (x: number) => numberText(x, 1)',
      'declare const hn: number',
      'const W = { w: (x: number) => numberText(x) }',
      'class K { w(x: number) { return numberText(x) } }',
      'const k = new K()',
      'const t = numberText(hn)',
      "const css = ['width:' + numberText(hn) + '%'].join(';')",
      "const nw = () => 'red'",
      "const nk = () => 'red' as const",
      "const MONO = 'mono'",
      'const opener = \'<i style="\'',
      'declare const attr: string',
      'declare const dn: `data-${string}`',
      'declare const list: string[]',
      'const so = styleOf',
      "export const f = <T, S extends string, K extends 'a' | 'b', N extends number>(b: Record<string, unknown>, s: string, xs: number[], tup: [number, number], ro: readonly number[], v: T, o: {}, ob: object, sv: S, kv: K, nv: N) => {",
      "  if (typeof b.count !== 'number') return []",
      '  const n = b.count',
      '  return [',
    ];
    fs.writeFileSync(plant, [...head, ...rows.map(([code]) => `    ${code},`), '  ]', '}', ''].join('\n'));
    // JSX writes a style object as React likes, a number too.
    const jsxRows = [
      ['<i style={{ width: hn }} />', WHY.jsx],
      ['<i style={{ width: `${numberText(hn)}%` }} />', WHY.jsx],
      ['<style>{s}</style>', WHY.jsx],
      ['<i className={s} />', null],
    ];
    const jsxHead = [`import { numberText } from ${JSON.stringify(path.join(root, DOOR))}`, 'declare const hn: number', 'declare const s: string', 'export const J = ['];
    fs.writeFileSync(jsx, [...jsxHead, ...jsxRows.map(([code]) => `  ${code},`), ']', ''].join('\n'));
    // A refused form on a line of a plant's head is named on that line.
    const headRoutes = [
      ['const css', hole],
      ['const opener', open],
      ['const so', use],
    ];
    const found = reactRoutes([plant, jsx]).map((r) => {
      const [, file, line, why] = r.match(/^([^:]*):(\d+): ([^:]*):/);
      const [h, rs] = file.endsWith('.tsx') ? [jsxHead, jsxRows] : [head, rows];
      return line <= h.length ? `${h[line - 1].split(' =')[0]} -> ${why}` : `${rs[line - h.length - 1][0]} -> ${why}`;
    });
    const expected = [...headRoutes, ...rows, ...jsxRows].flatMap(([code, why]) => [why ?? []].flat().map((w) => `${code} -> ${w}`));
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

test('no number reaches React\'s HTML or the text writers\' output outside numberText, and no value a style outside the door', () => {
  const routes = reactRoutes();
  // The scan saw the real styles: it read the door's call sites and the lines that open a style
  // that a plain search finds, the same ones exactly. Blind to either, or reading one the search
  // does not, it is red and names the site.
  const { refused } = reactSources();
  assert.deepEqual(refused, [], refused.join('\n'));
  const search = plainSearch();
  assert.ok(search.doorCalls.length > 0, 'the plain search finds no call of the door\'s style functions');
  assert.deepEqual([...routes.doorCalls].sort(), [...search.doorCalls].sort(), 'the door\'s call sites, as the scan read them and as the plain search finds them');
  assert.ok(search.opens.length > 0, 'the plain search finds no style');
  assert.deepEqual(routes.opens, [...new Set(search.opens)].sort(), 'lines opening a style, as the scan read them and as the plain search finds them');
  const styles = Object.values(WHY);
  assert.deepEqual(routes.filter((r) => styles.some((why) => r.includes(`: ${why}: `))), [], 'styles with a value outside the door');
  const found = [...routes, ...textFiles().flatMap((f) => textRoutes(f, fs.readFileSync(path.join(root, f), 'utf8')))];
  assert.deepEqual(found, []);
});

test('a style colour has one check, the door\'s', () => {
  // The one copy is STYLE_COLORS in the door. A colour pattern (# and a hex digit class) anywhere
  // else in React's source or in the door is a second copy.
  const COLOUR = /#[^\n]*\[(?:0-9a-f|a-f0-9|\\da-f)/i;
  const hits = [...reactSources().files, path.join(root, DOOR)].flatMap((f) =>
    fs.readFileSync(f, 'utf8').split('\n').flatMap((line, i) => (COLOUR.test(line) ? [`${path.relative(root, f)}:${i + 1}`] : [])),
  );
  const door = fs.readFileSync(path.join(root, DOOR), 'utf8').split('\n');
  const own = Object.values(STYLE_COLORS).map((re) => `${DOOR}:${door.findIndex((l) => l.includes(re.source)) + 1}`);
  assert.deepEqual(Object.keys(STYLE_COLORS), ['hex', 'hex6']);
  assert.deepEqual(hits, own, 'colour checks outside STYLE_COLORS');
});
