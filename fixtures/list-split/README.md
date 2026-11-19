# List item split: shared import cases

Each file is `{ markdown, blocks, notices }`: `readMarkdown(markdown)` in @portable-doc/text gives `blocks` and `notices` as of branch fix/list-item-trailing-text (head 865d25e), built by `dump-list-split-cases.mjs`.

Rule: an item's text always comes before its children. Text after a list item's nested list, while that nested list is kept as a list (the item is less than 50 deep, MAX_NEST), becomes the next item at the same level, in source order. In an ordered list it takes the next number, and the items after it number on. Each new item adds one notice `{ code: 'list_item_split', path, line, lines }`: the new item's path, its text's first source line (from 1) and how many lines it spans. In an item 50 deep or more, the nested list is already the item's text (the flattening rule), so the text after it follows in place, with no notice.

Cases: the bullet case; text, a nested list and text again in one item (`list-item-text-around-nested-list`: `a b` stays the item's text, `d` splits off); the bullet case's numbered twin (`w4`, item 2 in the source, is item 3), and the deep twins: at depth 49 the text splits off with the notice, at depth 50 it stays in place with none.
