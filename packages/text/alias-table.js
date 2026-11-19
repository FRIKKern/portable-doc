// SPDX-License-Identifier: Apache-2.0
// The alias table: the second names a reader still accepts for a block field, in the shape of
// the pack's spec/read-aliases.json. Until that file is synced into spec/, this module is its
// one home here; when it is, the synced file takes TABLE's place, with a test that the two are
// equal. read-aliases.js reads fields by it; scripts/generate-alias-types.mjs derives each
// name's types from it and the schema.
//
// A plain literal, with no work at load: a bundle that imports a module beside this one but
// never reads a field leaves the table out. read-aliases.js freezes it on first use.

export const TABLE = {
  _comment: 'Second names a reader still accepts; the `to` key names the current name, and `currentWhitespaceWins` is the row\'s column \'a whitespace-only value under the current name wins\'. For each field, read the names in order: the current name first, then the old names in table order. Skip a name that is missing, null, or holds the wrong type. Where the row\'s column \'a whitespace-only value under the current name wins\' says yes, take the first remaining name whose value holds any character, whitespace included. Where it says no, take the first remaining name whose value holds a non-whitespace character, else the first that holds any character. If none does, take the first remaining name as stored. If no name remains, the field is empty. A string holds the characters it has; a non-empty array, a number or a non-empty object holds a non-whitespace character. The column is yes for a text leaf, an inline code node, a code tab and two labels (a table column, a task criterion), where main showed a whitespace-only current name; the label rows keep that for now, and a later change derives the column from the field kind. A key is "<owner>.<name>", split at its last ".": the owner is a block type ("code"); a block type and the path to a list of items in it, each list marked "[]" ("steps.steps[]", "task-detail.task.criteria[]"), where list.items[] covers every spelling of the list type; or "inline:" and an inline node type ("inline:text"). A name\'s types are those spec/blocks.schema.json gives it on its owner, else those of its field\'s other names; a name of a field the schema types none of the names of takes the types main\'s reader accepted, listed by portable-doc beside this table until the schema declares them. The text-from-inline convert reads an old name\'s inline array as its flat text.',
  aliases: {
    'asciicast.poster': { to: 'asciicast.posterAt', reason: 'renamed 2026-11-19; poster means an address on every other block', currentWhitespaceWins: false },
    'blockquote.attribution': { to: 'blockquote.cite', reason: 'the schema took both; cite is the one name, as the golden uses it', currentWhitespaceWins: false },
    'blockquote.text': { to: 'blockquote.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string', currentWhitespaceWins: false },
    'callout.text': { to: 'callout.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string', currentWhitespaceWins: false },
    'code-tabs.tabs[].code': { to: 'code-tabs.tabs[].value', reason: 'a code tab\'s source, as on a code block; value is the one name, as the renderers read it first', currentWhitespaceWins: true },
    'code.code': { to: 'code.value', reason: 'four names held the code source; value is the one name, as the golden uses it', currentWhitespaceWins: false },
    'code.content': { to: 'code.value', reason: 'four names held the code source; value is the one name, as the golden uses it', currentWhitespaceWins: false },
    'code.language': { to: 'code.lang', reason: 'never in the spec; read because renderers accepted it', currentWhitespaceWins: false },
    'code.text': { to: 'code.value', reason: 'four names held the code source; value is the one name, as the golden uses it', currentWhitespaceWins: false },
    'expandable.children': { to: 'expandable.blocks', reason: 'blocks is the one name for an expandable\'s nested blocks, as the golden and the renderers use it', currentWhitespaceWins: false },
    'eyebrow.text': { to: 'eyebrow.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string', currentWhitespaceWins: false },
    'heading.text': { to: 'heading.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string', currentWhitespaceWins: false },
    'ingress.text': { to: 'ingress.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string', currentWhitespaceWins: false },
    'inline:code.children': { to: 'inline:code.value', reason: 'an inline code node\'s text; value is the one name, and children is read as its flat text', convert: 'text-from-inline', currentWhitespaceWins: true },
    'inline:text.text': { to: 'inline:text.value', reason: 'a text leaf\'s text; value is the one name, as the renderers read it first', currentWhitespaceWins: true },
    'list.items[].text': { to: 'list.items[].content', reason: 'text was a plain-string shorthand for an item\'s content; content is the one name', convert: 'inline-from-string', currentWhitespaceWins: false },
    'note.text': { to: 'note.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string', currentWhitespaceWins: false },
    'notes.items[].text': { to: 'notes.items[].content', reason: 'text was a plain-string shorthand for a note\'s content; content is the one name', convert: 'inline-from-string', currentWhitespaceWins: false },
    'paragraph.text': { to: 'paragraph.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string', currentWhitespaceWins: false },
    'pullquote.text': { to: 'pullquote.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string', currentWhitespaceWins: false },
    'steps.steps[].children': { to: 'steps.steps[].blocks', reason: 'blocks is the one name for a step\'s nested blocks, as the renderers read it first', currentWhitespaceWins: false },
    'table.cols': { to: 'table.columns', reason: 'two names for the column list; columns is the one name and gains each column\'s type from cols', convert: 'columns-from-cols', currentWhitespaceWins: false },
    'table.columns[].label': { to: 'table.columns[].text', reason: 'a column\'s head text; text is the one name, as the renderers read it first', currentWhitespaceWins: true },
    'table.header': { to: 'table.head', reason: 'header\'s array form is head; header: true means the first row is the head', convert: 'head-from-header', currentWhitespaceWins: false },
    'task-detail.criteria[].criterion': { to: 'task-detail.criteria[].text', reason: 'a criterion\'s text; text is the one name, as the renderers read it first', currentWhitespaceWins: true },
    'task-detail.task.criteria[].criterion': { to: 'task-detail.task.criteria[].text', reason: 'a criterion\'s text; text is the one name, as the renderers read it first', currentWhitespaceWins: true },
    'terminal.blocks': { to: 'terminal.children', reason: 'children is the one name for nested blocks, as on every container', currentWhitespaceWins: false },
  },
};
