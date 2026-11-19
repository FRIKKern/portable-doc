# Callout nesting: shared import cases

Each file is `{ markdown, blocks }`: `fromMarkdown(markdown)` in @portable-doc/text gives `blocks` as of PR #105, merged as ba8383d.

Rule: a `> [!tone]` quote is a callout. Its first paragraph is `content`. Every block after that paragraph is read as blocks into `slots.body`, sharing the fence-id state with the rest of the doc (fences counted in reading order). A mermaid fence there keeps its caption. A plain `>` quote holds inline content only, so its blocks stay one text run, unchanged.

Cap: callouts read their body as blocks to 50 deep (MAX_NEST). The 51st callout down keeps everything after its first paragraph as text, joined to its content with single spaces, deeper `[!tone]` markers kept as literal text; every word is kept and there is no notice (`callout-52-deep-past-cap`).

Differs from Barkpark: Barkpark's importer (from_markdown.ex) still joins a callout's later blocks into its `content`. Every case except `plain-quote-stays-inline` and `callout-one-paragraph-two-lines` differs there today.
