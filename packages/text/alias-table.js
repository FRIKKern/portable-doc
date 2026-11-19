// SPDX-License-Identifier: Apache-2.0
// The alias table: the second names a reader still accepts for a block field, in the shape of
// the pack's spec/read-aliases.json. Until that file is synced into spec/, this module is its
// one home here; when it is, the synced file takes TABLE's place, with a test that the two are
// equal. read-aliases.js reads fields by it; scripts/generate-alias-types.mjs derives each
// name's types from it and the schema.

const deepFreeze = (value) => {
  if (value && typeof value === 'object') for (const inner of Object.values(Object.freeze(value))) deepFreeze(inner);
  return value;
};

export const TABLE = deepFreeze({
  _comment: 'Second names a reader still accepts. When a block holds both names, the `to` name wins. An entry without `convert` is a plain rename; a `convert` kind is implemented by every reader and tested by the shared case of that kind.',
  aliases: {
    'asciicast.poster': { to: 'asciicast.posterAt', reason: 'renamed 2026-11-19; poster means an address on every other block' },
    'blockquote.attribution': { to: 'blockquote.cite', reason: 'the schema took both; cite is the one name, as the golden uses it' },
    'callout.text': { to: 'callout.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string' },
    'code.code': { to: 'code.value', reason: 'four names held the code source; value is the one name, as the golden uses it' },
    'code.content': { to: 'code.value', reason: 'four names held the code source; value is the one name, as the golden uses it' },
    'code.language': { to: 'code.lang', reason: 'never in the spec; read because renderers accepted it' },
    'code.text': { to: 'code.value', reason: 'four names held the code source; value is the one name, as the golden uses it' },
    'expandable.children': { to: 'expandable.blocks', reason: 'blocks is the one name for an expandable\'s nested blocks, as the golden and the renderers use it' },
    'eyebrow.text': { to: 'eyebrow.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string' },
    'heading.text': { to: 'heading.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string' },
    'paragraph.text': { to: 'paragraph.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string' },
    'pullquote.text': { to: 'pullquote.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string' },
    'table.cols': { to: 'table.columns', reason: 'two names for the column list; columns is the one name and gains each column\'s type from cols', convert: 'columns-from-cols' },
    'table.header': { to: 'table.head', reason: 'header\'s array form is head; header: true means the first row is the head', convert: 'head-from-header' },
    'terminal.blocks': { to: 'terminal.children', reason: 'children is the one name for nested blocks, as on every container' },
  },
});
