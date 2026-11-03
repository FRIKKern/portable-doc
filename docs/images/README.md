# Seven-host journey baseline

This is the R2.5 “before” capture from Barkpark host-journey runner
`b76cd4d7a9868a97c760126c400330a1eb50ede8`, stacked on TG2
`7b8ac416c8f9cde903537e130e429124777294da`.

`hosts/manifest.json` records the pinned Chrome and ffmpeg versions, all seven
synthetic host contracts, and each E01–E12 result. E09 is deliberately labeled
`diagnostic-negative`: its passing evidence is a red Read/Edit light on the
frozen `sample:callout` mismatch. It proves that the diagnostic detects the
known mismatch; it does not claim reader/editor parity is green.

E12 is a historical 1.21→1.22 browser replay. Its reports record and compare
the browser-loaded SHA-256 identities for both distinct clients before
asserting that their normalized save operations are byte-equal. Native host
upgrade and rollback evidence is tracked separately.
