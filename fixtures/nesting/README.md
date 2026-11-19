# Callout nesting

Each file is `{ markdown, blocks }`: `fromMarkdown(markdown)` in
`@portable-doc/text` gives `blocks`. The inputs are in `cases.mjs`.
`callout-52-deep-past-cap.json` (about 120 kB) is not kept; the script writes it.

Rule: a `> [!tone]` quote is a callout. Its first paragraph is `content`. Every
block after that paragraph is read as blocks into `slots.body`, sharing the
fence-id state with the rest of the doc (fences counted in reading order). A
mermaid fence there keeps its caption. A plain `>` quote holds inline content
only, so its blocks stay one text run.

Cap: callouts read their body as blocks to 50 deep (`MAX_NEST`). The 51st
callout down keeps everything after its first paragraph as text, joined to its
content with single spaces, deeper `[!tone]` markers kept as literal text;
every word is kept and there is no notice (`callout-52-deep-past-cap`).
