# 0015 Every reader draws a text leaf's marks the same way, and a mark never hides a word

Date: 2026-11-21 · Status: accepted

This record changes readers and writers only. It adds no validator rule, so no document that validates today stops validating, rendering or saving. The validator rules for marks are a separate proposal, not decided here, and nothing here depends on it.

The bar for this record: nothing a person can make in the editor today gets a notice, or loses its link target or its tag.

```
stored leaf marks:  ["strong", "bold", {"type": "strong", "attrs": {}}, "em",
                     {"type": "link", "href": "/a"}, {"type": "tag", "attrs": {"name": "x"}}]

drawn, every reader:  <a href="/a"> <b><i> <span class="bp-tag" data-tag="x">#x</span> </i></b> </a>
                      one strong, one em: identical marks draw once, first appearance first
                      one anchor: the link is outermost; the tag inside it is its #name, not an anchor
                      the word is drawn: no count of marks ever puts a notice in its place
```

Code is read at portable-doc main 426dce8 and Barkpark main 158562a. "Run" marks a case that was run by hand on that code. No test in either repo holds it yet. Each such case is to be held by the test named for its reader, in the change that builds that reader's part:
- text writers here: `packages/text/marks.test.mjs`;
- React here: `packages/react/tests/marks.test.ts`, and `scripts/limit-goldens-react.test.mjs` for the depth cases;
- Barkpark React: `js/packages/react/tests/link-group.test.tsx`, and `js/packages/react/tests/limits.test.tsx` for the depth cases;
- Go and mobile: `internal/pdrender/link_group_test.go` and `apps/mobile/__tests__/link-group.test.tsx`;
- the editor, mounted and through its save path: `api/assets/paper-editor/src/canvas/__opaque_marks_mounted.test.mjs`.

Every other claim is a code read, cited by file and line.

## Context: what readers draw today

