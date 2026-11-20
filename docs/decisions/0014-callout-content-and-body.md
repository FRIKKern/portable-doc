# 0014 A callout's content and its body are two parts, never two copies

Date: 2026-11-20 · Status: accepted

```
> [!warning] Mind the gap          ── content: the callout's own first paragraph
>
> The second paragraph is the body. ┐
>                                   ├─ slots.body: every block after that paragraph
> - one                             │
> - two                             ┘

readers show: content, then every block of the body, in order, each once
```

## Context

The schema gives a callout two fields for its words: `content`, an inline list, and `slots.body`, a list of blocks. Until now, neither the schema nor SPEC.md said how the two relate. A reader could take `content` as a short form of the body's first paragraph. It would then show one field or the other, and a callout that holds both would lose words.

The Markdown import already reads `content` as the first paragraph of a `> [!tone]` quote, and every block after that paragraph as `slots.body` (`fixtures/nesting/README.md`). React and the text writers show `content`, then the body. The shared cases hold callouts with both fields, and in none of them is `content` a copy of the body's first block.

## What this decides

This record decides two questions for the shared format. Each was a choice between two designs, taken on 2026-11-20.

- **Content is not a copy of the body.** The other design kept `content` as a copy of the body's first paragraph. It lost because a copy can drift from what it copies, and because it has no answer for a body that starts with a list, a table or another callout.
- **A body holds any block a document may hold.** The other design let a body hold plain blocks only. It lost because it would refuse documents that are already saved with other blocks in a callout's body.

Barkpark's editor still treats `content` as a copy of the body, and Barkpark's slot check still admits plain blocks only in some bodies. Both are being changed to match this record.

This record does not say that a body's first paragraph stands in for a missing first line. A callout with empty `content` and a body is drawn as its body's blocks, with no special case.

Either choice can still be reversed. Reversing it is cheap until the reader changes land.

## Decision

- SPEC.md states the rule: "A callout's content is its own first paragraph, its slots.body is the blocks after that paragraph, and neither field is a copy of the other. A callout's body holds any block a document may hold." The schema's callout entry is to carry the same two sentences. The one depth limit every document has applies to a callout's body too.
- A callout with empty `content` and a body is allowed: an empty first line is not a missing one.
- Readers show `content`, then every block of the body, in that order, each once.
- `scripts/callout-rule.test.mjs` holds SPEC.md to the sentences, word for word. It also holds the shared cases and the readers here to the rule:
  - in no case is `content` a copy of the body's first block;
  - React and the text writers show each word of a callout once, in that order.
- The schema is Barkpark's, synced (0003), so its callout entry gets the sentences in Barkpark. A check here that the entry carries them follows the sync that brings them. The editor here is Barkpark's copy (0012), so it follows the rule through Barkpark too.

## Considered

- **A depth limit of the body's own.** Rejected. One limit, the validator's `MAX_DEPTH`, holds for every block wherever it sits. The Markdown import reads callout bodies as blocks to 50 deep (`MAX_NEST`), which is a limit of reading Markdown, not of the document.
