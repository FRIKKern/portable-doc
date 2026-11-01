# @portable-doc/mcp

```
MCP client ──stdio──► portable-doc-mcp
                        validate   ─► @portable-doc/validate (packages/validate)
                        explain    ─► reason codes + paths in plain words (CODES.md)
                        apply_ops  ─► ops/ : Barkpark Patch + editor intents, all or nothing
                        render     ─► POST $BARKPARK_URL/v1/plugins/bulldocs/render ─► { html }
```

| Tool | Takes | Gives |
|---|---|---|
| `validate` | `doc` | `{ ok }` or `{ ok: false, errors: [{ code, path, message }] }` |
| `explain` | `errors`, optional `doc` | `{ explanations: [{ code, path, where, text }] }` |
| `apply_ops` | `doc`, `ops` (≤ 100) | `{ ok: true, doc }`, or a tool error `{ ok: false, index, error }` |
| `render` | `doc` | `{ html }` from Barkpark's reader, or a tool error |

Bad arguments are `InvalidParams` (-32602); `apply_ops` and `render` need a blocks array (`{ blocks: [...] }` or `[...]`), `validate` checks any object. A refused op and a failed render are tool results with `isError`. Limits: 16 MiB per message, 200,000 JSON values per call, 1,000 JSON levels for `apply_ops` and `render` (`validate` takes any depth and answers `too_deep`).

## Run

```sh
BARKPARK_URL=https://barkpark.example node packages/mcp/bin/portable-doc-mcp.mjs
```

`BARKPARK_TIMEOUT_MS` (default 10000) bounds a render. Only `render` touches the network.

## Prove it

| What | Command |
|---|---|
| Ops goldens, server, explain, transcript, 5,000 recorded `patch.ex` answers | `npm run check` |
| The SDK client runs all four tools on one doc | `node packages/mcp/transcript.mjs` → [`TRANSCRIPT.md`](TRANSCRIPT.md) |
| The six Patch ops against Barkpark's own Elixir | `node packages/mcp/differential.mjs ../barkpark 20000` |
| Re-record the answers `npm run check` replays | `node packages/mcp/differential.mjs ../barkpark 5000 11 packages/mcp/test/patch-elixir.json` |

Why it looks like this: [0005](../../docs/decisions/0005-mcp.md).
