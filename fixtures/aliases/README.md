# Aliases

Each file is `{ block, reads }`: for each name in `reads`, reading that field
of `block` by the alias rule (`readField` in `packages/text/read-aliases.js`)
gives its value, `null` when none is read. The cases are written by hand; they
are not generated.

The rule: a field is read under its current name first, then its old names in
table order. A name is absent when its value is undefined, null, a blank string,
an empty array, or not of a type the schema gives it. All names absent reads the
current name as stored.
