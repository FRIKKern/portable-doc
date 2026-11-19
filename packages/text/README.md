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
- **Lossless**, `toMarkdown(doc, { mode: 'lossless' })`, returns `{ markdown, lost }`.
  Every block import accepts comes back the same, and the rest are written
  readably and reported in `lost`.

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
// [{ type: 'heading', level: 2, text: 'Plan' },
//  { type: 'list', ordered: false, task: true, items: [
//    { content: [{ type: 'text', value: 'parse' }], checked: true },
//    { content: [{ type: 'text', value: 'ship' }], checked: false } ] }]
```

The rules are Barkpark's `FromMarkdown`: headings keep their level, inline
marks become `strong`, `em`, `strikethrough`, `code` and `link` nodes, a
bullet list with `[ ]` or `[x]` items is a checklist, an ordered list keeps
its `start`, a fence keeps the first word of its info string as `lang`, `>`
is a quote and `> [!tone]` a callout, `---` a divider. Two fences do more:

- ` ```mermaid ` is a `diagram` block.
- ` ```portabledoc ` holds a JSON array of up to 50 blocks, spliced in when
  every block in it is a heading, paragraph, list, code, table, callout,
  divider, diagram, chart, stat, stats, heatmap, pullquote or eyebrow: at the
  top, and nested wherever the schema puts blocks (a list item's `children`,
  a callout's `slots.body`, …). Otherwise the fence stays a code block.

It never throws. The result always passes `@portable-doc/validate`; if the
parser or the walk ever fails, the whole input comes back as one code block.

Where it differs from Barkpark, on purpose:

- Only URLs the renderer allows become links; any other link or image keeps
  its text, and an image with no alt text leaves none. A portabledoc fence
  must also validate, hold only allowed URLs in every address field (`href`,
  `src`, `poster`, `url`, at any depth), reuse no `id` from an earlier fence,
  and may nest no deeper than `MAX_VALUE_DEPTH` from `@portable-doc/validate`
  (1000 JSON levels, counted in the doc), or it stays a code block.
- A heading, paragraph, list item or quote that import leaves with no text
  (say, an unsafe image, a script or a blank code span) is dropped, never kept
  empty. "No text" is `toMarkdown`'s measure: it would write nothing for it. A
  list whose items all drop goes too; an item with a nested list stays. Table
  cells stay as they are.
- A hard line break is a `"\n"` in the text, a soft one a space. A list
  item's paragraphs are joined by a space, and a nested list stays a list in
  the item's `children`.
- What `toMarkdown` writes reads back: a quote's last paragraph `— Name` is
  its `cite`, and an emphasised paragraph right after a mermaid fence is the
  diagram's `caption`.
- Raw HTML keeps its visible text; tags, comments, scripts and styles go.
- The parser is markdown-it, not Earmark. It runs in linear time on hostile
  input and caps nesting at 100: quotes or lists nested deeper than that are
  left out.

**Round trip.** In readable mode, heading, paragraph, list, code, table,
blockquote, divider and diagram come back from `fromMarkdown(toMarkdown(doc))`
as an equivalent doc: the same blocks once ids are dropped, and inline content
compared as text runs with their marks. Every other type comes back as whatever
its Markdown reads as: an image as a link, a callout or pullquote as a quote, an
equation as a `math` code block.

Lossless mode decides per block by trying it: it writes the block, reads it
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

Lossless mode reads the Markdown back once per block and once for the whole.
On the block goldens that is about 0.3 ms of CPU a block, some 12 to 14 times
readable mode.

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

`node --test packages/text/text.test.mjs packages/text/from-markdown.test.mjs packages/text/round-trip.test.mjs`
checks that every spec type has a handler, that every golden renders to clean
text, and the import rules, round trip and hostile input.
