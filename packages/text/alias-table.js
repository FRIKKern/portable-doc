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
  _comment: 'Second names a reader still accepts. When a block or item holds both names, the `to` name wins. An entry without `convert` is a plain rename; a `convert` kind is implemented by every reader and tested by the shared case of that kind. A key is "<owner>.<name>", split at its last ".": the owner is a block type ("code"); a block type and the path to a list of items in it, each list marked "[]" ("steps.steps[]", "task-detail.task.criteria[]"), where list.items[] covers every spelling of the list type; or "inline:" and an inline node type ("inline:text"). A name\'s types are those spec/blocks.schema.json gives it on its owner, else those of its field\'s other names; where the schema types none of a field\'s names, each reads text (a string or a finite number), but the inline side of a convert reads an array (inline-from-string\'s current name, text-from-inline\'s old name). The text-from-inline convert reads an old name\'s inline array as its flat text.',
  aliases: {
    'asciicast.poster': { to: 'asciicast.posterAt', reason: 'renamed 2026-11-19; poster means an address on every other block' },
    'blockquote.attribution': { to: 'blockquote.cite', reason: 'the schema took both; cite is the one name, as the golden uses it' },
    'blockquote.text': { to: 'blockquote.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string' },
    'callout.text': { to: 'callout.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string' },
    'code-tabs.tabs[].code': { to: 'code-tabs.tabs[].value', reason: 'a code tab\'s source, as on a code block; value is the one name, as the renderers read it first' },
    'code.code': { to: 'code.value', reason: 'four names held the code source; value is the one name, as the golden uses it' },
    'code.content': { to: 'code.value', reason: 'four names held the code source; value is the one name, as the golden uses it' },
    'code.language': { to: 'code.lang', reason: 'never in the spec; read because renderers accepted it' },
    'code.text': { to: 'code.value', reason: 'four names held the code source; value is the one name, as the golden uses it' },
    'expandable.children': { to: 'expandable.blocks', reason: 'blocks is the one name for an expandable\'s nested blocks, as the golden and the renderers use it' },
    'eyebrow.text': { to: 'eyebrow.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string' },
    'heading.text': { to: 'heading.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string' },
    'ingress.text': { to: 'ingress.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string' },
    'inline:code.children': { to: 'inline:code.value', reason: 'an inline code node\'s text; value is the one name, and children is read as its flat text', convert: 'text-from-inline' },
    'inline:text.text': { to: 'inline:text.value', reason: 'a text leaf\'s text; value is the one name, as the renderers read it first' },
    'list.items[].text': { to: 'list.items[].content', reason: 'text was a plain-string shorthand for an item\'s content; content is the one name', convert: 'inline-from-string' },
    'note.text': { to: 'note.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string' },
    'notes.items[].text': { to: 'notes.items[].content', reason: 'text was a plain-string shorthand for a note\'s content; content is the one name', convert: 'inline-from-string' },
    'paragraph.text': { to: 'paragraph.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string' },
    'pullquote.text': { to: 'pullquote.content', reason: 'text was a plain-string shorthand for content; content is the one name', convert: 'inline-from-string' },
    'steps.steps[].children': { to: 'steps.steps[].blocks', reason: 'blocks is the one name for a step\'s nested blocks, as the renderers read it first' },
    'table.cols': { to: 'table.columns', reason: 'two names for the column list; columns is the one name and gains each column\'s type from cols', convert: 'columns-from-cols' },
    'table.columns[].label': { to: 'table.columns[].text', reason: 'a column\'s head text; text is the one name, as the renderers read it first' },
    'table.header': { to: 'table.head', reason: 'header\'s array form is head; header: true means the first row is the head', convert: 'head-from-header' },
    'task-detail.criteria[].criterion': { to: 'task-detail.criteria[].text', reason: 'a criterion\'s text; text is the one name, as the renderers read it first' },
    'task-detail.task.criteria[].criterion': { to: 'task-detail.task.criteria[].text', reason: 'a criterion\'s text; text is the one name, as the renderers read it first' },
    'terminal.blocks': { to: 'terminal.children', reason: 'children is the one name for nested blocks, as on every container' },
  },
};
