// For each proposed alias pair: is the alias read with the canonical key removed, is the canonical read, and which do goldens fill?
const R = process.argv[2];
const { renderPortableDocument } = await import(R + '/packages/react/dist/index.mjs');
const { FENCE_TYPES } = await import(R + '/packages/text/from-markdown.js');
const { toMarkdown, toPlainText } = await import(R + '/packages/text/index.js');
const { goldenBlocks, reads, pathName, filledNames } = await import(R + '/packages/text/golden-reads.mjs');
const RENDERS = { html: (b) => renderPortableDocument(b, {}), markdown: toMarkdown, text: toPlainText };
const pairs = [['blockquote.attribution', 'blockquote.cite'], ['expandable.blocks', 'expandable.children'], ['terminal.blocks', 'terminal.children']];
for (const [alias, canonical] of pairs) {
  const type = alias.split('.')[0], key = canonical.split('.')[1];
  const gs = goldenBlocks(new Set([type])).map((g) => g.block);
  const names = (bs) => new Set(bs.flatMap((b) => reads(b, RENDERS).map((r) => pathName(type, r.path))));
  const asIs = names(gs), without = names(gs.map((b) => Object.fromEntries(Object.entries(b).filter(([k]) => k !== key))));
  const filled = new Set(gs.flatMap((b) => [...filledNames(b)]));
  console.log(alias.padEnd(16), '->', canonical.padEnd(16), `goldens ${gs.length}`, `alias read w/o canonical: ${without.has(alias)}`, `canonical read: ${asIs.has(canonical)}`, `golden has alias: ${filled.has(alias)}`, `golden has canonical: ${filled.has(canonical)}`);
}