A text leaf carries a flat `marks` list. Neither validator reads it: `definitions.inline` says "Its fields are not specified here" (`spec/blocks.schema.json:4788`, the same in Barkpark's copy). So each reader decides.

| On one leaf, today | Text writers | React (both) | Barkpark server | Go | Mobile |
|---|---|---|---|---|---|
| a style mark repeated, any spelling | once (`packages/text/inline.js:140,145`); run | once a copy, nested: 3 spellings of strong give 3 bold spans (`packages/react/src/inline.tsx:305-327`); run | once a copy (`render/inline.ex:492-524`) | once (`internal/pdrender/inline.go:384-395`) | once a copy (`inlines.tsx:99-133`) |
| two links | the last safe href (`inline.js:62,69-72`); run | both, `<a>` in `<a>` (`inline.tsx:336-340`); run | both, nested (`inline.ex:535-545`) | the first (`inline.go:399-403`) | both, nested `Text onPress` (`inlines.tsx:148`) |
| two of wikilink, blockref, tag, valueref | the first, except after a wikilink without alias, which shows the second's text (`inline.js:74-77`); run, see (d) | the first, except after a wikilink without alias, which wraps the second (`inline.tsx:342-370`); run, see (d) | the first, except after a wikilink, which wraps the second (`inline.ex:547-595`) | not drawn: no case (`inline.go:386-404`) | not drawn (`inlines.tsx:152`) |
| a link and one of tag, blockref, valueref or an aliased wikilink | both: `[#x](https://…)`; run | link first: both, and with a tag `<a>` in `<a>`; the other mark first: the link is lost (no anchor at all for blockref, valueref and an aliased wikilink); run | as React: the tag, blockref and valueref marks drop `acc` (`inline.ex:568-595`) | the link only | the link only |

The same kinds of thing also come as nodes. A link node around a tag node draws `<a>` in `<a>` in both HTML readers, because the tag node ignores that it is inside a link (`inline.ex:293`; `inline.tsx:580-581`; run). A link node around a text leaf with a link mark nests too in React, whose text case ignores `insideLink` (`inline.tsx:536-539`; run). Elixir flattens that one (`inline.ex:539-541`). A link node inside a link node draws one anchor, the outer one, in React (`inline.tsx:561-564`; run), Elixir (`inline.ex:250-259`) and Go (`inline.go:173-180`). Mobile has no inside-link case, so it nests `Text onPress` (`inlines.tsx:241`).

The tag is an anchor in every HTML reader: `<a href="/tags/x">` (`packages/react/src/inline.tsx:380-384`; Barkpark React `inline.tsx:385-389`; `render/walk.ex:1247-1248`). In Elixir a resolved blockref and a resolved wikilink are anchors too (`walk.ex:1129-1132`, `:788-790`).

Every HTML reader, Go and mobile count the raw list toward the inline depth: `depth + marks.length >= 100` (`inline.tsx:537`, and `marks.length >= 100` in `renderCell` at `:721`; Barkpark React `:541` and `:694`; `inline.ex:143-144`; `inline.go:145-146`; mobile `inlines.tsx:200`). Past it, the notice "Nested too deep to show" is drawn in place of the word. Run: 100 copies of strong, and 100 different annotations, each draw the notice in React, in a document that validates. 99 copies draw 99 nested bold spans. The text writers never count marks (`inline.js:56-81`). They draw `**word**` for 100 copies and `word` for 100 annotations.

## Who writes such leaves today

- **The editor.** Run in a mounted canvas and through its save path.
  - A linked #tag: a person selects a tag and adds a link. It is stored as a link node around a tag node. A link over a blockref or a valueref is stored the same way. In the canvas, a link set over a wikilink is not applied.
  - It turns known leaf marks into nodes when it writes a run back (`packages/editor/src/inline-codec.js:319-352`). So a word edit stores 3 spellings of strong as 3 nested strong nodes, 100 copies as 100 nested strong nodes, and two links on a leaf as link node A around link node B.
  - When an opaque mark (one the editor has no UI for, such as an annotation) rides on the run, it writes the leaf's stored list back verbatim, in its stored order (`opaqueLeafMarks`, `inline-codec.js:357-378`). So `[annotation, link a, link b]` and `[annotation, tag, link]` come back unchanged.
  - **An existing bug, with its own fix:** each word edit next to an opaque mark grows what repeats there (`inline-codec.js:369-379`). Run, over three word edits, saved and reopened each time:
    - `[annotation, annotation]`: 3, then 5, then 9 annotations;
    - `[annotation, strong, strong]`: one more strong node each time, 3, 4, 5;
    - `[annotation, link a, link a]`: one more link node each time, 3, 4, 5;

    Nested nodes count toward the node depth, so after about 97 edits the word is cut. It needs a hand-made leaf, so it is not under the bar. Its fix lands first, as its own change; see (a).
  - It writes nothing for a paragraph that was not edited. Run in a mounted canvas: a load and flush with no edit emitted no change in all 10 cases, among them `[annotation, strong, strong]`, two links, `[tag, link]`, 100 × strong and the linked tag.
- **Paste**, run through the canvas's paste path (`view.pasteHTML`), which uses the schema's full clipboard parser (`canvas/canvas-editor-policy.js:64-69`) and the paste hooks (`canvas/canvas-editor-schema.js:655-672`).
  - Repeats collapse. `<b><b>x</b></b>` gives one strong. Two nested links give one link, the inner one. Two nested identical annotations give one.
  - A link around a tag span gives a link node around a tag node, as above.
  - A tag around a blockref keeps only the blockref.
- **The ```portabledoc fence import** splices any marks validate accepts (`packages/text/from-markdown.js:254`; Barkpark `fence.ex:43`). Run: two links, a tag with a link, and 150 annotations are each spliced with no notice.
- **The round-trip writer** writes a leaf its Markdown cannot hold as such a fence (`packages/text/round-trip.js:80-84`), and it reads back with all its marks.
- **BPML.** The parser repeats style marks (`bpml/parser.ex:1022`, `marks ++ [mark]`), and never link-like marks (`:109-120`, `:1049`). The printer prints each run's marks (`bpml/printer.ex:672-710`).
  - An unedited push keeps the stored block (`bpml/diff.ex:60-73`, `keep_unedited`).
  - An edited push stores the parser's spelling (`diff.ex:62-64`).
- **The Sanity Portable Text import** writes nodes, with one link at most (`internal/cli/import_sanity_pt.go:279-317`).
- **Raw API writes** can store any list.
- **Rewrites without an edit:** none found. No path rewrites stored marks without a person's edit. On an edit, stored marks are already rewritten today: BPML's spelling, and the editor's leaf-to-node step.

## What this decides

### (a) An identical mark draws once, in order of first appearance

- This holds in every reader and writer.
- **Each mark has a kind: style, link-like or opaque.**
  - Style: strong, em, underline, strike, code, highlight, sub and sup.
  - Link-like: link, wikilink, blockref, tag and valueref.
  - Opaque: any mark this format does not name, such as an annotation.
- **A style mark draws once by its folded type, whatever data it carries.** So `{"type": "strong", "attrs": {"n": 1}}` and `{"type": "strong", "attrs": {"n": 2}}` draw one bold span. Today React draws one per copy (run: 2 for those two, 99 for 99, and the notice for 100, each in a doc that validates).
  - The fold: `bold` is `strong`, `italic` is `em`, and `s` and `strikethrough` are `strike`. Every reader folds these today: `inline.js:65-67`, `inline-codec.js:22-28`, `inline.ex:498-503` and `:522`, `inline.go:387-390` and `:393`.
- **A link-like or opaque mark is identical to another of the same folded type when its data is the same.** A mark's data is its fields other than `type`. Each field is read from `attrs`, and else from the top level. An empty `attrs` is no data, and key order does not matter. A bare string `"strong"` is `{"type": "strong"}`.
  - Barkpark's server reads a link that way (`inline.ex:536`). It reads wikilink, blockref, tag and valueref from `attrs` only (`inline.ex:547-595`; e.g. `:579`), so `{"type": "tag", "name": "x"}` draws `#` today. That read changes.
- **The editor never drops a mark's data.** Readers draw a style mark once by its folded type. The editor, when it writes a run back, writes one copy only of marks equal in folded type and in data, both as nodes and as an opaque mark's flat list. Two strongs with different data are written back as stored, each with its data. The stored doc then draws as it did.
  - Row: an editor test writes back `[strong, strong]` as one strong, `[{"type": "strong", "attrs": {"n": 1}}, {"type": "strong", "attrs": {"n": 2}}]` as stored, and `[annotation, link a, link a]` with one link a.
  - Order: the growth bug's fix is its own PR and lands first; this write-once rule then builds on it in the same lines (`inline-codec.js:357-379`), in that order, on the Barkpark side, where the editor's code lives.
- **One list for the kinds and the fold, and every copy of it is generated.** It lives in the schema as `definitions.marks`, beside `definitions.inline`. Each mark gets its kind (`"x-kind": "style" | "link-like"`; a mark the list does not name is opaque), and each other spelling gets `x-alias-of`. The schema already carries `x-alias-of` for block aliases (`definitions.aliases`).
  - No block refers to `definitions.marks`, so neither validator checks anything new.
  - It is written in Barkpark and synced (0003).
  - Only the table is generated: each mark's name, its aliases and its kind. The draw code stays hand-written and switches on the name. Each copy is written by a script the gate runs, the way the pack's goldens are made, and a hand edit goes red. By reader:
    - Barkpark server: reads the marks at compile time from the spec module the schema's `definitions.marks` is written from. That module has no dependencies, so the read forms no compile cycle.
    - Barkpark React, mobile and Go: `design/emit.mjs` writes a `.gen` file for each from the schema Barkpark writes, as it writes `status-vocab.gen.ts` for React and mobile and `tokens_gen.go` for Go. `design/check.mjs` reds a hand edit.
    - The editor: `design/emit.mjs` writes its alias-to-name table the same way, and its alias fold (`inline-codec.js:22-28`) reads it. The step from a name to the editor's own mark stays hand-written, and wikilink, blockref, tag and valueref stay unknown to it, so the editor stores nothing new. The editor's sync carries it into `packages/editor` here.
    - Text writers and React here: a script writes a small module from `spec/blocks.schema.json`, as `scripts/generate-alias-types.mjs` writes `packages/text/alias-types.js`, and a test regenerates it and compares, as `read-aliases.test.mjs` does. React gets its own copy, so it does not bundle the schema.
  - Each reader gets an exhaustiveness row, so a mark the table names and the draw code does not handle is red: React (both) and mobile by `satisfies Record<MarkName, …>`, Go and the editor by a test over the generated list. The switch sites today: React here `inline.tsx:302-370`; Barkpark React `inline.tsx:315-368`; mobile `inlines.tsx:102-148` and `:203-243`; Go `inline.go:150-208` and `:387-393`; the editor `inline-codec.js:22-28`.
  - The pack's edges still check what each reader draws. The generation keeps the names, aliases and kinds the same in every reader.

### (b) A leaf's marks never put a notice in place of its word

- Readers drop `marks.length` from the depth check at every site listed in Context.
- This is safe because a leaf then draws a fixed number of wrappers, whatever its list holds: one per style type the reader draws, plus at most one link and at most one other link-like mark. A mark a reader does not draw adds none. The number comes from the list, not from this record.
- Each reader gets a row that counts that number from the list and from the mark types it draws, and checks it against a leaf built to draw every one. A reader stops counting marks toward the depth notice only once its row is in place.
- A notice for a leaf's marks comes only where a validator refuses the leaf. No validator does today, so this record adds none. When one does, the word is drawn first, and the notice follows it. That is in the separate proposal.

### (c) A link and one other link-like mark: one anchor, nothing lost

This covers every form the editor makes:
- a link node around a tag, blockref or valueref node;
- a link node around a leaf with a tag mark: setLink over a tag-marked leaf;
- a link node around a strong node around a tag: bold over a linked tag;
- a link node around a link node: a word edit on a leaf with two links.

It also covers the leaf forms a fence or an opaque write-back carries: `[link, tag]` or `[tag, link]` on one leaf, and a link mark on a leaf inside a link node.

- **The link is outermost, whatever the order.** It is the leaf's or node's one anchor.
- **Inside a link, a link-like mark draws its own text, not its own anchor:**
  - a tag draws `<span class="bp-tag" data-tag="x">#x</span>`;
  - a resolved blockref draws its span (`walk.ex:1150-1156`) in place of its link (`:1142-1148`);
  - a resolved wikilink draws `<span data-wikilink="…" class="bp-wikilink">`, the resolved anchor's attributes and class on a span (`walk.ex:814-820`), not the unresolved span (`:822-828`);
  - in the email palette, the same holds for its inline forms: the tag (`walk.ex:1252`) and the blockref link (`:1146`) draw as spans inside a link;
  - in React, inside a link, the default wikilink span is drawn and a host `wikilink` renderer (`PortableDoc.tsx:68`) is not called, since it may return an anchor.
- **Inside a link, a second link draws as plain text, in every reader.** That covers a link node, and a link mark on a leaf in a link node.

| | Text writers | React (both) | Barkpark server | Go | Mobile |
|---|---|---|---|---|---|
| link around a tag, either form, either order | `[#x](https://…)`, as today | the tag as its span inside `<a>`. Changes: the tag node (`inline.tsx:580-581`); the leaf fold puts the link outermost and draws the tag mark as its span (`:302-370`, tag at `:358-361`); the text case passes `insideLink` into `applyMarks` (`:536-539`) | the same. Changes: the tag node takes `inside_link` (`inline.ex:293`); the leaf fold puts the link outermost (`:492-496`); the tag, blockref and wikilink marks learn they are inside a link (`:547-580`); `walk.ex:1158` draws the span inside a link | the link around `#x`, as today for the node form (`inline.go:204-206`). In a colour terminal this holds once a link or em around styled words draws clean escape codes; that fix lands first or with this change | the link around `#x`, as today for the node form (`inlines.tsx:262-267`) |
| link around a resolved blockref or wikilink | as today | as today (spans); the host wikilink renderer is not called inside a link | the span forms inside a link: the blockref and wikilink nodes (`inline.ex:265-291`) and marks (`:547-576`) carry `inside_link`, and `walk.ex` draws the spans above | as today | as today |
| link inside a link | inside a link node, the outer link already wins (run: the word as a Markdown link to the outer link's target); only two link marks on one leaf change, from the last to the first (`inline.js:62,69-72`) | the outer link: changes the text case (`inline.tsx:536-539`) and the leaf fold (`:336-340`) | the outer link: changes the leaf fold (`inline.ex:535-545`) | as today | the inner link drawn as plain text: changes `inlines.tsx:148`, `:241` |

Why this form:
- A person makes a linked #tag in the editor today, and it draws `<a>` in `<a>` in both HTML readers. The HTML parse rule closes the outer anchor, so the link's target is lost on that word. That has not been run in a browser here.
- With the tag as its `#name` inside the link, the word keeps its link target and still shows, and is styled as, a tag. Only the tag's own page link is not drawn inside another link. That is the one thing two anchors cannot both have.
- Go, mobile and the text writers already draw a linked tag this way, so the HTML readers come to them. Go's colour output still needs the escape-code fix above.

### (d) What only a hand-made fence can hold: the first wins, in every reader

Two links, or two of wikilink, blockref, tag and valueref, on one leaf. No editor path makes them; a fence or an opaque write-back carries them.

Today, by reader. The text writers and React here were run in all 19 ordered pairs, and Barkpark React, Go and mobile for two links, two tags, and a tag then a blockref. The Barkpark server is read, not run. "(code)" marks a code read.

| First, then second | Text writers | React (both) | Barkpark server | Go | Mobile |
|---|---|---|---|---|---|
| link A, link B | B, the last (run) | both, `<a>` in `<a>` (run) | both, nested (`inline.ex:535-545`) | A, the first (run) | both, nested (run) |
| wikilink with alias, any of the other three | the alias only (run) | the alias only (run) | the alias only: the walk shows the alias and drops the children (`walk.ex:833-836`) | neither (code) | neither (code) |
| wikilink without alias, blockref, tag or valueref | the second's text only: `^an`, `#x`, `fb` (run) | both: the wikilink span around the second (run) | both: the wikilink wraps what is inside it (`inline.ex:547-552`) | neither (code) | neither (code) |
| blockref, tag or valueref, any of the four | the first only (run) | the first only (run) | the first only: each drops `acc` (`inline.ex:568-595`) | neither (run for two tags and a tag then a blockref) | neither (run for the same) |

The rule: of the links, the first applies; of wikilink, blockref, tag and valueref, the first applies; the rest are dropped. The one link and the one other then draw as (c). There is no notice. Whether such a leaf earns one waits for the separate proposal.

The changes that make it true:
- Text writers: keep the first link, not the last (`inline.js:62,69-72`). A wikilink without alias that comes first keeps the leaf's text and drops the later marks of the four (`inline.js:74`).
- React (both): draw only the first link (`inline.tsx:336-340`). A wikilink that comes first drops the later marks of the four (`:342-349`).
- Barkpark server: draw only the first link (`inline.ex:535-545`). A wikilink mark that comes first drops the later marks of the four (`:547-552`).
- Go: draw the first of the four as its node draws (`inline.go:386-404`; nodes at `:182-214`). It already keeps the first link (run).
- Mobile: draw only the first link (`inlines.tsx:148`), and draw the first of the four as its node draws (`:152`; nodes at `:243-272`).

## What changes in the goldens and tests

| Golden, edge or test | Today | Becomes |
|---|---|---|
| `marks-one-level-above-the-depth-limit` (99 × strong) | 99 nested bold spans | one bold span around "leaf" |
| `table-cell-marks-one-level-above-the-depth-limit` (99 × strong) | 99 nested bold spans | one bold span in the cell |
| `marks-at-the-depth-limit` (100 × strong) | the notice in place of "leaf" | one bold span around "leaf" |
| `table-cell-marks-at-the-depth-limit` (100 × strong) | the notice in the cell | one bold span in the cell |
| pack `docs` "many marks" (40,000 × strong; `goldens/limit-docs.json:284`) | under its time bound | one bold span, under its time bound |
| new edges | | 100 strong marks with distinct attrs: one bold span. 100 distinct annotations: "leaf", no notice. 40,000 distinct annotations: a pack worst case. A link around a tag, in each form and order: one anchor around the tag's span. A link around a strong around a tag: one anchor. A link in a link: one anchor. `[wikilink without alias, tag]`: the wikilink only. `{"type": "strong", "attrs": {}}` beside `"strong"`: one bold span. A tag with its name at the top level: `#x` |

- The edge names "at the depth limit" stop fitting the marks edges, so they get new names. In the pack's naming, "one level above" means one short of the limit, on the safe side. The rename also touches the editor's source-wall fixture list, here at `packages/editor/src/__source_wall_fixtures.test.mjs:35-36` and in Barkpark at `api/assets/paper-editor/src/__source_wall_fixtures.test.mjs:35-36`.
- The goldens and the pack are Barkpark's (`api/test/support/fixtures/portable-doc-limits.json`, made into `goldens/limits/` by `gen_pd_parity`). They change there and sync here.
- The new edges need an indexed `$repeat`, such as `{"$repeat": n, "of": {"type": "annotation", "attrs": {"id": "$i"}}}`, in all three expanders in one change: `gen_pd_parity.limits.ex:85`, `conformance.mjs:44-46` (synced here at the same lines) and `internal/pdrender/limits_test.go:97`.
- Barkpark's tests:
  - `render_field_limits_test.exs:421` "a text's marks count toward the same depth", `js/packages/react/tests/limits.test.tsx:104` and `apps/mobile/__tests__/limits.test.tsx:208` become "a text's marks never hide its word";
  - React gets a `renderCell` row;
  - Go's `limits_test.go:184` and `:204` read the pack and follow its edges.
- Here, `scripts/limit-goldens-react.test.mjs` holds React to the goldens once they sync.
- Landing:
  - The edge rename regenerates goldens and conformance stamps, so in Barkpark it lands alone, after the open changes that regenerate the pack.
  - The React package needs a changeset line.
  - Mobile ships with an app release.

## Not in this record

- **Nested inline nodes still cut the word.** Validate accepts 101 nested em (run). Every HTML reader draws the notice in place of the word from 100 nested inline nodes. The text writers do it from 50, because they count each level twice, the list and the node (`inline.js:87-91`; run: 49 em draw the word, 50 draw the notice). The 50 em + 50 marks case gives the notice in the text writers for that reason, not for the marks. Whether a word cut by node depth stays drawn is its own question. It is covered by the existing work on the words of valid documents, which owns the text writers' count. Its two run cases are to be held by `packages/validate/validate.test.mjs` and `packages/text/writers-keep-words.test.mjs` in that work.
- **The validator rules:** a one-group rule, a cap on distinct marks, and their notices. They are a separate proposal, not decided here.
- **The editor's growth bug** (`inline-codec.js:369-379`): its own fix, which lands before (a)'s editor rule.

## Considered

- **Keep each copy (today's React and Barkpark server).** Rejected. 99 copies of strong draw 99 nested spans where the text writers draw one, so readers disagree on a valid doc. And 100 copies hide the word behind a notice in a doc validate accepts.
- **The last link wins (today's text writers).** Rejected for one rule: first appearance. Go already keeps the first.
- **A linked tag drawn as two anchors, or as the tag's anchor alone.** Rejected. Two anchors nest, and the HTML parse rule loses the outer target. The tag's anchor alone loses the link a person set.
- **Refuse a link and a tag on one leaf.** Not here. The editor makes the node form today, so a validity rule cannot be the answer for that form. For the leaf form it is in the separate proposal.

## Reversible

Every change here is in readers and writers, and no stored document changes, apart from the editor writing one copy of marks equal in folded type and in data on an edit, which drops no data. Each reader change can be undone with its goldens.
