# Aliases

Each file is `{ block, reads }`: each key in `reads`, read on `block` by the
alias rule, gives its value, `null` when the field is empty. The value is the
stored value of the name read, before any convert. The cases are written by
hand; they are not generated.

A key is a field of the block (`"cite"`), a path to an item and its field
(`"columns[0].text"`, `"task.criteria[0].text"`), or a path to an inline node in
the block's content and its field (`"content[1].value"`). An item's field is
read under its owner in the alias table: the block type and the path
(`table.columns[]`), with a list of any spelling read as `list`. An inline
node's owner is its type (`inline:code`).

The rule, written here from `packages/text/alias-table.js` by
`scripts/write-readme.mjs`:

<!-- alias-rule:start -->
For each field, read the names in order: the current name first, then the old names in table order. Skip a name that is missing, null, or holds the wrong type. Where the row's column 'a whitespace-only value under the current name wins' says yes, take the first remaining name whose value holds any character, whitespace included. Where it says no, take the first remaining name whose value holds a non-whitespace character, else the first that holds any character. If none does, take the first remaining name as stored. If no name remains, the field is empty. A string holds the characters it has; a non-empty array, a number or a non-empty object holds a non-whitespace character.
<!-- alias-rule:end -->

The column 'a whitespace-only value under the current name wins' is each table
row's `currentWhitespaceWins`. A name's types come from
`spec/blocks.schema.json` on its owner, or from `UNTYPED` in
`scripts/generate-alias-types.mjs` where the schema types none of a field's
names. A field typed as text reads a string or a finite number.
