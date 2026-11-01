# Reason codes

| Code | Refused when | From | Fixtures | Elixir today (Barkpark `main` afb4063) |
|---|---|---|---|---|
| `not_a_doc` | the doc is neither a blocks array nor an object with a `blocks` array | the doc envelope | 3 | Papers only: `BlockOps.validate_render_shapes/1` → `{:invalid_paper_structure, %{"blocks" => ["must be an array when a Paper declares a block body"]}}` |
| `block_not_object` | a block is not an object | the schema root's `type: object` | 5 | `BlockOps.validate_block_elements/2` → `{:malformed_blocks, %{"blocks" => ["blocks[0] must be an object"]}}` on every write through `Content.Writer`. Descends `blocks`, `children`, `steps`, `tabs`, `columns`; not a figure's `child` |
| `portable_text_block` | an object anywhere in the doc is a Sanity Portable Text block (`_type: "block"` with `children`, `markDefs` or `listItem`) | Barkpark's own check | 7 | Partly: `Content.Validation` finding `:portable_text_not_portabledoc`, on a richText field with `"editor": "blocks"`, top-level blocks only (`richtext_blocks/1` + `Enum.with_index`); an error only on an enforcing dataset, else a warning. Nested blocks, list items, card media and inline content: not refused yet |
| `missing_required_field` | a field the schema lists in `required` is absent: a block's or an inline node's `type` | schema `required` | 3 | Block `type`, blocks fields only: `FieldVocabulary.validate/2` → `{:out_of_vocabulary, "a block without a type"}`. Papers: not refused (renders "invalid block"). Inline `type`: not refused yet |
| `unknown_block_type` | a block's `type` is not in the schema's type enum | schema root `properties.type.enum` | 4 | Papers: advisory only, `AuthoringWall` warning `unknown_block_children`, and only when the block has children. Blocks fields: `FieldVocabulary.validate/2` → `{:out_of_vocabulary, "block type … is not in this field's vocabulary"}` (that vocabulary is narrower than the schema) |
| `wrong_field_type` | a value has the wrong JSON type, or fits no `anyOf` shape | schema `type`, `anyOf` | 5 | Partly. Papers: `validate_render_shapes/1` refuses `list.items` and `table.rows` that are not arrays (`:invalid_paper_structure`). Ops: `Patch` refuses a `patch-block` value it cannot coerce (`{:invalid_op, …}`). Everything else: not refused yet |
| `value_not_allowed` | a value is outside `enum`, `const`, `minimum`, `maximum`, or matches a `not` | schema `enum`, `const`, `minimum`, `maximum`, `not` | 4 | Not refused yet. Nearest: a blocks field refuses an integer heading level its styles leave out (`{:out_of_vocabulary, "heading level … is not in this field's vocabulary"}`) |
| `duplicate_block_id` | two blocks in the tree share a non-blank `id` | Barkpark's own check | 3 | `BlockIds.project_block_ids_safely/1` → `{:duplicate_id, id}` on revision-fenced document ops and contextual history; `Patch` → `{:duplicate_id, id, op}` when an op adds one. A plain write keeps duplicates as they are |
| `too_deep` | blocks nest more than `MAX_DEPTH` (100) levels; the walk stops there instead of overflowing the stack | a limit of the walk | 1 | Not refused yet. The BEAM has no stack to overflow, so part 2 needs the same explicit cap |

Fixtures counts the files that expect the code; `mixed-three-codes.json` expects three at once.

## Rules

- `path` is a JSON pointer into the doc: `/blocks/2/level`. A duplicate points at the second `id`.
- Every error is reported, not just the first. `validate` never throws on any JSON value; a doc nested past `MAX_DEPTH` gets `too_deep`.
- A value that fits no `anyOf` shape gets the errors of the first shape whose JSON type it has; with none, `wrong_field_type`.
- The schema drives the checks. `compile(schema)` refuses a schema that uses a keyword or type it cannot follow, so a new rule in a synced schema fails `npm run check` instead of passing unchecked.
- Ids: JS counts every block it reaches through `$ref: "#"`, including card, callout, note and stage slots and list item children. Elixir's fence skips those, and also counts steps and tabs row ids. The fixtures stay where both agree.

## Not codes

| Considered | Why not |
|---|---|
| `unknown_field` | Blocks are open: the schema has no `additionalProperties` on them, and the nested-list golden carries an extra `audit` key |
| `bad_nesting` | Tiers are classification only (`tiers.ex`: "nothing depends on it yet"); the schema allows any block at every `$ref: "#"` |
| `bad_format_marker` | The schema leaves inline fields and marks unspecified; `"format": "portableDoc"` is a Barkpark field setting, not doc content |
| structure constraints | Need a doc type's declarations (`Constraints.validate/2`), not the doc alone |

## Part 2 brief

Barkpark refuses each `fixtures/broken/*.json` doc with exactly its `expect` codes, one Elixir refusal per row above, and passes `fixtures/valid/` and the pack goldens. Rows marked "not refused" or "partly" are the work.
