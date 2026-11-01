# Third-party code

| Code | From | License | Where here |
|---|---|---|---|
| Patch ops (`Barkpark.PortableDoc.Patch`, `FieldNumber`), editor-intent lowering (`BlockOps.lower_editor_op/2`), `TableEditing`, `BlockIds` id walk | `FRIKKern/barkpark` `api/lib/barkpark/` at `4090b79`, ported to JS | Apache-2.0 | [`packages/mcp/ops/`](packages/mcp/ops/) ([0006](docs/decisions/0006-mcp.md)) |
| `@modelcontextprotocol/sdk` 1.32.1 and its dependencies (npm, not vendored) | npm | MIT | [`packages/mcp/package.json`](packages/mcp/package.json) |

The editor arrives at R5 from `FRIKKern/barkpark` (`api/assets/paper-editor/`, Apache-2.0) with its dependencies; each gets a row here then. The old 10-type version at tag `legacy-v0.4` is MIT and not part of `main` ([0002](docs/decisions/0002-reuse-this-repo.md)).
