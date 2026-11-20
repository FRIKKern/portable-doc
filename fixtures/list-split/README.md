# List split

Each case file is `{ markdown, blocks, notices }`: `readMarkdown(markdown)` gives
`blocks` and `notices`. The inputs are in `cases.mjs`.

An item's text always comes before its children. Text after a list item's
nested list, while that nested list is kept as a list (the item's list is less than
99 deep, so the nested one is within validate's `MAX_DEPTH` of 100), becomes the next item at the same level, in source order. In
an ordered list it takes the next number, and the items after it number on.
Each new item adds one notice `{ code: 'list_item_split', path, line, lines }`:
the new item's path, its text's first source line (from 1) and how many lines
it spans. In an item 99 deep, the nested list is already the item's text,
so the text after it stays in place, with no split notice; the list that holds
it gives one `nesting_kept_as_text` notice instead.

The two deep cases are over 64 kB, so they are not kept; the script writes them
on request.
