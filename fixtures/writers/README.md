# Writers

Docs with each writer's output pinned byte for byte, as `{ blocks, markdown, text, html }`:
`toMarkdown(blocks)` writes `markdown`, `toPlainText(blocks)` writes `text`, and
`renderPortableDocument(blocks)` of `@portable-doc/react` writes `html`. Each case holds
blocks that hold other blocks, where a writer once dropped words: a callout with a first
line and a body, the same in its collapsible form, a callout with a body under a list item,
and a list item with a block that is not a list under it.

The files are kept by hand. A change to a writer's output changes them in the same edit.
