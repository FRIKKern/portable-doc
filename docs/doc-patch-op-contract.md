# DocPatchOp — shared inter-repo contract

**Status:** frozen wire shape, v1.
**Owners:** portable-doc (TypeScript reference), Barkpark (Elixir), Scaffy (Go).
**Scope:** the JSON wire shape of a single block-patch operation against a
[PortableDoc](#portabledoc-recap), and the conformance rule that binds all
three runtimes to identical behaviour.

This document is the **lingua franca**. It is language-neutral: it describes
JSON on the wire, not any one runtime's in-memory types. Each runtime maps
this shape onto its own structs/typespecs/interfaces, but the bytes crossing a
process boundary — and the result of applying them — are defined here and
nowhere else.

---

## 1. What a DocPatchOp is

A `DocPatchOp` is a single, atomic mutation of a PortableDoc's block tree.
There are exactly **five** ops. A patch (the thing typically sent over the
wire) is an ordered list of these ops, applied left-to-right; this contract
defines one op and the meaning of applying it.

```
applyDocPatch(before: PortableDoc, op: DocPatchOp) -> PortableDoc | DocPatchError
```

`applyDocPatch` is **pure**: it never mutates `before`, and it returns either a
new `after` PortableDoc or a [structured error](#5-errors-never-silent). It
never partially applies and never silently no-ops.

### The five ops

| `op`            | Required fields              | Effect                                                              |
| --------------- | ---------------------------- | ------------------------------------------------------------------- |
| `append-block`  | `block`                      | Append `block` to the end of the document's top-level `blocks`.     |
| `insert-after`  | `afterId`, `block`           | Insert `block` immediately after the block whose `id == afterId`.   |
| `patch-block`   | `id`, `patch`                | Shallow-merge `patch` into the block `id`; **type must not change**. |
| `replace-block` | `id`, `block`                | Replace the block `id` wholesale with `block`.                      |
| `remove-block`  | `id`                         | Remove the block `id` from its parent's `blocks`.                   |

---

## 2. Wire shapes

Each op is a JSON object whose `op` field is the discriminator. A `<Block>` is
a [PortableDoc block](#portabledoc-recap): `{ "type": ..., "id": ..., ... }`.

### append-block

```json
{ "op": "append-block", "block": <Block> }
```

Appends to the **top-level** `blocks` array. (To append inside a section, use
`patch-block` / `replace-block` on that section, or `insert-after` an existing
child of the section.)

### insert-after

```json
{ "op": "insert-after", "afterId": "<id>", "block": <Block> }
```

Inserts `block` directly after the block identified by `afterId`, in that
block's parent array. If `afterId` lives inside a `section`, the new block
lands inside that same section, right after its anchor.

### patch-block

```json
{ "op": "patch-block", "id": "<id>", "patch": <partial Block, keeps type> }
```

Shallow-merges the keys of `patch` over the existing block. `patch` is a
**partial** block: it may omit any field. It **must not change `type`** — if
`patch.type` is present and differs from the target's `type`, the op fails with
[`type-mismatch`](#5-errors-never-silent). `patch` may omit `type` entirely;
omitting it is the common case. The block's `id` is likewise immutable through
`patch-block` — to re-key a block, use `replace-block`.

Merge semantics are **shallow / replace-by-key**: a key present in `patch`
overwrites the whole value at that key in the target (arrays are replaced
wholesale, not concatenated; nested objects are replaced, not deep-merged).
Keys absent from `patch` are preserved untouched. This is the one rule the
three runtimes must agree on byte-for-byte; the golden fixtures pin it.

### replace-block

```json
{ "op": "replace-block", "id": "<id>", "block": <Block> }
```

Replaces the target block entirely. Unlike `patch-block`, `replace-block`
**may** change `type` and **may** change `id` (the new `block.id` need not
equal the targeted `id`). If it changes the id, the new id must not already
exist elsewhere in the document, or the op fails with
[`duplicate-id`](#5-errors-never-silent).

### remove-block

```json
{ "op": "remove-block", "id": "<id>" }
```

Removes the block from its parent array. Removing a `section` removes the
section and everything nested inside it.

---

## 3. Id resolution is recursive

`afterId` and `id` are resolved against the **entire block tree**, not just the
top-level array. A `section` block carries a nested `blocks: Block[]`; an op
that targets an id inside a section operates within that section's array.

```
doc.blocks
├─ heading#intro
├─ section#body
│   ├─ paragraph#p1      ← patch-block id:p1 patches here
│   └─ action#cta        ← insert-after afterId:cta lands a sibling here
└─ divider#end
```

Ids are **globally unique within a document**. A well-formed PortableDoc has no
two blocks (at any depth) sharing an `id`. Runtimes may assume this on input
and **must** preserve it on output — see [`duplicate-id`](#5-errors-never-silent).

---

## 4. Optimistic concurrency — `ifRev` / `expectedVersion`

Any op MAY carry an optional concurrency guard. Two spellings are accepted on
the wire and are **exact synonyms** — runtimes treat them identically and
should normalise to one internally:

```json
{ "op": "remove-block", "id": "x", "ifRev": "<rev>" }
{ "op": "remove-block", "id": "x", "expectedVersion": "<rev>" }
```

- The value is an opaque revision token (string or integer) carried alongside
  the document out-of-band — this contract does **not** define where the
  document's current revision lives, only how a guard is compared.
- Before applying, the runtime compares the guard to the document's current
  revision. On mismatch the op fails with a `rev-mismatch` error (see §5) and
  the document is left untouched.
- When **both** keys are present they must carry equal values; unequal values
  are a malformed op and fail with `rev-mismatch`.
- Absence of the field means "apply unconditionally" — the common case.

A patch (a list of ops) is applied atomically with respect to its guard: if any
op's guard fails, the whole patch is rejected and nothing is applied. (This
contract defines the single-op semantics; batch atomicity is a runtime concern
that builds on top.)

---

## 5. Errors — never silent

Mutating ops **validate before they mutate** and surface failures as
**structured errors**, never as a silent no-op and never as a partially-applied
document. The defined error codes:

| Code              | Raised when                                                                 |
| ----------------- | --------------------------------------------------------------------------- |
| `block-not-found` | `insert-after` / `patch-block` / `replace-block` / `remove-block` targets an `id`/`afterId` that exists nowhere in the tree. |
| `type-mismatch`   | `patch-block` carries a `patch.type` that differs from the target's `type`. |
| `duplicate-id`    | An op would introduce a second block sharing an existing `id` (`append-block` / `insert-after` with a colliding `block.id`, or `replace-block` re-keying onto an in-use id). |
| `rev-mismatch`    | An `ifRev` / `expectedVersion` guard does not match the current revision, or the two guard spellings disagree. |

Error shape on the wire (the reference shape; runtimes map to their own error
type but preserve `code` and `target`):

```json
{ "error": { "code": "block-not-found", "target": "<id>", "op": "patch-block" } }
```

`code` is one of the four above. `target` echoes the offending id (or `afterId`).
`op` echoes the failing op's discriminator. Additional fields are permitted but
not required.

### DRAFT-mode validation

Mutating ops validate in **DRAFT mode**: validation must **tolerate an
in-progress trailing block** — a final top-level block that is structurally
incomplete (e.g. an empty `paragraph` with `content: []`, a freshly-added
`heading` with empty `text`, a `section` with `blocks: []`). Editors emit such
blocks mid-keystroke; rejecting them would make live editing impossible.

DRAFT mode relaxes *block-content completeness* for that trailing block only. It
does **not** relax the structural invariants this contract turns on:
`block-not-found`, `type-mismatch`, and `duplicate-id` are enforced in DRAFT mode
exactly as in strict mode. The trailing-block tolerance never licenses a missing
`id`, a missing `type`, or a duplicate `id`.

---

## 6. Conformance rule

This is the contract's reason to exist.

> **All three runtimes — portable-doc (TypeScript), Barkpark (Elixir), and
> Scaffy (Go) — MUST apply every golden fixture in `fixtures/doc-patch-op/` and
> produce a result deeply equal to the fixture's `after`. A shape regression
> fails loudly: the conformance test errors, it does not warn.**

Each golden fixture is a triple:

```json
{ "before": <PortableDoc>, "op": <DocPatchOp>, "after": <PortableDoc> }
```

A runtime's conformance test loads each file and asserts:

```
deepEqual( applyDocPatch(fixture.before, fixture.op), fixture.after )
```

"Deeply equal" means structural JSON equality: same keys, same values, same
array order. Block-key ordering within an object is **not** significant (JSON
objects are unordered); array order **is** significant (`blocks`, `items`,
`content`, `rows` are sequences). Whitespace and key order in the fixture file
itself carry no meaning.

A new op variant, a renamed field, a changed merge semantic, or a dropped error
code is a **breaking change to this contract** and requires a new fixture set
plus a coordinated bump across all three repos. The fixtures are the executable
spec; this prose explains them.

---

## PortableDoc recap

Defined canonically in portable-doc `packages/core/src/ast.ts`; reproduced here
only so this contract is self-contained.

```
PortableDoc = { version: 1, title?: string, preview?: string, blocks: Block[] }

Block        = { id: string, type: BlockType, surfaces?: Surface[], ... }
BlockType    ∈ heading | paragraph | list | callout | action
             | section | divider | code | image | table
```

Per-type payload (the `...` above):

| `type`      | Payload fields                                                  |
| ----------- | -------------------------------------------------------------- |
| `heading`   | `level: 1..6`, `text: string`                                  |
| `paragraph` | `content: InlineNode[]`                                        |
| `list`      | `ordered?: boolean`, `items: InlineNode[][]`                   |
| `callout`   | `tone`, `title?: string`, `content: InlineNode[]`              |
| `action`    | `label: string`, `href: string`, `priority: primary\|secondary` |
| `section`   | `title?: string`, `blocks: Block[]`  (nests the tree)          |
| `divider`   | (none)                                                         |
| `code`      | `lang?: string`, `value: string`                               |
| `image`     | `src`, `alt`, `width?`, `height?`, `surfaces: ["web","native"]` |
| `table`     | `rows: InlineNode[][][]`, `surfaces: ["web","native"]`         |

```
InlineNode ∈ { type:"text",   value:string }
           | { type:"strong", children:InlineNode[] }
           | { type:"em",     children:InlineNode[] }
           | { type:"code",   value:string }
           | { type:"link",   href:string, children:InlineNode[] }
```

`image` and `table` are escape-hatch blocks: their `surfaces` is locked to
`["web","native"]`.
