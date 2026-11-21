# @portable-doc/text

A PortableDoc document as Markdown or as plain text: for LLM prompts, the
plain-text part of an email, search indexes, readable diffs and terminals.
And back: GFM Markdown as PortableDoc blocks. Every block type in
[`spec/blocks.schema.json`](../../spec/blocks.schema.json) has a handler,
aliases included. Plain JavaScript. `toMarkdown` and `toPlainText` use
nothing else; `fromMarkdown` uses [markdown-it](https://github.com/markdown-it/markdown-it)
15.0.3 (MIT, pinned) and [`@portable-doc/validate`](../validate/CODES.md).

Not yet on npm. Inside this repo it is the `@portable-doc/text` workspace.

```js
import { toMarkdown, toPlainText } from '@portable-doc/text';

const doc = { blocks: [
  { type: 'heading', level: 2, text: 'Release notes' },
  { type: 'paragraph', content: [
    { type: 'text', value: 'Read ' },
    { type: 'text', value: 'the docs', marks: [{ type: 'link', href: 'https://example.com' }] },
  ] },
] };

toMarkdown(doc);  // '## Release notes\n\nRead [the docs](https://example.com)\n'
toPlainText(doc); // 'Release notes\n\nRead the docs (https://example.com)\n'
```

Both take the blocks array itself or `{ blocks: [...] }`. The option
`embeds` maps an `embed` block's `target` to the document shown in its place.
An embed inside its own document, or past the first 100 in one render, shows
its target instead.

`toMarkdown` has two modes:

- **Readable**, the default, writes Markdown for people and reads one way.
- **Round trip**, `toMarkdown(doc, { mode: 'round-trip' })`, returns
  `{ markdown, lost }`. Every block import accepts comes back the same, and the
  rest are written readably and reported in `lost`. The types it keeps are
  listed under [Round trip](#round-trip).

## The rules

- **Output.** Blocks are separated by one blank line. The result ends with
  exactly one newline, or is `''` when nothing shows. Same input, same output.
- **Markdown** is CommonMark with GFM tables, task lists (`- [x]`) and
  strikethrough. Headings keep their level (1 to 6), code is fenced with the
  first word of its language (an empty code block is an empty fence), quotes
  and callouts are `>` blocks, math is its TeX in a ` ```math ` fence or a
  `` $`…`$ `` span, images are Markdown images with their alt text, dividers
  `---`.
- **Plain text** has no markup. Links read "text (url)", once; a link whose
  text is its URL, or that points inside the page (`#…`), shows the text only.
  Lists use `- ` and `1. `, tables are space-aligned columns under a dashed
  rule, quotes sit in “…” with "— cite" below, a divider is `§`.
- **Escaping.** In Markdown, prose is escaped so it cannot turn into markup:
  backslash, backtick, `*`, `[`, `]`, `~` and `_` (outside a word) anywhere,
  `<` before a tag, `&` before an entity, and `#`, `>`, `-`, `+`, `1.`, `===`
  or a table delimiter row at the start of a line. A table cell's `|` is
  escaped, and so are `&` and backslash in a link URL. Plain text is never
  escaped.
- **Old names.** A field may still be stored under an old name: a heading's
  `text` for `content`, a code block's `code`, `content` or `text` for `value`,
  a table's `header` for `head`, and the other rows of the one alias table in
  `alias-table.js` (the pack's `spec/read-aliases.json`, until it is synced
  here). Every renderer reads such a field through that table, by one rule,
  written here from `alias-table.js` by `scripts/write-readme.mjs`:
  <!-- alias-rule:start -->
  For each field, read the names in order: the current name first, then the old names in table order. Skip a name that is missing, null, or holds the wrong type. Where the row's column 'a whitespace-only value under the current name wins' says yes, take the first remaining name whose value holds any character, whitespace included. Where it says no, take the first remaining name whose value holds a non-whitespace character, else the first that holds any character. If none does, take the first remaining name as stored. If no name remains, the field is empty. A string holds the characters it has; a non-empty array, a number or a non-empty object holds a non-whitespace character.
  <!-- alias-rule:end -->
  A name's type is the one the schema gives it; a field the schema types as
  text reads a string or a finite number. The column is yes for a text leaf,
  an inline code node, a code tab, a table column's label and a task
  criterion. A table's `cols` gives only each column's type, beside or in
  place of `columns`.
- **Links.** Only the schemes the renderer allows become links: `http`,
  `https`, `mailto`, `tel`, a root-relative `/path` (not `//host`), and `#`,
  `?`, `./`, `../`. Any other link (`javascript:`, `data:`, …) shows its text only.
- **Rich blocks say what they hold.** A chart is its title and a table of its
  series; a heatmap, sheet or duel a table; stats, gauges and bars a list of
  label and number; a task board its columns with their tasks; a form its
  numbered questions with `( )` or `[ ]` choices; a chat tool diff a `diff`
  block; fields read "Label: value". An empty data block shows the same "no
  data" line the renderer does.
- **Unknown block types** never throw. A block of an unknown type shows its
  `content` (inline) or `text` field as a paragraph when it has one, and
  nothing otherwise. Blocks nested deeper than 100 levels show "Nested too
  deep to show".

## From Markdown

```js
import { fromMarkdown } from '@portable-doc/text';

fromMarkdown('## Plan\n\n- [x] parse\n- [ ] ship');
// [{ type: 'heading', level: 2, content: [{ type: 'text', value: 'Plan' }] },
//  { type: 'list', ordered: false, task: true, items: [
//    { content: [{ type: 'text', value: 'parse' }], checked: true },
//    { content: [{ type: 'text', value: 'ship' }], checked: false } ] }]
```

The rules are Barkpark's `FromMarkdown`: headings keep their level, inline
marks become `strong`, `em`, `strikethrough`, `code` and `link` nodes, in a
heading's `content` as in a paragraph's, a
bullet list with `[ ]` or `[x]` items is a checklist, an ordered list keeps
its `start`, a fence keeps the first word of its info string as `lang`, `>`
is a quote and `> [!tone]` a callout, `---` a divider. A callout's first
paragraph is its `content`, and every block after it in the quote is read
into its `slots.body`. Two fences do more:

- ` ```mermaid ` is a `diagram` block.
- ` ```portabledoc ` holds a JSON array of up to 50 blocks, spliced in when
  every block in it is of a fence type (`FENCE_TYPES`, listed under
  [Round trip](#round-trip)) and its blocks fit where they would sit (under
  `MAX_DEPTH` blocks and `MAX_VALUE_DEPTH` JSON levels, counted in the doc):
  at the top, in a callout's `slots.body`, and in a list item's `children`,
  as a nested list is (text after it starts a new item). Otherwise the fence
  stays code: a code block at block level, inline code in a list item. A quote
  holds no blocks, so a fence in one is inline code; a fence in text the
  import reads flat (a quote in a list item, a list in a quote, lists past
  `MAX_DEPTH`) is part of that text. Each fence kept so adds one notice
  (`FENCE_KEPT_AS_CODE`, under `readMarkdown`). A spliced block's old names
  (the alias table, as in `spec/read-aliases.json`) come in under their
  current names, picked and
  converted by the rule every reader uses, so the current name wins when it
  holds a value. Only what the readers read is folded: the blocks, the places
  the schema puts blocks and inline nodes in them, a table's cells where its
  reader takes them, and the item paths the alias table names; data under any
  other key (`meta` and the like) stays as written.
  A table's `cols` and `header: true` stay as they are too. Each value that
  loses adds an `old_name_dropped` notice (`OLD_NAME_DROPPED`) with its fix,
  `write <current>`; a value that holds no text (a blank string, an empty
  array) adds none.

It never throws. The result always passes `@portable-doc/validate`; if the
parser or the walk ever fails, the whole input comes back as one code block.

Where it differs from Barkpark, on purpose:

- Only URLs the renderer allows become links; any other link or image keeps
  its text, and an image with no alt text leaves none. An image's alt is its
  label's words only and never shows its Markdown source: a label with no
  words gives no alt. An address the import refuses is shown nowhere, as a
  link or as text. A portabledoc fence
  must also validate, hold only allowed URLs in every address field (`href`,
  `src`, `poster`, `url`, at any depth), reuse no `id` from an earlier fence,
  and fit where its blocks would sit, within `MAX_DEPTH` and `MAX_VALUE_DEPTH`
  from `@portable-doc/validate` (100 blocks, 1000 JSON levels, counted in the
  doc), or it stays code.
- A heading, paragraph, list item or quote that import leaves with no text
  (say, an unsafe image, a script or a blank code span) is dropped, never kept
  empty. "No text" is `toMarkdown`'s measure: it would write nothing for it. A
  list whose items all drop goes too; an item with a nested list stays, and so
  does an item or quote that holds a fence kept with a notice (an empty one
  too), so the notice names a block that is there. Table cells stay as they are.
- A hard line break is a `"\n"` in the text, a soft one a space. A list
  item's paragraphs are joined by a space, and a nested list stays a list in
  the item's `children`.
- An item's text always comes before its children, so text after an item's
  nested list starts a new item at the same level, keeping the words in source
  order; more text after a later nested list splits again. In an ordered list
  the new item takes the next number, and the numbers after it continue from
  there. Each split adds a `list_item_split` notice (`LIST_ITEM_SPLIT`). The
  notices come by kind: any `budget` or `line` notice, then the splits, a
  fence's dropped old names and nesting kept as text in source order, then a
  `net` one.
- Should reading the text fail, `readMarkdown` keeps the whole text as one code
  block and says so with one `import_fell_back` notice (`IMPORT_FELL_BACK`),
  its `lines` the text's line count. That is a bug to report.
- A callout's blocks after its first paragraph are its `slots.body`, read as
  blocks: lists, code, fences, callouts in callouts, as deep as validate's
  `MAX_DEPTH` (100) allows; the deepest callout keeps its body as text, as a
  list that deep does. Barkpark's importer joins them into the callout's text. A plain `>` quote holds inline content only, so
  its blocks stay one run of text in both.
- What `toMarkdown` writes reads back: a quote's last paragraph `— Name` is
  its `cite`, and an emphasised paragraph right after a mermaid fence is the
  diagram's `caption`.
- Raw HTML keeps its visible text; tags, comments, scripts and styles go. An
  inline `<script>` or `<style>` opened in a link's label or in a mark
  (emphasis, strong, strikethrough) and not closed there ends with it; a link
  or mark inside a script or style goes with it, whole. Text kept as text
  reads them the same way.
- The parser is markdown-it, not Earmark. No visible word is ever left out,
  however deep it is nested. Blocks nest as deep as validate's `MAX_DEPTH`
  (100): one Markdown level is one format level, a list, a list in a list
  item and a callout's body each one, counted together. A list nested deeper
  is kept as the text of the deepest item, its items and their blocks one
  space apart, as Barkpark does. Marks inside marks keep their shape as deep
  as validate's `MAX_VALUE_DEPTH` (1000 value levels, two a mark) allows them
  where they sit; deeper ones are their plain text. Barkpark's importer still
  nests blocks to 50. A plain quote keeps all its text, as one run, at
  any depth.
- A block that keeps deeper levels as text, by either limit, adds one notice
  `{ code: 'nesting_kept_as_text', path, line, lines }` (`NESTING_KEPT_AS_TEXT`):
  the block's path and its source lines.
- The import counts its work from the text, before it parses, so every
  importer of the same text cuts it at the same line. Lines are those
  markdown-it reads: `\n`, `\r\n` and a lone `\r` each end a line, and a NUL
  counts as U+FFFD (its core rule `normalize`). Each line costs
  (depth + 1) × (2 + its UTF-8 bytes). Its depth is its quote and list markers
  plus one per 2 columns of indentation among them, a tab running to the next
  stop of 4; a blank line keeps the depth before it, and a line right after a
  non-blank line keeps at least that line's depth, as it may be lazy. The
  tests check the count is never below what markdown-it does to read the same
  lines: hostile shapes, seeded sweeps, and a seeded neighbour search
  (`import-work-search.test.mjs`). The budget is 16,000,000 (`IMPORT_WORK`);
  an ordinary 500 kB document uses at most a third of it
  (`ordinary-work.test.mjs`, nine shapes).
- Two rules keep text as plain text, every word, with Markdown syntax and tags
  in it shown as literal text, and `readMarkdown` says so with
  `{ code: 'import_work_spent', rule, path, line, lines }`: the path of the
  plain paragraph its first line went to, that line (from 1), and how many
  lines from it were kept as text. The budget gives one such notice; the line
  rule one per run of cut lines, a run being cut lines with consecutive
  numbers (any line not cut ends it), for the first `MAX_LINE_NOTICES` runs.
  Past those, one notice
  `{ code: 'import_line_notices_capped', rule: 'line', path, line, lines, runs }`
  (`LINE_NOTICES_CAPPED`) stands for every later run: the paragraph of the
  first line it covers, that line, and how many runs and lines. So the line
  notices are at most `MAX_LINE_NOTICES` + 1, and their `lines` add up to
  every cut line. They come in source order:
  - From the line where the work passes the budget, the rest of the text is
    one top-level paragraph, whitespace collapsed. Containers open at that
    line close there.
  - A line longer than `IMPORT_WORK.lineBytes` (set from the shared pack) is
    one top-level paragraph, as typed. The text before it and the text after
    it are each read as a document, so a quote, list or table open at that
    line ends there; the line makes no setext heading and defines no link
    reference. It is charged its bytes once. Inside an open code fence, the
    code after it starts with the fence's opening line again, so it stays
    code; in a list item that opening line makes a new item.
- Behind the text's count, markdown-it's own count runs as a net. It counts
  each container as markdown-it enters it; should that pass the budget where
  the text's count said it would not, that container and the rest, at any
  level, the top one included, are kept as plain text, every word, with one
  notice of rule `net`. The shared cases never fire it; one
  in the wild means the text's count is wrong, and is a bug to report.
- Each list item split off at text after its nested list adds a notice
  `{ code: 'list_item_split', path, line, lines }`: the new item's path, its
  text's first source line (from 1) and how many lines it spans. Each value a
  fence's block loses as its old names fold adds
  `{ code: 'old_name_dropped', path, line, lines, name, current, fix }`: the
  dropped key's path, the fence's lines, the name dropped, the current name and
  `write <current>`. A ```` ```portabledoc ```` fence the import does not
  splice adds `{ code, path, line, lines, fix }` (`FENCE_KEPT_AS_CODE`): the
  path of the block that keeps it (the code block at block level; the list
  item or quote where it is inline code; the block whose text holds it), the
  fence's lines and the fix. Its code names the reason: `fence_not_json`,
  `fence_block_count` (not 1 to 50 blocks), `fence_too_deep` (as written, or
  where its blocks would sit), `fence_block_type`, `fence_unsafe_address`,
  `fence_invalid` (validate refuses it), `fence_id_used` (an earlier fence uses
  a block id) or `fence_place` (in a quote, or in text read flat, which hold no
  blocks). These come in source order, after any `budget` or `line` notice and
  before a `net` one. No portabledoc fence is kept as code or text without a
  notice: one of these, or, where the import keeps text whole past its limits
  or on a fall-back, the `import_work_spent` or `import_fell_back` notice that
  says why.
  Every notice's path names a value in the blocks, but `old_name_dropped`'s:
  the key it names was dropped, so it is not there, and the value that held it
  is.

## Round trip

In readable mode, heading, paragraph, list, code, table,
blockquote, divider and diagram come back from `fromMarkdown(toMarkdown(doc))`
as an equivalent doc: the same blocks once ids are dropped, and inline content
compared as text runs with their marks. Every other type comes back as whatever
its Markdown reads as: an image as a link, a callout or pullquote as a quote, an
equation as a `math` code block.

Round-trip mode decides per block by trying it: it writes the block, reads it
back and compares, never by a list of types.

- A block is written in its own Markdown when that reads back as exactly the
  block, ids and all.
- Otherwise it goes in a portabledoc fence, when import splices that fence
  (`checkFence`, the importer's own rule).
- Otherwise it is written readably and listed in `lost` as
  `{ path, id, type, reason }`.
- A block whose neighbour changes how it reads, such as an emphasised
  paragraph right after a diagram, is fenced.
- A fence reusing an earlier fence's id is lost, as import would keep it back.
- A callout is written as a `> [!tone]` quote with each block of its body
  inside, decided the same way, so one that cannot be kept is listed under its
  own path (`/blocks/0/slots/body/1`); a callout that line cannot hold (a
  title, a tone import does not know) is fenced whole.
- A list is written as indented items with their blocks inside exactly when
  that reads back as the list. An item's blocks are written in their own
  Markdown, and of those import keeps only nested lists as an item's blocks,
  so a list whose item holds any other block is fenced whole, or listed
  in `lost` as a whole when a fence cannot hold it (an image, an unsafe link).

<!-- round-trip-types:start -->
<!-- Built from the fence types and the forms that read back in their own Markdown by `node packages/text/scripts/write-readme.mjs`; `npm run check` fails when this part is stale. -->
The round trip is lossless only for blocks of these types, and only where import accepts the block:

- in their own Markdown or a portabledoc fence: `callout`, `chart`, `code`, `diagram`, `divider`, `eyebrow`, `heading`, `heatmap`, `list`, `paragraph`, `pullquote`, `stat`, `stats`, `table`;
- in their own Markdown only, for the forms that read back as themselves: `blockquote`.
<!-- round-trip-types:end -->

Round-trip mode reads the Markdown back once per block and once for the whole.
On the block goldens, round-trip costs tenths of a millisecond of CPU a block
once warm, and about a millisecond on a cold first call; readable mode costs
microseconds a block, so round-trip costs tens of times as much.
`node packages/text/bench-round-trip.mjs` measures it on your machine.

The round-trip test checks this on every block type the schema names, with
forms read from the schema and the goldens, not a hand list:

- each golden, with canonical key names and as the pack writes it;
- each value of a boolean or enum and of a small range (every heading level),
  and a sample for the other keys;
- the type empty, and with each array key empty;
- every string as whitespace.

Each form is tried bare, as a list item's child and inside a callout. A form of
a type a fence may not hold must be reported lost, unless its own Markdown
reads back as it, so a type is kept only once import accepts it.

`node --test packages/text/text.test.mjs packages/text/from-markdown.test.mjs packages/text/round-trip.test.mjs packages/text/round-trip-nesting.test.mjs packages/text/round-trip-list-items.test.mjs packages/text/import-work.test.mjs packages/text/import-work-search.test.mjs packages/text/ordinary-work.test.mjs`
checks that every spec type has a handler, that every golden renders to clean
text, and the import rules, round trip and hostile input. The import-work
test sweeps 300 seeded documents; `IMPORT_WORK_SWEEP=20000` runs a longer
sweep (about two minutes).
