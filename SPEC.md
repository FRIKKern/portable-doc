# Spec

```
today (until R4.2)                         after R4.2
Barkpark Elixir block modules ── source     spec/blocks.schema.json here ── source
        │ mix barkpark.portable_doc.gen_spec          │ PR into Barkpark
        ▼                                             ▼
spec/blocks.schema.json here ── copy        Barkpark checks its modules against it
```

PortableDoc is a JSON document: an ordered list of blocks, each with a type from a closed set of 80. Every block belongs to one composition tier: `element` (a leaf), `widget` (composes elements into one unit) or `section` (owns the layout of its children). A doc type can declare structure rules per block kind: presence, cardinality and position.

A callout's content is its own first paragraph, its slots.body is the blocks after that paragraph, and neither field is a copy of the other. A callout's body holds any block a document may hold. The one depth limit every document has applies to it too. A callout with empty `content` and a body is allowed: an empty first line is not a missing one. Readers show the content, then every block of the body, in that order ([0014](docs/decisions/0014-callout-content-and-body.md)).

What lands here, and when:

| Path | What | From |
|---|---|---|
| `spec/blocks.schema.json` | The 80 block types, their fields and tiers, as JSON Schema | R1.3 |
| `spec/constraints.md` | The structure vocabulary: presence, cardinality, position | R1.3 |
| `goldens/` | Input docs and the exact output each renderer must give, stamped with the render version, CSS hash, gettext hash and Barkpark sha | R1.4 |
| `ops/` | The 9 edit verbs with fixtures every editor and Barkpark's `Patch` must agree on | R1.4 |

Until R1 lands, the source of truth is Barkpark: `api/lib/barkpark/portable_doc/` (`tiers.ex`, `constraints.ex`, `render.ex`, `patch.ex`). Stored docs say `"format": "portableDoc"`, and that never changes (Z6).
