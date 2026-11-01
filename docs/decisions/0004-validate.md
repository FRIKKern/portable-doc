# 0004 One validator, driven by the schema, report-only for now

Date: 2026-11-01 · Status: accepted

```
spec/blocks.schema.json ──► compile(schema) ──► validate(doc) ─► { ok } | { errors: [{ code, path, message }] }
 (synced, 0003)               │ refuses a keyword it cannot follow
                              ▼
fixtures/broken/*.json ──► one doc, its expected codes ──► JS today (this PR)
fixtures/valid/*.json  ──► must pass                  ──► Elixir in Barkpark (R4.3 part 2), same codes
goldens/               ──► must pass

nothing calls validate yet: no app, no Barkpark write path (report-only)
```

## Context

R4 promises that AI and apps can't save a broken doc. Barkpark refuses some broken docs today, each in its own words (`malformed_blocks`, `invalid_paper_structure`, `out_of_vocabulary`, `duplicate_id`), and lets others through. A JS editor has no way to ask the same question before it saves.

## Decision

- `@portable-doc/validate` (`packages/validate/`) reads `spec/blocks.schema.json` at load time and follows it keyword by keyword. No rule is copied by hand, except two Barkpark already enforces that the schema cannot say (Portable Text blocks, duplicate ids) and a depth cap so the walk returns instead of overflowing the stack.
- Errors carry a code from a closed set of nine, listed with where Elixir refuses each today in [`CODES.md`](../../packages/validate/CODES.md). That table is the brief for part 2.
- `fixtures/broken/` holds one synthetic doc per shape with its expected codes and paths; `fixtures/valid/` holds docs that must pass. Both sides run the same files.
- A schema keyword the validator cannot follow throws at load, so a synced schema change fails `npm run check` instead of passing unchecked (Z8).
- Zero runtime dependencies. Not published: `private: true` until the owner decides.
- **Report-only.** Nothing in Barkpark or any app calls it yet. Turning it into a gate is a later, separate step.

## Considered

- **Ajv or another JSON Schema library.** Rejected: a dependency, and its errors are keyword names, not our codes. The schema checks with 14 keywords; following them takes about 160 lines.
- **Generate a validator file at build time.** Rejected: a generated file to keep in step. Reading the schema at load gives the same result with no build.
