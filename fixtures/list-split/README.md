# List split

Each case file is `{ markdown, blocks, notices }`: `readMarkdown(markdown)` gives
`blocks` and `notices`. The inputs are in `cases.mjs`.

An item's text always comes before its children. Text after a list item's
nested list, while that nested list is kept as a list (the item is less than 50
deep, `MAX_NEST`), becomes the next item at the same level, in source order. In
an ordered list it takes the next number, and the items after it number on.
Each new item adds one notice `{ code: 'list_item_split', path, line, lines }`:
the new item's path, its text's first source line (from 1) and how many lines
it spans. In an item 50 deep or more, the nested list is already the item's
text, so the text after it stays in place, with no notice.

The two deep cases are over 64 kB, so they are not kept; the script writes them
on request.
