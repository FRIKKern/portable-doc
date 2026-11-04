# @portable-doc/code

The canonical PortableDoc reader code highlighter and keyboard behavior for
reader tab strips. This staging package is private; publication and Barkpark
adoption are separate release gates.

The package root is the browser bootstrap used by the reader. Pure consumers
can import `@portable-doc/code/highlight` for tokenizer helpers or
`@portable-doc/code/tabs` for tab wiring. `npm run build` emits the standalone
IIFE asset at `dist/bp-paper-code.js`.

The extracted Barkpark source revision and byte hashes are recorded in
`SOURCE.json`. The direct tokenizer dependencies remain pinned to the versions
used by that source: `highlight.js@11.12.0` and `lowlight@3.3.0`.
