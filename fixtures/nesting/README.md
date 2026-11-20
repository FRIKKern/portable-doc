# Callout nesting

Each file is `{ markdown, blocks }`: `fromMarkdown(markdown)` in
`@portable-doc/text` gives `blocks`. The inputs are in `cases.mjs`.
`callout-101-deep-past-cap.json` is not kept, being over 64 kB; the script writes it.

Rule: a `> [!tone]` quote is a callout. Its first paragraph is `content`. Every
block after that paragraph is read as blocks into `slots.body`, sharing the
fence-id state with the rest of the doc (fences counted in reading order). A
mermaid fence there keeps its caption. A plain `>` quote holds inline content
only, so its blocks stay one text run.

Cap: callouts nest as deep as validate allows blocks, `MAX_DEPTH` (100). The
100th callout down keeps everything after its first paragraph as text, joined
to its content with single spaces, deeper `[!tone]` markers kept as literal
text; every word is kept, and `readMarkdown` gives one `nesting_kept_as_text`
notice for that callout (`callout-101-deep-past-cap`).
