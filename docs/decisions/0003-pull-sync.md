# 0003 portable-doc pulls spec and goldens from Barkpark

Date: 2026-10-31 · Status: accepted

```
FRIKKern/barkpark (public)                 FRIKKern/portable-doc
api/priv/portable_doc/spec/     ─┐         hourly + on demand: sync-from-barkpark.yml
api/priv/portable_doc/goldens/  ─┼─ read ─► check-pack --against: same? ── yes ─► done, no PR
                                 │  (no         │ no
                                 │  token)      ▼
                                 │         sync-from-barkpark.mjs copies spec/ goldens/,
                                 │         writes SOURCE.json (commit + sha256 per file)
                                 │              ▼
                                 └──────── one PR on sync/barkpark, GITHUB_TOKEN:
                                           title names the Barkpark commit, old → new stamp
```

## Context

Barkpark is the source of the spec and the goldens until their flip (Z9). portable-doc must hold the same bytes, and must fail when its copy is stale or empty (Z8). Both repos are public. Barkpark has no token that can write to portable-doc.

## Decision

- portable-doc pulls. A scheduled workflow checks out Barkpark `main` read-only, and opens or updates one PR on the fixed branch `sync/barkpark` when anything differs. No change, no PR.
- The copy runs in a plain script, `scripts/sync-from-barkpark.mjs <barkpark checkout>`, so it runs and is tested locally. The workflow only calls it.
- `npm run check` checks the pack: the stamp lists every golden with its sha256, at least 80 block goldens, `spec/blocks.schema.json` exists. It also checks `SOURCE.json`: every file in `spec/` and `goldens/` is as the sync wrote it, so a hand edit fails.
- `scripts/check-pack.mjs --against <barkpark checkout>` also fails when the copy differs from Barkpark. The workflow uses it to decide.
- The PR is opened with `GITHUB_TOKEN`. The repo setting "Allow GitHub Actions to create pull requests" must be on.

## Considered

- **Barkpark pushes.** A Barkpark workflow opens the PR here when its pack changes. Rejected: it needs a cross-repo write token stored in Barkpark, a secret to rotate and to leak. Pulling needs none. The cost is up to an hour of lag, and a run on demand closes it.
- **A git submodule or subtree.** Rejected: it pins the whole Barkpark repo, not the pack, and needs a person to bump it.
