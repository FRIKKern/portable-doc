# @portable-doc/mcp

```
MCP client ──stdio──► portable-doc-mcp
                        validate   ─► @portable-doc/validate (packages/validate)
                        explain    ─► reason codes + paths in plain words (CODES.md)
                        apply_ops  ─► ops/ : Barkpark Patch + editor intents, all or nothing, duplicates judged at the end
                        render     ─► POST $BARKPARK_URL/v1/plugins/bulldocs/render ─► { html }
```

| Tool | Takes | Gives |
|---|---|---|
| `validate` | `doc` | `{ ok }` or `{ ok: false, errors: [{ code, path, message }] }` |
| `explain` | `errors`, optional `doc` | `{ explanations: [{ code, path, where, text }] }` |
| `apply_ops` | `doc`, `ops` (≤ 100) | `{ ok: true, doc }`, or a tool error `{ ok: false, index, error }` |
| `render` | `doc` | `{ html }` from Barkpark's reader, or a tool error |

Bad arguments are `InvalidParams` (-32602), and so are `tools/call` params that are not `{ name, arguments: {…} }`; `apply_ops` and `render` need a blocks array (`{ blocks: [...] }` or `[...]`), while `validate` accepts any JSON value and returns validator diagnostics for invalid shapes. A refused op and a failed render are tool results with `isError`. Limits: 16 MiB per message, 200,000 JSON values per call, 1,000 JSON levels for `apply_ops` and `render` (`validate` takes any depth and answers `too_deep`). A call with a table edit also counts the JSON inside strings that start with `[` or `{`, because Barkpark's normalizer decodes it. An `explain` location is at most 1,000 characters: a deep path keeps its innermost steps, and long keys, types and ids are cut at 100.

## Run

```sh
BARKPARK_URL=https://barkpark.example BARKPARK_TOKEN=<ingest token> node packages/mcp/bin/portable-doc-mcp.mjs
```

`BARKPARK_TOKEN` is the instance ingest token or an admin API token; it goes only into the render request's `Authorization` header and must be printable ASCII with no spaces. Neither variable is ever echoed in an error; a `BARKPARK_URL` carrying a user or password is refused. Barkpark validates before it renders (a broken doc comes back as its 422 with every violation) and stores nothing. It meters the route per token like its other POSTs; a 429 comes back as a tool error carrying Barkpark's retry hint.

`BARKPARK_TIMEOUT_MS` (default 10000) bounds a render. Only `render` touches the network.

## Prove it

| What | Command |
|---|---|
| Ops goldens, server, explain, transcript, 5,000 recorded answers each from `patch.ex`, its batch fold, the intents and the normalizer, and the seven batch duplicate vectors | `npm run check` |
| The SDK client runs all four tools on one doc | `node packages/mcp/transcript.mjs` → [`TRANSCRIPT.md`](TRANSCRIPT.md) |
| The same steps against a real Barkpark (one render call) | `BARKPARK_URL=… BARKPARK_TOKEN=… node packages/mcp/transcript.mjs --live` → [`LIVE.md`](LIVE.md) |
| The six Patch ops against Barkpark's own Elixir | `node packages/mcp/differential.mjs ../barkpark 20000` |
| Re-record the answers `npm run check` replays | `node packages/mcp/differential.mjs ../barkpark 5000 11 packages/mcp/test/patch-elixir.json` |
| Batches against `Patch.apply_patches`: duplicates judged at the end ([0007](../../docs/decisions/0007-batch-duplicates.md)) | `node packages/mcp/differential.mjs ../barkpark 20000 1 --batch` |
| Re-record the batch answers | `node packages/mcp/differential.mjs ../barkpark 5000 11 packages/mcp/test/batch-elixir.json --batch` |
| Re-record the seven batch duplicate vectors (`test/batch-vectors.json`, full answers, for a second fold) | `node packages/mcp/vectors.mjs ../barkpark` |
| The three editor intents against `BlockOps.lower_editor_op` (needs a compiled `../barkpark/api`) | `node packages/mcp/differential.mjs ../barkpark 20000 1 --intents` |
| Re-record the intent answers | `node packages/mcp/differential.mjs ../barkpark 5000 11 packages/mcp/test/intents-elixir.json --intents` |
| `normalize_render_shapes` and the table preflight on random shapes | `node packages/mcp/differential.mjs ../barkpark 20000 1 --normalize` |
| Re-record the normalizer answers | `node packages/mcp/differential.mjs ../barkpark 5000 11 packages/mcp/test/normalize-elixir.json --normalize` |

Why it looks like this: [0006](../../docs/decisions/0006-mcp.md).
