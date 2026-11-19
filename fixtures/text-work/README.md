# Text work

The import counts its work from the text before it parses (`import-work.js`).
These cases let another importer check it counts and cuts the same way.

- `rules.mjs`: the rules in words, as both case files carry them.
- `rule-reader.mjs`: the rules done from their words alone, apart from
  `import-work.js`; the test compares the two.
- `cases.mjs`: each case's text and, for a cut case, its limits.

The script writes two files from these. Both are over 64 kB, so neither is kept:

- `work-cases.json`: `{ rules, cases: { name: { markdown, depths, work, cut } } }`.
  `depths` is each line's depth, `work` the count of the whole text and `cut`
  the first line (from 0) past the budget of 16,000,000, or null. A text too big
  to store is `{ generator, work, cut, lines, bytes }`, with `generator` saying
  how it is built.
- `cut-cases.json`: `{ rules, cases: { name: { markdown, limits, blocks, notices, work } } }`:
  `readMarkdown(markdown, limits)`. One text too big to store gives its
  `generator` and a described paragraph.
