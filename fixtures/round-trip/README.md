# Round trip

Every block form that round-trip mode keeps, in its own Markdown or in a
portabledoc fence, as `{ name: { markdown, blocks } }`: `toMarkdown(blocks, { mode: 'round-trip' })`
writes `markdown`, and `fromMarkdown(markdown)` gives `blocks` back. The forms
are those of `packages/text/block-forms.mjs`, the same the round-trip test tries.

The script writes `round-trip-cases.json` (about 180 kB), so it is not kept.
