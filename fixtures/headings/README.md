# Headings

Each file is `{ markdown, blocks }`: `fromMarkdown(markdown)` in
`@portable-doc/text` gives `blocks`. The inputs are in `cases.mjs`.

Rule: a heading's text is inline content, as a paragraph's: its marks and links
are kept as nodes, not flattened to plain text.
